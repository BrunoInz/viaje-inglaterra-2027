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

// --- orquestacion n8n ---
// La competencia viaja en cada item: WF1 fusiona la rama de Premier con la de
// Champions, y despues del Merge ya no se puede saber de que rama vino cada uno.
return $input.all().map((item) => ({
  json: normalizarPartido(item.json, item.json._competencia || 'PL'),
}));
