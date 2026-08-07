'use strict';

/**
 * Genera n8n/workflows/wf3-precios.json listo para importar en n8n.
 *
 * Dos triggers independientes en el mismo workflow: la rama diaria que
 * consulta precios y alerta, y la dominical que manda el digest sin tocar
 * ninguna API.
 *
 * Cuatro desviaciones deliberadas respecto del plan original, todas por cosas
 * que n8n hace y el plan no contemplaba. Cada una queda documentada en el
 * `notes` de su nodo:
 *
 *  1. **`SerpApi raw` + Code `SerpApi`.** El modo degradado saltea el nodo de
 *     SerpApi para no gastar cuota, pero `wf3-normalizar-precios.js` hace
 *     `$('SerpApi').first()`, y en n8n referenciar un nodo que no se ejecuto
 *     lanza error: la rama degradada abortaba entera, que es exactamente lo
 *     contrario de degradar. El HTTP pasa a llamarse `SerpApi raw` y un Code
 *     llamado `SerpApi` recibe las dos ramas del IF y siempre emite algo.
 *  2. **`Travelpayouts BCN-LON raw` + Code `Travelpayouts BCN-LON`.** El
 *     endpoint devuelve un objeto con las fechas como claves —no el array
 *     `dayPrices` de Level— y ademas ignora `depart_date`, asi que responde
 *     cache de cualquier mes. El Code lo aplana a `{ precio_usd }`, que es lo
 *     unico que el snippet lee.
 *  3. **`Evaluar alertas` con alwaysOutputData + IF `Hay alerta?`.** Sin
 *     items, la rama moria ahi y `Ventana actual` nunca recibia la senal para
 *     pasar a la siguiente: el loop procesaba una sola ventana y terminaba en
 *     silencio. Ahora siempre emite y el IF decide si hay algo que avisar.
 *  4. **El delta semanal del digest toma el registro mas reciente de hace 6+
 *     dias**, no el primero del array. La pestana `precios` crece por append,
 *     asi que `[0]` era el registro mas viejo de todos: al mes de trackear, la
 *     columna "sem" comparaba contra el primer dia de historia.
 */

const {
  leerSnippet,
  hojaSheets,
  nodoCode,
  conexion,
  nodosConfig,
  escribir,
  settings,
  conReintentosDeSheets,
} = require('./n8n-comun');

const ARCHIVO = 'wf3-precios.json';

const VENTANA = "$('Ventana actual').first().json";
const CONFIG = "$('Leer config').first().json";

// Ver desviacion 1. El try/catch es lo que hace que la rama degradada siga.
const CONSOLIDAR_SERPAPI = `// Este nodo existe para que 'Normalizar precios' siempre encuentre un nodo
// llamado 'SerpApi' ya ejecutado. Cuando la cuota esta agotada el IF anterior
// saltea la llamada HTTP y entra directo aca: referenciar el nodo salteado
// lanzaria, asi que se captura y se devuelve un objeto vacio.
let datos;

try {
  datos = $('SerpApi raw').first().json || {};
} catch (error) {
  datos = { _sin_llamada: true };
}

return [{ json: datos }];`;

// Ver desviacion 2.
const NORMALIZAR_TRAVELPAYOUTS = `// Travelpayouts devuelve { success, data: { "2027-02-14": { price, ... }, ... } }:
// un objeto con las fechas como claves, no el array dayPrices que usa Level.
// Ademas ignora depart_date y responde cache de cualquier mes, asi que cuando
// la fecha exacta no esta se cae al minimo disponible como referencia.
const respuesta = $input.first().json || {};
const porFecha = respuesta.data && typeof respuesta.data === 'object' ? respuesta.data : {};
const fechaBuscada = ${VENTANA}.fecha_ida;

function aPrecio(entrada) {
  const valor = entrada && typeof entrada === 'object' ? entrada.price : entrada;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

const exacto = aPrecio(porFecha[fechaBuscada]);

const todos = Object.values(porFecha).map(aPrecio).filter((p) => p !== null);
const minimo = todos.length > 0 ? Math.min(...todos) : null;

const precio_usd = exacto !== null ? exacto : minimo;

return [{ json: { precio_usd, fecha_exacta: exacto !== null, dias_en_cache: todos.length } }];`;

