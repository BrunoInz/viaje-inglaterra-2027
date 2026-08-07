/**
 * Setup de la planilla del tracker (Task 7, Step 5).
 *
 * Funciona de las dos maneras:
 *
 *   A) Desde script.google.com (proyecto suelto). Pegar este archivo y ejecutar
 *      `setupPlanilla`: crea la planilla desde cero y deja el ID en el log de
 *      ejecucion (Ver -> Registro de ejecucion).
 *
 *   B) Desde un Sheet ya creado: Extensiones -> Apps Script, pegar y ejecutar.
 *      Usa esa planilla.
 *
 * En el modo A no hay interfaz, asi que `SpreadsheetApp.getUi()` explota y el
 * chat_id no se puede pedir por prompt: completar CHAT_ID_TELEGRAM abajo, o
 * cargarlo despues a mano en la pestana `config`.
 *
 * Para reusar una planilla concreta sin abrirla, poner su ID en ID_PLANILLA.
 *
 * Es idempotente: si una pestana ya existe la reusa y reescribe la fila 1.
 * NO borra datos de las filas 2 en adelante.
 *
 * En `config` reescribe los parametros de configuracion, pero PRESERVA las
 * claves de CLAVES_PRESERVADAS: una la carga Bruno a mano y la otra la escribe
 * el propio WF3. Volver a correr el setup no puede pisarlas.
 */

// Dejar vacio para crear una planilla nueva (o usar la activa, si el script
// esta vinculado a una). Completar con un ID para reusar una existente.
var ID_PLANILLA = '';

// Solo hace falta cuando el script corre sin interfaz. Si queda vacio y hay
// UI, se pide por prompt.
var CHAT_ID_TELEGRAM = '';

var NOMBRE_PLANILLA = 'tracker-vuelos-inglaterra-2027';

var ENCABEZADOS = {
  fixtures: [
    'match_id', 'fecha_utc', 'local', 'visitante', 'tla_local',
    'estadio', 'ciudad', 'competencia', 'estado', 'actualizado_ts',
  ],
  ventanas: [
    'ventana_id', 'fecha_ida', 'fecha_vuelta', 'match_id_city',
    'partidos_extra', 'score', 'activa', 'ultima_alerta_ts',
  ],
  precios: [
    'ts', 'ventana_id', 'ruta', 'fuente', 'precio_usd',
    'aerolinea', 'escalas', 'price_insight', 'estado',
  ],
  config: ['clave', 'valor'],
};

var FILAS_CONFIG = [
  ['umbral_usd', 1150],
  ['ventanas_activas', 6],
  ['dias_viaje', 10],
  ['pasajeros', 2],
  ['clubes_accesibles', 'FUL;BRE;WHU;CRY;WOL;EVE;AVL;BUR;BOU'],
  ['ciudades_ok', 'London;Manchester;Liverpool'],
  ['costo_noche_bcn', 80],
  ['telegram_chat_id', ''],
  ['serpapi_agotada_mes', ''],
];

/**
 * Claves que este script NO puede pisar al volver a correr:
 *
 *  - telegram_chat_id: lo carga Bruno una vez. Perderlo deja al tracker mudo.
 *  - serpapi_agotada_mes: lo escribe el WF3 al quedarse sin cuota. Borrarlo
 *    en pleno mes hace que vuelva a intentar, falle y reavise todos los dias.
 */
var CLAVES_PRESERVADAS = ['telegram_chat_id', 'serpapi_agotada_mes'];

/**
 * Devuelve la interfaz, o null si el script corre suelto.
 *
 * En un proyecto no vinculado a un documento, getUi() lanza en vez de devolver
 * null: sin este try/catch, el setup completo revienta al final, despues de
 * haber creado todo.
 */
function interfaz() {
  try {
    return SpreadsheetApp.getUi();
  } catch (error) {
    return null;
  }
}

function avisar(mensaje) {
  Logger.log(mensaje);
  var ui = interfaz();
  if (ui) ui.alert(mensaje);
}

