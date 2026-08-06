'use strict';

// El require va en UNA sola linea a proposito: scripts/build-snippets.js
// elimina los require locales filtrando linea por linea, y un require
// multilinea dejaria un 'const {' huerfano en el snippet generado.
const { OFFSETS_VARIANTE, DIAS_VIAJE, SCORE, TEMPORADA_BAJA, RANGO_TRACKEABLE } = require('./constantes');

const MS_POR_DIA = 86400000;

function aFecha(iso) {
  return new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
}

function aYMD(date) {
  return date.toISOString().slice(0, 10);
}

function sumarDias(fechaYMD, dias) {
  return aYMD(new Date(aFecha(fechaYMD).getTime() + dias * MS_POR_DIA));
}

function estaEnRangoTrackeable(fechaPartido, hoy) {
  const dias = (aFecha(fechaPartido) - aFecha(hoy)) / MS_POR_DIA;
  return dias >= RANGO_TRACKEABLE.PISO_DIAS && dias <= RANGO_TRACKEABLE.TECHO_DIAS;
}

// Compara solo mes y dia: el rango de temporada baja se repite cada año.
function esTemporadaBaja(fechaIda) {
  const mmdd = String(fechaIda).slice(5, 10);
  return mmdd >= TEMPORADA_BAJA.DESDE_MMDD && mmdd <= TEMPORADA_BAJA.HASTA_MMDD;
}

function esAccesible(partido, config) {
  return config.clubes_accesibles.includes(partido.tla_local)
    && config.ciudades_ok.includes(partido.ciudad);
}

function estaDentro(fechaPartido, ida, vuelta) {
  const f = aFecha(fechaPartido);
  return f >= aFecha(ida) && f <= aFecha(vuelta);
}

function generarVentanas(partidosCity, todosLosPartidos, config, hoy) {
  const ventanas = [];

  for (const partido of partidosCity) {
    if (!estaEnRangoTrackeable(partido.fecha_utc, hoy)) continue;

    for (const offset of OFFSETS_VARIANTE) {
      const fecha_ida = sumarDias(partido.fecha_utc, -offset);
      const fecha_vuelta = sumarDias(fecha_ida, DIAS_VIAJE);

      const extras = todosLosPartidos.filter((p) =>
        String(p.match_id) !== String(partido.match_id)
        && estaDentro(p.fecha_utc, fecha_ida, fecha_vuelta)
        && esAccesible(p, config));

      const champions = todosLosPartidos.some((p) =>
        String(p.match_id) !== String(partido.match_id)
        && p.competencia === 'CL'
        && p.tla_local === 'MCI'
        && estaDentro(p.fecha_utc, fecha_ida, fecha_vuelta));

      let score = SCORE.BASE + SCORE.POR_ACCESIBLE * extras.length;
      if (champions) score += SCORE.CHAMPIONS;
      if (esTemporadaBaja(fecha_ida)) score += SCORE.TEMPORADA_BAJA;

      ventanas.push({
        // Derivado del partido y el offset, nunca de la fecha de corrida:
        // asi el id sobrevive entre ejecuciones y el historico no se corta.
        ventana_id: `${partido.match_id}-${offset}`,
        fecha_ida,
        fecha_vuelta,
        match_id_city: partido.match_id,
        partidos_extra: extras.map((p) => p.match_id).join(';'),
        score,
        activa: false,
        ultima_alerta_ts: null,
      });
    }
  }

  const ordenadas = [...ventanas].sort((a, b) => b.score - a.score || a.fecha_ida.localeCompare(b.fecha_ida));

  return ordenadas.map((v, i) => ({ ...v, activa: i < config.ventanas_activas }));
}

module.exports = { estaEnRangoTrackeable, esTemporadaBaja, generarVentanas };