// Ver desviacion 4. Este Code no sale de lib/: es puro formateo de salida.
const ARMAR_DIGEST = `const ventanas = $('Leer ventanas digest').all().map((i) => i.json);
const precios = $('Leer precios digest').all().map((i) => i.json);
const ahora = Date.now();
const UNA_SEMANA = 6 * 86400000;

const lineas = ventanas.map((v) => {
  const suyos = precios.filter((p) => p.ventana_id === v.ventana_id && p.estado === 'ok');
  if (suyos.length === 0) return \`\${v.fecha_ida} → \${v.fecha_vuelta} | sin datos aun\`;

  const ordenados = suyos.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const actual = Number(ordenados[0].precio_usd);
  const minimo = Math.min(...suyos.map((p) => Number(p.precio_usd)));

  // El mas RECIENTE de los que ya tienen una semana. Tomar el primero del
  // array daria el registro mas viejo de todo el historico.
  const previo = ordenados.find((p) => ahora - new Date(p.ts).getTime() >= UNA_SEMANA);
  const delta = previo === undefined
    ? '—'
    : (actual > Number(previo.precio_usd)
      ? \`+\${actual - Number(previo.precio_usd)}\`
      : \`\${actual - Number(previo.precio_usd)}\`);

  const extras = String(v.partidos_extra || '').split(';').filter(Boolean).length;
  return \`\${v.fecha_ida} → \${v.fecha_vuelta}\\n  USD \${actual} (min \${minimo}, sem \${delta}) | score \${v.score} | +\${extras} partidos\`;
});

return [{ json: { texto: \`📊 RESUMEN SEMANAL\\n\\n\${lineas.join('\\n\\n')}\` } }];`;

const TEXTO_ALERTA = [
  '=🚨 ALERTA DE PRECIO BAJO 🚨',
  '',
  '✈️ Ruta: {{ $json.ruta }}',
  '📅 Ida: {{ $json.ventana.fecha_ida }}',
  '📅 Vuelta: {{ $json.ventana.fecha_vuelta }}',
  '💰 Precio: USD {{ $json.precio_usd }} por persona',
  '🎯 Motivo: {{ $json.motivo }}',
  '📊 Fuente: {{ $json.fuente }}',
  '⚽ Partido: match {{ $json.ventana.match_id_city }}',
].join('\n');

const TEXTO_CUOTA = [
  '=⚠️ Se agotó la cuota mensual de SerpApi.',
  '',
  'El tracker sigue funcionando con Level y Travelpayouts,',
  'pero sin los datos de Google Flights ni el price insight',
  'hasta que arranque el mes que viene.',
].join('\n');

function nodoTelegram(id, nombre, texto, posicion, nodoConfig, notas) {
  return {
    parameters: {
      chatId: `={{ $('${nodoConfig}').first().json.telegram_chat_id }}`,
      text: texto,
      additionalFields: {},
    },
    id,
    name: nombre,
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    position: posicion,
    ...(notas ? { notes: notas } : {}),
  };
}

function nodoIf(id, nombre, expresion, posicion, notas) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [
          {
            id: `cond-${id}`,
            leftValue: `={{ ${expresion} }}`,
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    id,
    name: nombre,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: posicion,
    ...(notas ? { notes: notas } : {}),
  };
}

function nodoHttp(id, nombre, url, posicion, extra = {}) {
  const { autenticacion, notas, continueOnFail, ...resto } = extra;
  return {
    parameters: {
      url,
      ...(autenticacion
        ? { authentication: 'genericCredentialType', genericAuthType: autenticacion }
        : {}),
      options: {},
    },
    id,
    name: nombre,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: posicion,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    ...(continueOnFail ? { onError: 'continueRegularOutput' } : {}),
    ...(notas ? { notes: notas } : {}),
    ...resto,
  };
}

// El mes de la fecha viene como 'YYYY-MM-DD'; Level pide mes y anio sueltos.
function urlLevel(origen, destino, campoFecha) {
  return `=https://www.flylevel.com/nwe/flights/api/calendar/?triptype=OW&origin=${origen}`
    + `&destination=${destino}`
    + `&month={{ ${VENTANA}.${campoFecha}.split('-')[1] }}`
    + `&year={{ ${VENTANA}.${campoFecha}.split('-')[0] }}`
    + '&currencyCode=USD';
}

