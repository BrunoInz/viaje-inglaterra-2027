/**
 * Setup de la planilla del tracker (Task 7, Step 5).
 *
 * Uso:
 *   1. Crear un Google Sheet nuevo llamado `tracker-vuelos-inglaterra-2027`.
 *   2. Extensiones -> Apps Script. Pegar este archivo entero, reemplazando lo que haya.
 *   3. Ejecutar la funcion `setupPlanilla`. Aceptar los permisos que pida.
 *   4. Volver al Sheet: quedan las 4 pestanas creadas con sus encabezados.
 *
 * Es idempotente: si una pestana ya existe la reusa y reescribe la fila 1.
 * NO borra datos de las filas 2 en adelante, salvo en `config`, que se
 * reescribe entera porque es la fuente de verdad de los parametros.
 */

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

// El chat_id de Telegram se completa a mano despues de crear el bot.
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

function setupPlanilla() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(ENCABEZADOS).forEach(function (nombre) {
    var hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
    var encabezados = ENCABEZADOS[nombre];

    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
    hoja.setFrozenRows(1);
  });

  poblarConfig(libro.getSheetByName('config'));
  eliminarHojaPorDefecto(libro);

  SpreadsheetApp.getUi().alert(
    'Listo. 4 pestanas creadas.\n\n' +
    'Falta cargar telegram_chat_id en la pestana config.\n\n' +
    'ID de la planilla:\n' + libro.getId()
  );
}

function poblarConfig(hoja) {
  // Se reescribe entera: es la fuente de verdad de los parametros del tracker.
  var filasViejas = hoja.getLastRow() - 1;
  if (filasViejas > 0) {
    hoja.getRange(2, 1, filasViejas, 2).clearContent();
  }

  hoja.getRange(2, 1, FILAS_CONFIG.length, 2).setValues(FILAS_CONFIG);
  hoja.autoResizeColumns(1, 2);
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
