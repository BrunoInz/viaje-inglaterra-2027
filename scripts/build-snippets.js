'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const DIR_LIB = path.join(RAIZ, 'lib');
const DIR_SALIDA = path.join(RAIZ, 'n8n', 'code-snippets');

// Cada snippet declara que modulos de lib/ necesita inline y con que codigo
// de orquestacion de n8n se envuelve.
const SNIPPETS = [
  {
    nombre: 'wf1-normalizar-fixtures',
    modulos: ['constantes', 'fixtures'],
    wrapper: `
// La competencia viaja en cada item: WF1 fusiona la rama de Premier con la de
// Champions, y despues del Merge ya no se puede saber de que rama vino cada uno.
return $input.all().map((item) => ({
  json: normalizarPartido(item.json, item.json._competencia || 'PL'),
}));`,
  },
  {
    nombre: 'wf1-detectar-reprogramaciones',
    modulos: ['constantes', 'fixtures'],
    wrapper: `
const previos = $('Leer fixtures previos').all().map((i) => i.json);
const actuales = $('Normalizar fixtures').all().map((i) => i.json);
const cambios = detectarReprogramaciones(previos, actuales, 'MCI');
return cambios.map((c) => ({ json: c }));`,
  },
  {
    nombre: 'wf2-calcular-ventanas',
    modulos: ['constantes', 'ventanas'],
    wrapper: `
const config = $('Leer config').first().json;
const todos = $('Leer fixtures').all().map((i) => i.json);
const city = todos.filter((p) => p.tla_local === 'MCI' && p.competencia === 'PL');
const hoy = new Date().toISOString().slice(0, 10);

const parametros = {
  ventanas_activas: Number(config.ventanas_activas),
  clubes_accesibles: String(config.clubes_accesibles).split(';'),
  ciudades_ok: String(config.ciudades_ok).split(';'),
};

return generarVentanas(city, todos, parametros, hoy).map((v) => ({ json: v }));`,
  },
  {
    nombre: 'wf3-normalizar-precios',
    modulos: ['precios'],
    wrapper: `
const config = $('Leer config').first().json;
const pasajeros = Number(config.pasajeros);
const ventana = $('Ventana actual').first().json;
const salida = [];

// SerpApi: precio total del grupo, hay que dividirlo.
const serp = $('SerpApi').first().json;
const totalSerp = serp && serp.best_flights && serp.best_flights[0]
  ? serp.best_flights[0].price : null;
salida.push({
  json: {
    ts: new Date().toISOString(),
    ventana_id: ventana.ventana_id,
    ruta: 'EZE-LON-EZE',
    fuente: 'serpapi',
    precio_usd: normalizarPrecioGrupo(totalSerp, pasajeros),
    aerolinea: serp && serp.best_flights && serp.best_flights[0]
      ? (serp.best_flights[0].flights[0].airline || '') : '',
    escalas: serp && serp.best_flights && serp.best_flights[0]
      ? serp.best_flights[0].flights.length - 1 : null,
    price_insight: serp && serp.price_insights ? serp.price_insights.price_level : '',
    estado: totalSerp === null ? 'error_fuente' : 'ok',
  },
});

// Level: ida y vuelta por separado, con deteccion de mes sin inventario.
const idaLevel = $('Level EZE-BCN').first().json;
const vueltaLevel = $('Level BCN-EZE').first().json;
const diasIda = (idaLevel.data && idaLevel.data.dayPrices) || [];
const diasVuelta = (vueltaLevel.data && vueltaLevel.data.dayPrices) || [];

if (!tieneInventario(diasIda) || !tieneInventario(diasVuelta)) {
  salida.push({
    json: {
      ts: new Date().toISOString(),
      ventana_id: ventana.ventana_id,
      ruta: 'EZE-BCN-LON',
      fuente: 'level',
      precio_usd: null,
      aerolinea: 'Level',
      escalas: null,
      price_insight: '',
      estado: 'sin_inventario',
    },
  });
} else {
  const bcnLon = Number($('Travelpayouts BCN-LON').first().json.precio_usd) || null;
  const total = precioViaBarcelona({
    ezeBcn: precioDelDia(diasIda, ventana.fecha_ida),
    bcnEze: precioDelDia(diasVuelta, ventana.fecha_vuelta),
    bcnLon,
    costoNocheBcn: Number(config.costo_noche_bcn),
  });
  salida.push({
    json: {
      ts: new Date().toISOString(),
      ventana_id: ventana.ventana_id,
      ruta: 'EZE-BCN-LON',
      fuente: 'level',
      precio_usd: total,
      aerolinea: 'Level + conexion',
      escalas: 1,
      price_insight: '',
      estado: total === null ? 'error_fuente' : 'ok',
    },
  });
}

return salida;`,
  },
  {
    nombre: 'wf3-evaluar-alertas',
    modulos: ['constantes', 'alertas'],
    wrapper: `
const config = $('Leer config').first().json;
const ventana = $('Ventana actual').first().json;
const historico = $('Leer historico').all().map((i) => i.json);
const nuevos = $('Normalizar precios').all().map((i) => i.json);
const ahora = new Date().toISOString();

const delaVentana = historico.filter((h) => h.ventana_id === ventana.ventana_id);
const salida = [];

for (const registro of nuevos) {
  if (registro.estado !== 'ok') continue;
  const veredicto = debeAlertar({
    precioActual: registro.precio_usd,
    registros: delaVentana.filter((h) => h.ruta === registro.ruta),
    umbral: Number(config.umbral_usd),
    ultimaAlertaTs: ventana.ultima_alerta_ts || null,
    ahora,
  });
  if (veredicto.alertar) {
    salida.push({ json: { ...registro, motivo: veredicto.motivo, ventana } });
  }
}

return salida;`,
  },
];

const ENCABEZADO = `// GENERADO AUTOMATICAMENTE por scripts/build-snippets.js
// No editar a mano: modificar lib/ y correr 'npm run build'.
`;

// Quita 'use strict', los require locales y el module.exports para poder
// concatenar varios modulos en un unico scope de nodo Code.
function extraerCuerpo(nombreModulo) {
  const fuente = fs.readFileSync(path.join(DIR_LIB, `${nombreModulo}.js`), 'utf8');
  return fuente
    .split('\n')
    .filter((linea) => !/^'use strict';/.test(linea))
    // IMPORTANTE: este patron debe coincidir exactamente con el de tests/sync.test.js
    // para que ambos acuerden en que es un require local (./ o ../).
    .filter((linea) => !/require\(['"]\.\.?\//.test(linea))
    .join('\n')
    .replace(/module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/m, '')
    .trim();
}

function construirSnippet(nombre) {
  const snippet = SNIPPETS.find((s) => s.nombre === nombre);
  if (!snippet) throw new Error(`snippet desconocido: ${nombre}`);
  const cuerpos = snippet.modulos.map(extraerCuerpo).join('\n\n');
  return `${ENCABEZADO}\n${cuerpos}\n\n// --- orquestacion n8n ---\n${snippet.wrapper.trim()}\n`;
}

function build() {
  fs.mkdirSync(DIR_SALIDA, { recursive: true });
  for (const snippet of SNIPPETS) {
    const destino = path.join(DIR_SALIDA, `${snippet.nombre}.js`);
    fs.writeFileSync(destino, construirSnippet(snippet.nombre), 'utf8');
    console.log(`escrito ${destino}`);
  }
}

if (require.main === module) build();

module.exports = { SNIPPETS, construirSnippet, build };