function construirRamaDiaria() {
  const config = nodosConfig({ posicionRaw: [0, 0], posicionAplanado: [200, 0] });

  const nodos = [
    {
      parameters: {
        rule: { interval: [{ field: 'days', triggerAtHour: 9, triggerAtMinute: 0 }] },
      },
      id: 'trigger-diario',
      name: 'Diario',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-200, 0],
    },
    ...config.nodos,
    {
      parameters: {
        ...hojaSheets('ventanas'),
        filtersUI: { values: [{ lookupColumn: 'activa', lookupValue: 'TRUE' }] },
        options: {},
      },
      id: 'sheets-ventanas',
      name: 'Leer ventanas',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [400, 0],
      notes: 'Solo las activas: son las 6 que el WF2 marca por score.',
    },
    {
      parameters: { batchSize: 1, options: {} },
      id: 'loop-ventanas',
      name: 'Ventana actual',
      type: 'n8n-nodes-base.splitInBatches',
      typeVersion: 3,
      position: [600, 0],
      notes: 'Salida 0 = done (sin conectar), salida 1 = loop. Batch 1: los snippets '
        + "hacen $('Ventana actual').first() y esperan una sola ventana.",
    },
    nodoIf(
      'if-cuota',
      'Cuota disponible?',
      `${CONFIG}.serpapi_agotada_mes !== new Date().toISOString().slice(0, 7)`,
      [820, 100],
      'El flag guarda el mes (YYYY-MM), no un booleano: al cambiar de mes la comparacion '
        + 'deja de coincidir sola y SerpApi se reactiva sin tocar nada.'
    ),
    nodoHttp(
      'http-serpapi',
      'SerpApi raw',
      '=https://serpapi.com/search?engine=google_flights&departure_id=EZE&arrival_id=LHR'
        + `&outbound_date={{ ${VENTANA}.fecha_ida }}`
        + `&return_date={{ ${VENTANA}.fecha_vuelta }}`
        + `&currency=USD&adults={{ ${CONFIG}.pasajeros }}`,
      [1040, 0],
      {
        autenticacion: 'httpQueryAuth',
        continueOnFail: true,
        notas: 'Credencial Query Auth: nombre api_key, valor la key de SerpApi. '
          + 'onError continueRegularOutput a proposito: sin eso un 429 corta la ejecucion '
          + 'entera y ni Level ni Travelpayouts llegan a consultarse.',
      }
    ),
    nodoCode(
      'code-serpapi',
      'SerpApi',
      CONSOLIDAR_SERPAPI,
      [1260, 100],
      "Se llama 'SerpApi' a proposito: es el nombre que referencia el snippet de normalizacion."
    ),
    nodoIf(
      'if-cuota-agotada',
      'Detectar cuota agotada',
      "$json.error !== undefined && String($json.error).toLowerCase().includes('run out of searches')",
      [1480, 260]
    ),
    {
      parameters: {
        operation: 'appendOrUpdate',
        ...hojaSheets('config'),
        columns: {
          mappingMode: 'defineBelow',
          matchingColumns: ['clave'],
          value: {
            clave: 'serpapi_agotada_mes',
            valor: '={{ new Date().toISOString().slice(0, 7) }}',
          },
          schema: [],
        },
        options: {},
      },
      id: 'sheets-marcar-cuota',
      name: 'Marcar cuota agotada',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [1700, 340],
    },
    nodoTelegram('telegram-cuota', 'Avisar cuota', TEXTO_CUOTA, [1920, 340], config.nombrePlano,
      'Una sola vez por mes: la fila de config bloquea los avisos siguientes.'),
    nodoHttp('http-level-ida', 'Level EZE-BCN', urlLevel('EZE', 'BCN', 'fecha_ida'), [1480, 0]),
    nodoHttp('http-level-vuelta', 'Level BCN-EZE', urlLevel('BCN', 'EZE', 'fecha_vuelta'), [1700, 0]),
    nodoHttp(
      'http-travelpayouts',
      'Travelpayouts BCN-LON raw',
      '=https://api.travelpayouts.com/v1/prices/calendar?origin=BCN&destination=LON'
        + `&depart_date={{ ${VENTANA}.fecha_ida.slice(0, 7) }}`
        + '&calendar_type=departure_date&currency=usd',
      [1920, 0],
      {
        autenticacion: 'httpHeaderAuth',
        notas: 'Credencial Header Auth: nombre X-Access-Token, valor el token de Travelpayouts. '
          + 'Ojo: el endpoint ignora depart_date y responde cache de cualquier mes.',
      }
    ),
    nodoCode(
      'code-travelpayouts',
      'Travelpayouts BCN-LON',
      NORMALIZAR_TRAVELPAYOUTS,
      [2140, 0],
      "Se llama asi a proposito: el snippet hace $('Travelpayouts BCN-LON').first().json.precio_usd."
    ),
    nodoCode('code-normalizar', 'Normalizar precios', leerSnippet('wf3-normalizar-precios'), [2360, 0]),
    {
      parameters: {
        operation: 'append',
        ...hojaSheets('precios'),
        columns: { mappingMode: 'autoMapInputData', matchingColumns: [], value: {}, schema: [] },
        options: {},
      },
      id: 'sheets-guardar-precios',
      name: 'Guardar precios',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [2580, 0],
      notes: 'Append puro: cada corrida agrega historico nuevo, no actualiza lo anterior. '
        + 'La media movil de 14 dias se calcula sobre estas filas.',
    },
    {
      parameters: { ...hojaSheets('precios'), options: {} },
      id: 'sheets-historico',
      name: 'Leer historico',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [2800, 0],
      alwaysOutputData: true,
      // Un nodo de Sheets read corre UNA VEZ POR ITEM de entrada. 'Guardar
      // precios' emite una fila por fuente, asi que sin executeOnce esta
      // lectura se repetiria por cada una, dentro del loop de 6 ventanas, y
      // releeria el historico completo una decena de veces por corrida. Con la
      // pestana creciendo ~12 filas por dia, eso termina en rate limit.
      executeOnce: true,
      notes: 'executeOnce: sin esto se relee el historico entero una vez por fila guardada.',
    },
    nodoCode('code-alertas', 'Evaluar alertas', leerSnippet('wf3-evaluar-alertas'), [3020, 0], undefined),
    nodoIf('if-hay-alerta', 'Hay alerta?', '$json.ventana_id !== undefined && $json.ventana_id !== null && $json.ventana_id !== \'\'', [3240, 0],
      'Evaluar alertas emite un item vacio cuando no hay nada que avisar, para que el loop '
        + 'pueda seguir. Este IF descarta ese item antes de llegar a Telegram.'),
    nodoTelegram('telegram-alerta', 'Alerta', TEXTO_ALERTA, [3460, -100], config.nombrePlano),
    {
      parameters: {
        operation: 'appendOrUpdate',
        ...hojaSheets('ventanas'),
        columns: {
          mappingMode: 'defineBelow',
          matchingColumns: ['ventana_id'],
          value: {
            ventana_id: `={{ ${VENTANA}.ventana_id }}`,
            ultima_alerta_ts: '={{ new Date().toISOString() }}',
          },
          schema: [],
        },
        options: {},
      },
      id: 'sheets-marcar-alerta',
      name: 'Marcar alerta',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [3680, -100],
      notes: 'Sin este nodo el anti-spam de 48h nunca se activa: debeAlertar lee ultima_alerta_ts. '
        + "El ventana_id sale de $('Ventana actual') porque el nodo de Telegram ya reemplazo el item.",
    },
  ];

  // Evaluar alertas tiene que emitir aunque no haya nada que alertar: si no, la
  // rama muere y 'Ventana actual' jamas recibe la senal de pasar a la siguiente.
  nodos.find((n) => n.name === 'Evaluar alertas').alwaysOutputData = true;
  nodos.find((n) => n.name === 'Evaluar alertas').notes =
    'alwaysOutputData: sin item de salida el loop se cortaria en la primera ventana.';

  const connections = {
    Diario: { main: [[conexion(config.nombreRaw)]] },
    [config.nombreRaw]: { main: [[conexion(config.nombrePlano)]] },
    [config.nombrePlano]: { main: [[conexion('Leer ventanas')]] },
    'Leer ventanas': { main: [[conexion('Ventana actual')]] },
    // Salida 0 = done (se deja vacia), salida 1 = loop.
    'Ventana actual': { main: [[], [conexion('Cuota disponible?')]] },
    'Cuota disponible?': { main: [[conexion('SerpApi raw')], [conexion('SerpApi')]] },
    'SerpApi raw': { main: [[conexion('SerpApi')]] },
    'SerpApi': { main: [[conexion('Detectar cuota agotada'), conexion('Level EZE-BCN')]] },
    'Detectar cuota agotada': { main: [[conexion('Marcar cuota agotada')], []] },
    'Marcar cuota agotada': { main: [[conexion('Avisar cuota')]] },
    'Level EZE-BCN': { main: [[conexion('Level BCN-EZE')]] },
    'Level BCN-EZE': { main: [[conexion('Travelpayouts BCN-LON raw')]] },
    'Travelpayouts BCN-LON raw': { main: [[conexion('Travelpayouts BCN-LON')]] },
    'Travelpayouts BCN-LON': { main: [[conexion('Normalizar precios')]] },
    'Normalizar precios': { main: [[conexion('Guardar precios')]] },
    'Guardar precios': { main: [[conexion('Leer historico')]] },
    'Leer historico': { main: [[conexion('Evaluar alertas')]] },
    'Evaluar alertas': { main: [[conexion('Hay alerta?')]] },
    // Las dos ramas vuelven al loop: sin eso solo se procesaria una ventana.
    'Hay alerta?': { main: [[conexion('Alerta')], [conexion('Ventana actual')]] },
    Alerta: { main: [[conexion('Marcar alerta')]] },
    'Marcar alerta': { main: [[conexion('Ventana actual')]] },
  };

  return { nodos, connections };
}

