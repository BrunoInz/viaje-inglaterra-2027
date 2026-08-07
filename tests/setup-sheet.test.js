const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { crearEntorno, LibroMock } = require('./lib/mock-apps-script');

const FUENTE = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'setup-sheet.gs'), 'utf8'
);

/** Ejecuta setup-sheet.gs contra un entorno mockeado y devuelve el resultado. */
function correrSetup(opciones = {}) {
  const entorno = crearEntorno(opciones);
  const contexto = vm.createContext(entorno.contexto);

  vm.runInContext(FUENTE, contexto, { filename: 'setup-sheet.gs' });

  // Permite forzar las constantes de configuracion del script.
  for (const [clave, valor] of Object.entries(opciones.constantes || {})) {
    vm.runInContext(`${clave} = ${JSON.stringify(valor)};`, contexto);
  }

  const id = vm.runInContext('setupPlanilla();', contexto);
  return { ...entorno, id };
}

/** Lee la pestana config del libro como objeto clave -> valor. */
function configDe(libro) {
  const hoja = libro.getSheetByName('config');
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
  return Object.fromEntries(filas.filter((f) => f[0]).map((f) => [f[0], f[1]]));
}

test('sin planilla activa y sin UI, crea una nueva en vez de explotar', () => {
  // Este es el caso que fallaba: en un proyecto de Apps Script suelto,
  // getActiveSpreadsheet() devuelve null y getUi() lanza.
  const { creadas, id } = correrSetup({ activa: null, conUi: false });

  assert.strictEqual(creadas.length, 1, 'deberia haber creado una planilla');
  assert.strictEqual(creadas[0].getName(), 'tracker-vuelos-inglaterra-2027');
  assert.strictEqual(id, creadas[0].getId());
});

test('sin UI el ID de la planilla queda en el log, que es lo unico visible', () => {
  const { log, creadas } = correrSetup({ activa: null, conUi: false });
  const texto = log.join('\n');

  assert.ok(texto.includes(creadas[0].getId()), 'el ID tiene que aparecer en el log');
  assert.ok(texto.includes(creadas[0].getUrl()), 'la URL tambien');
});

test('crea las 4 pestanas con sus encabezados exactos', () => {
  const { creadas } = correrSetup({ activa: null, conUi: false });
  const libro = creadas[0];

  const esperados = {
    fixtures: ['match_id', 'fecha_utc', 'local', 'visitante', 'tla_local',
      'estadio', 'ciudad', 'competencia', 'estado', 'actualizado_ts'],
    ventanas: ['ventana_id', 'fecha_ida', 'fecha_vuelta', 'match_id_city',
      'partidos_extra', 'score', 'activa', 'ultima_alerta_ts'],
    precios: ['ts', 'ventana_id', 'ruta', 'fuente', 'precio_usd',
      'aerolinea', 'escalas', 'price_insight', 'estado'],
    config: ['clave', 'valor'],
  };

  for (const [nombre, encabezados] of Object.entries(esperados)) {
    const hoja = libro.getSheetByName(nombre);
    assert.ok(hoja, `falta la pestana ${nombre}`);
    assert.deepStrictEqual(
      hoja.getRange(1, 1, 1, encabezados.length).getValues()[0],
      encabezados,
      `encabezados incorrectos en ${nombre}`
    );
    assert.strictEqual(hoja.filasCongeladas, 1, `${nombre} sin fila 1 congelada`);
  }
});

test('los encabezados coinciden con lo que los workflows leen y escriben', () => {
  // Si un encabezado se renombra aca y no en lib/, los nodos de Sheets escriben
  // columnas nuevas en blanco en vez de fallar.
  const { creadas } = correrSetup({ activa: null, conUi: false });
  const libro = creadas[0];

  const { COLUMNAS_VENTANA } = require('../scripts/build-wf2');
  const enHoja = libro.getSheetByName('ventanas').getRange(1, 1, 1, 8).getValues()[0];

  for (const columna of COLUMNAS_VENTANA) {
    assert.ok(enHoja.includes(columna),
      `el WF2 escribe '${columna}' pero la pestana ventanas no la tiene`);
  }
  assert.ok(enHoja.includes('ultima_alerta_ts'),
    'la pestana necesita ultima_alerta_ts aunque el WF2 no la escriba: la usa el WF3');
});

