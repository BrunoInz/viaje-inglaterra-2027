'use strict';

const { CIUDAD_POR_TLA } = require('./constantes');

function normalizarPartido(raw, competencia) {
  const tla = (raw.homeTeam && raw.homeTeam.tla) || '';
  return {
    match_id: raw.id,
    fecha_utc: raw.utcDate,
    local: (raw.homeTeam && raw.homeTeam.name) || '',
    visitante: (raw.awayTeam && raw.awayTeam.name) || '',
    tla_local: tla,
    estadio: raw.venue || '',
    ciudad: CIUDAD_POR_TLA[tla] || '',
    competencia,
    estado: raw.status || '',
  };
}

// Google Sheets devuelve numeros como string al leerlos. Comparar sin
// normalizar haria que todos los partidos parezcan nuevos en cada corrida.
function detectarReprogramaciones(previos, actuales, tlaObjetivo) {
  const indice = new Map(previos.map((p) => [String(p.match_id), p]));
  const cambios = [];

  for (const actual of actuales) {
    if (actual.tla_local !== tlaObjetivo) continue;
    const previo = indice.get(String(actual.match_id));
    if (!previo) continue; // partido nuevo, no es una reprogramacion
    if (previo.fecha_utc === actual.fecha_utc) continue;

    cambios.push({
      match_id: actual.match_id,
      visitante: actual.visitante,
      fecha_anterior: previo.fecha_utc,
      fecha_nueva: actual.fecha_utc,
    });
  }

  return cambios;
}

module.exports = { normalizarPartido, detectarReprogramaciones };