/**
 * Resuelve sobre que planilla trabajar, en este orden:
 *   1. ID_PLANILLA, si esta seteado
 *   2. la planilla activa, si el script esta vinculado a una
 *   3. una nueva
 *
 * getActiveSpreadsheet() devuelve null —no lanza— en un proyecto suelto, asi
 * que sin este chequeo el error aparece recien al usar la variable, con un
 * "Cannot read properties of null" que no dice nada del problema real.
 */
function resolverPlanilla() {
  if (ID_PLANILLA) {
    Logger.log('usando la planilla ' + ID_PLANILLA);
    return SpreadsheetApp.openById(ID_PLANILLA);
  }

  var activa = SpreadsheetApp.getActiveSpreadsheet();
  if (activa) {
    Logger.log('usando la planilla activa: ' + activa.getName());
    return activa;
  }

  var nueva = SpreadsheetApp.create(NOMBRE_PLANILLA);
  Logger.log('planilla creada: ' + nueva.getUrl());
  return nueva;
}

function setupPlanilla() {
  var libro = resolverPlanilla();

  Object.keys(ENCABEZADOS).forEach(function (nombre) {
    var hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
    var encabezados = ENCABEZADOS[nombre];

    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
    hoja.setFrozenRows(1);
  });

  var chatId = poblarConfig(libro.getSheetByName('config'));
  eliminarHojaPorDefecto(libro);

  avisar(
    'Listo. 4 pestanas creadas.\n\n' +
    (chatId
      ? 'telegram_chat_id cargado: ' + chatId
      : 'FALTA cargar telegram_chat_id en la pestana config.') +
    '\n\nID de la planilla:\n' + libro.getId() +
    '\n\nURL:\n' + libro.getUrl()
  );

  return libro.getId();
}

/** Pide el chat_id por prompt. Devuelve '' si el script corre sin interfaz. */
function pedirChatId() {
  var ui = interfaz();
  if (!ui) {
    Logger.log('sin interfaz: completar CHAT_ID_TELEGRAM o cargarlo a mano en config');
    return '';
  }

  var respuesta = ui.prompt(
    'telegram_chat_id',
    'Pegá el chat_id del bot de Telegram (se saca de /getUpdates). '
      + 'Dejalo vacío si lo querés cargar a mano despues.',
    ui.ButtonSet.OK_CANCEL
  );

  return respuesta.getSelectedButton() === ui.Button.OK
    ? respuesta.getResponseText().trim()
    : '';
}

/** Lee la pestana config y devuelve un objeto clave -> valor. */
function leerConfigActual(hoja) {
  var actual = {};
  var filas = hoja.getLastRow() - 1;
  if (filas <= 0) return actual;

  hoja.getRange(2, 1, filas, 2).getValues().forEach(function (fila) {
    if (fila[0]) actual[String(fila[0])] = fila[1];
  });

  return actual;
}

function poblarConfig(hoja) {
  var actual = leerConfigActual(hoja);

  var filas = FILAS_CONFIG.map(function (fila) {
    var clave = fila[0];
    var yaCargada = CLAVES_PRESERVADAS.indexOf(clave) !== -1
      && actual[clave] !== undefined
      && String(actual[clave]).length > 0;

    return yaCargada ? [clave, actual[clave]] : fila.slice();
  });

  var chatId = filas.filter(function (f) { return f[0] === 'telegram_chat_id'; })[0];

  // Se resuelve una sola vez, y solo si no estaba. Asi el chat_id no vive en el
  // repo ni hay que acordarse de editar la celda despues.
  if (!String(chatId[1])) {
    chatId[1] = CHAT_ID_TELEGRAM || pedirChatId();
  }

  var viejas = hoja.getLastRow() - 1;
  if (viejas > 0) hoja.getRange(2, 1, viejas, 2).clearContent();

  hoja.getRange(2, 1, filas.length, 2).setValues(filas);
  hoja.autoResizeColumns(1, 2);

  return String(chatId[1]);
}

function eliminarHojaPorDefecto(libro) {
  // Google crea 'Hoja 1' / 'Sheet1' al abrir un libro nuevo. Sobra.
  var sobrante = libro.getSheetByName('Hoja 1') ||
                 libro.getSheetByName('Sheet1') ||
                 libro.getSheetByName('Hoja1');

  if (sobrante && libro.getSheets().length > 1) {
    libro.deleteSheet(sobrante);
  }
}
