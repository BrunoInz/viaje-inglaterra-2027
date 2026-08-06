// GENERADO AUTOMATICAMENTE por scripts/build-snippets.js
// No editar a mano: modificar lib/ y correr 'npm run build'.

// Ciudad de cada club, para el filtro de accesibilidad geografica.
// Solo se listan los clubes que el spec considera relevantes.
const CIUDAD_POR_TLA = {
  MCI: 'Manchester',
  MUN: 'Manchester',
  LIV: 'Liverpool',
  EVE: 'Liverpool',
  FUL: 'London',
  BRE: 'London',
  WHU: 'London',
  CRY: 'London',
  ARS: 'London',
  CHE: 'London',
  TOT: 'London',
  WOL: 'Wolverhampton',
  AVL: 'Birmingham',
  BUR: 'Burnley',
  BOU: 'Bournemouth',
};

const OFFSETS_VARIANTE = [2, 5, 8];
const DIAS_VIAJE = 10;

const SCORE = {
  BASE: 100,
  POR_ACCESIBLE: 20,
  CHAMPIONS: 30,
  TEMPORADA_BAJA: 10,
};

// Temporada baja de vuelos segun el spec: 7 de enero a 15 de marzo.
const TEMPORADA_BAJA = {
  DESDE_MMDD: '01-07',
  HASTA_MMDD: '03-15',
};

const RANGO_TRACKEABLE = {
  PISO_DIAS: 60,
  TECHO_DIAS: 320,
};

const ALERTA = {
  FACTOR: 0.85,
  MIN_REGISTROS: 7,
  ANTISPAM_HORAS: 48,
};

// El require va en UNA sola linea a proposito: scripts/build-snippets.js
// elimina los require locales filtrando linea por linea, y un require
// multilinea dejaria un 'const {' huerfano en el snippet generado.

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

// --- orquestacion n8n ---
const config = $('Leer config').first().json;
const todos = $('Leer fixtures').all().map((i) => i.json);
const city = todos.filter((p) => p.tla_local === 'MCI' && p.competencia === 'PL');
const hoy = new Date().toISOString().slice(0, 10);

const parametros = {
  ventanas_activas: Number(config.ventanas_activas),
  clubes_accesibles: String(config.clubes_accesibles).split(';'),
  ciudades_ok: String(config.ciudades_ok).split(';'),
};

return generarVentanas(city, todos, parametros, hoy).map((v) => ({ json: v }));
