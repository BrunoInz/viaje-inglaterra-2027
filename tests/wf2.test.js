const test = require('node:test');
const assert = require('node:assert');
const { construirWorkflow, COLUMNAS_VENTANA } = require('../scripts/build-wf2');
const { testsComunes } = require('./lib/aserciones-wf');

const wf = construirWorkflow();
const nodo = (nombre) => wf.nodes.find((n) => n.name === nombre);

testsComunes({
  archivo: 'wf2-ventanas.json',
  wf,
  snippets: { 'Calcular ventanas': 'wf2-calcular-ventanas' },
});

test('guardar ventanas no escribe ultima_alerta_ts', () => {
  // El snippet emite ultima_alerta_ts: null en cada corrida. Con automapeo,
  // Google Sheets escribiria esa celda en blanco todos los domingos y borraria
  // el anti-spam de 48h que el WF3 acaba de registrar: las alertas se
  // duplicarian sin que nada falle a la vista.
  const guardar = nodo('Guardar ventanas');
  const mapeadas = Object.keys(guardar.parameters.columns.value);

  assert.strictEqual(guardar.parameters.columns.mappingMode, 'defineBelow',
    'con automapeo ultima_alerta_ts se pisaria en blanco cada domingo');
  assert.ok(!mapeadas.includes('ultima_alerta_ts'),
    'ultima_alerta_ts la escribe solo el WF3, nunca este workflow');
});

test('guardar ventanas mapea todas las demas columnas de la pestana', () => {
  const guardar = nodo('Guardar ventanas');
  assert.deepStrictEqual(
    Object.keys(guardar.parameters.columns.value).sort(),
    [...COLUMNAS_VENTANA].sort(),
    'faltan o sobran columnas respecto de la pestana ventanas');
});

test('guardar ventanas matchea por ventana_id, no appendea a ciegas', () => {
  // Con Append a secas se acumularian duplicados cada domingo y el historico
  // de precios quedaria repartido entre filas homonimas.
  const guardar = nodo('Guardar ventanas');
  assert.strictEqual(guardar.parameters.operation, 'appendOrUpdate');
  assert.deepStrictEqual(guardar.parameters.columns.matchingColumns, ['ventana_id']);
});

test('el snippet lee las pestanas que este workflow provee', () => {
  const codigo = nodo('Calcular ventanas').parameters.jsCode;
  assert.ok(codigo.includes("$('Leer config')"), 'el snippet dejo de leer config');
  assert.ok(codigo.includes("$('Leer fixtures')"), 'el snippet dejo de leer fixtures');
});

test('el trigger corre despues del WF1', () => {
  // El WF1 sale a las 08:00 del domingo y puebla fixtures. Si este arrancara
  // antes o a la misma hora, calcularia ventanas sobre datos de la semana pasada.
  const { triggerAtDay, triggerAtHour, triggerAtMinute } =
    nodo('Domingos 08:30').parameters.rule.interval[0];

  assert.deepStrictEqual(triggerAtDay, [0], 'tiene que correr los domingos');
  assert.ok(triggerAtHour > 8 || (triggerAtHour === 8 && triggerAtMinute > 0),
    'tiene que arrancar despues del WF1 de las 08:00');
});

test('el workflow corre en la zona horaria de Buenos Aires', () => {
  assert.strictEqual(wf.settings.timezone, 'America/Argentina/Buenos_Aires');
});