test('config arranca con los 9 parametros del spec', () => {
  const { creadas } = correrSetup({ activa: null, conUi: false });
  const config = configDe(creadas[0]);

  assert.strictEqual(config.umbral_usd, 1150);
  assert.strictEqual(config.ventanas_activas, 6);
  assert.strictEqual(config.dias_viaje, 10);
  assert.strictEqual(config.pasajeros, 2);
  assert.strictEqual(config.costo_noche_bcn, 80);
  assert.strictEqual(config.clubes_accesibles, 'FUL;BRE;WHU;CRY;WOL;EVE;AVL;BUR;BOU');
  assert.strictEqual(config.ciudades_ok, 'London;Manchester;Liverpool');
  assert.strictEqual(config.serpapi_agotada_mes, '', 'el flag de cuota arranca vacio');
  assert.strictEqual(Object.keys(config).length, 9);
});

test('con UI, el chat_id se pide por prompt', () => {
  const { creadas } = correrSetup({
    activa: null, conUi: true, respuestaPrompt: '12345',
  });

  assert.strictEqual(configDe(creadas[0]).telegram_chat_id, '12345');
});

test('sin UI, el chat_id sale de la constante del script', () => {
  const { creadas } = correrSetup({
    activa: null, conUi: false, constantes: { CHAT_ID_TELEGRAM: '99887' },
  });

  assert.strictEqual(configDe(creadas[0]).telegram_chat_id, '99887');
});

test('correrlo de nuevo no pisa el chat_id ni el flag de cuota', () => {
  // El WF3 escribe serpapi_agotada_mes al quedarse sin cuota. Borrarlo en pleno
  // mes hace que reintente, falle y reavise todos los dias.
  const libro = new LibroMock('existente');
  const entorno = crearEntorno({ activa: libro, conUi: false });
  const contexto = vm.createContext(entorno.contexto);
  vm.runInContext(FUENTE, contexto, { filename: 'setup-sheet.gs' });

  vm.runInContext('CHAT_ID_TELEGRAM = "111"; setupPlanilla();', contexto);
  assert.strictEqual(configDe(libro).telegram_chat_id, '111');

  // Simula lo que hace el WF3 en produccion.
  const hoja = libro.getSheetByName('config');
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
  const iFlag = filas.findIndex((f) => f[0] === 'serpapi_agotada_mes');
  hoja.getRange(2 + iFlag, 2, 1, 1).setValues([['2026-08']]);

  // Y ahora alguien vuelve a correr el setup, sin la constante.
  vm.runInContext('CHAT_ID_TELEGRAM = ""; setupPlanilla();', contexto);

  const config = configDe(libro);
  assert.strictEqual(config.telegram_chat_id, '111', 'se perdio el chat_id');
  assert.strictEqual(config.serpapi_agotada_mes, '2026-08', 'se perdio el flag de cuota');
  assert.strictEqual(config.umbral_usd, 1150, 'los parametros si se reescriben');
});

test('borra la hoja por defecto que Google agrega al crear el libro', () => {
  const { creadas } = correrSetup({ activa: null, conUi: false });

  assert.strictEqual(creadas[0].getSheetByName('Hoja 1'), null);
  assert.strictEqual(creadas[0].getSheets().length, 4);
});

test('con ID_PLANILLA seteado, reusa esa planilla y no crea ninguna', () => {
  const { creadas, id } = correrSetup({
    activa: null, conUi: false, constantes: { ID_PLANILLA: 'ABC123' },
  });

  assert.strictEqual(creadas.length, 0, 'no deberia crear una planilla nueva');
  assert.strictEqual(id, 'ABC123');
});

test('si hay planilla activa la usa, sin crear otra', () => {
  const libro = new LibroMock('mi planilla');
  const { creadas, id } = correrSetup({ activa: libro, conUi: false });

  assert.strictEqual(creadas.length, 0);
  assert.strictEqual(id, libro.getId());
});