function construirRamaDigest() {
  const config = nodosConfig({
    sufijo: ' digest',
    posicionRaw: [0, 700],
    posicionAplanado: [200, 700],
  });

  const nodos = [
    {
      parameters: {
        rule: {
          interval: [{ field: 'weeks', triggerAtDay: [0], triggerAtHour: 20, triggerAtMinute: 0 }],
        },
      },
      id: 'trigger-digest',
      name: 'Digest',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-200, 700],
      notes: 'No consulta ninguna API: solo relee lo que la rama diaria ya guardo.',
    },
    ...config.nodos,
    {
      parameters: {
        ...hojaSheets('ventanas'),
        filtersUI: { values: [{ lookupColumn: 'activa', lookupValue: 'TRUE' }] },
        options: {},
      },
      id: 'sheets-ventanas-digest',
      name: 'Leer ventanas digest',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [400, 700],
    },
    {
      parameters: { ...hojaSheets('precios'), options: {} },
      id: 'sheets-precios-digest',
      name: 'Leer precios digest',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [600, 700],
      alwaysOutputData: true,
    },
    nodoCode('code-digest', 'Armar digest', ARMAR_DIGEST, [800, 700]),
    nodoTelegram('telegram-digest', 'Enviar digest', '={{ $json.texto }}', [1020, 700],
      config.nombrePlano),
  ];

  const connections = {
    Digest: { main: [[conexion(config.nombreRaw)]] },
    [config.nombreRaw]: { main: [[conexion(config.nombrePlano)]] },
    [config.nombrePlano]: { main: [[conexion('Leer ventanas digest')]] },
    'Leer ventanas digest': { main: [[conexion('Leer precios digest')]] },
    'Leer precios digest': { main: [[conexion('Armar digest')]] },
    'Armar digest': { main: [[conexion('Enviar digest')]] },
  };

  return { nodos, connections };
}

function construirWorkflow() {
  const diaria = construirRamaDiaria();
  const digest = construirRamaDigest();

  return {
    name: 'WF3 - Precios y alertas',
    nodes: conReintentosDeSheets([...diaria.nodos, ...digest.nodos]),
    connections: { ...diaria.connections, ...digest.connections },
    settings: settings(),
    pinData: {},
  };
}

function build() {
  escribir(ARCHIVO, construirWorkflow());
}

if (require.main === module) build();

module.exports = { construirWorkflow, build };
