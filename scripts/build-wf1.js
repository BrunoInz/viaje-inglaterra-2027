'use strict';

/**
 * Genera n8n/workflows/wf1-fixture-sync.json listo para importar en n8n.
 *
 * Los nodos Code embeben el contenido de n8n/code-snippets/, asi que el
 * workflow nunca queda desincronizado de lib/. Correr 'npm run build' primero.
 *
 * Tres desviaciones deliberadas respecto del plan original, documentadas en
 * los `notes` de cada nodo:
 *
 *  1. football-data devuelve UN item con un array `matches`, no un item por
 *     partido. Los nodos 'Marcar competencia' expanden ese array; el plan
 *     asumia items ya separados y el snippet de normalizacion habria recibido
 *     el objeto contenedor.
 *  2. La pestana `config` es clave/valor, o sea una fila por parametro, pero
 *     los snippets hacen `$('Leer config').first().json.umbral_usd`. Se agrega
 *     un nodo Code que aplana esas filas en un unico objeto. Ese nodo se llama
 *     'Leer config' y el de Google Sheets pasa a 'Leer config raw', para que
 *     los snippets sigan funcionando sin tocarlos.
 *  3. 'Leer fixtures previos' lleva alwaysOutputData. En la primera corrida la
 *     pestana esta vacia y sin esa opcion n8n corta la ejecucion ahi.
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

const ARCHIVO = 'wf1-fixture-sync.json';

// football-data anida los partidos en `matches`. Se expanden aca, antes del
// Merge, porque despues de fusionar las ramas ya no se sabe cual era cual.
function marcarCompetencia(codigo) {
  return `const competencia = '${codigo}';

return $input.all().flatMap((item) => {
  const partidos = Array.isArray(item.json.matches) ? item.json.matches : [item.json];
  return partidos.map((partido) => ({ json: { ...partido, _competencia: competencia } }));
});`;
}

const TEXTO_TELEGRAM = [
  '=⚠️ PARTIDO REPROGRAMADO',
  '',
  'City vs {{ $json.visitante }}',
  'Antes:  {{ $json.fecha_anterior }}',
  'Ahora:  {{ $json.fecha_nueva }}',
  '',
  'Revisá si te rompe alguna ventana de viaje.',
].join('\n');

function nodoHttpFootballData(nombre, competencia, posicion) {
  return {
    parameters: {
      url: `https://api.football-data.org/v4/competitions/${competencia}/matches`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: {},
    },
    id: `http-${competencia.toLowerCase()}`,
    name: nombre,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: posicion,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    notes: 'Credencial Header Auth: nombre X-Auth-Token, valor el token de football-data.org.',
  };
}

function construirWorkflow() {
  const config = nodosConfig({ posicionRaw: [0, 300], posicionAplanado: [220, 300] });

  const nodos = [
    {
      parameters: {
        rule: {
          interval: [{ field: 'weeks', triggerAtDay: [0], triggerAtHour: 8, triggerAtMinute: 0 }],
        },
      },
      id: 'trigger-semanal',
      name: 'Domingos 08:00',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-220, 300],
    },
    ...config.nodos,
    {
      parameters: { ...hojaSheets('fixtures'), options: {} },
      id: 'sheets-fixtures-previos',
      name: 'Leer fixtures previos',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [440, 300],
      alwaysOutputData: true,
      notes: 'alwaysOutputData: en la primera corrida la pestana esta vacia y sin esto la ejecucion corta aca.',
    },
    nodoHttpFootballData('Traer PL', 'PL', [660, 180]),
    nodoHttpFootballData('Traer CL', 'CL', [660, 420]),
    nodoCode('code-marcar-pl', 'Marcar competencia PL', marcarCompetencia('PL'), [880, 180]),
    nodoCode('code-marcar-cl', 'Marcar competencia CL', marcarCompetencia('CL'), [880, 420]),
    {
      parameters: { numberInputs: 2 },
      id: 'merge-competencias',
      name: 'Unir competencias',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3,
      position: [1100, 300],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [
            {
              id: 'cond-city-en-cl',
              leftValue:
                "={{ $json._competencia === 'PL' || ($json.homeTeam && $json.homeTeam.tla === 'MCI') }}",
              rightValue: '',
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            },
          ],
          combinator: 'and',
        },
        looseTypeValidation: true,
        options: {},
      },
      id: 'filter-city-cl',
      name: 'Solo City en CL',
      type: 'n8n-nodes-base.filter',
      typeVersion: 2.2,
      position: [1320, 300],
      notes: 'Champions trae cientos de partidos irrelevantes. Se queda solo con los de City de local.',
    },
    nodoCode(
      'code-normalizar',
      'Normalizar fixtures',
      leerSnippet('wf1-normalizar-fixtures'),
      [1540, 300]
    ),
    nodoCode(
      'code-reprogramaciones',
      'Detectar reprogramaciones',
      leerSnippet('wf1-detectar-reprogramaciones'),
      [1760, 460]
    ),
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [
            {
              id: 'cond-hay-cambio',
              leftValue: '={{ $json.match_id }}',
              rightValue: '',
              operator: { type: 'string', operation: 'notEmpty', singleValue: true },
            },
          ],
          combinator: 'and',
        },
        looseTypeValidation: true,
        options: {},
      },
      id: 'if-hay-reprogramacion',
      name: 'Hay reprogramacion',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1980, 460],
    },
    {
      parameters: {
        chatId: "={{ $('Leer config').first().json.telegram_chat_id }}",
        text: TEXTO_TELEGRAM,
        additionalFields: {},
      },
      id: 'telegram-aviso',
      name: 'Avisar reprogramacion',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [2200, 380],
    },
    {
      parameters: {
        operation: 'appendOrUpdate',
        ...hojaSheets('fixtures'),
        columns: {
          mappingMode: 'autoMapInputData',
          matchingColumns: ['match_id'],
          value: {},
          schema: [],
        },
        options: {},
      },
      id: 'sheets-guardar',
      name: 'Guardar fixtures',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [1760, 200],
    },
  ];

  const connections = {
    'Domingos 08:00': { main: [[conexion('Leer config raw')]] },
    'Leer config raw': { main: [[conexion('Leer config')]] },
    'Leer config': { main: [[conexion('Leer fixtures previos')]] },
    'Leer fixtures previos': { main: [[conexion('Traer PL'), conexion('Traer CL')]] },
    'Traer PL': { main: [[conexion('Marcar competencia PL')]] },
    'Traer CL': { main: [[conexion('Marcar competencia CL')]] },
    'Marcar competencia PL': { main: [[conexion('Unir competencias', 0)]] },
    'Marcar competencia CL': { main: [[conexion('Unir competencias', 1)]] },
    'Unir competencias': { main: [[conexion('Solo City en CL')]] },
    'Solo City en CL': { main: [[conexion('Normalizar fixtures')]] },
    'Normalizar fixtures': {
      main: [[conexion('Guardar fixtures'), conexion('Detectar reprogramaciones')]],
    },
    'Detectar reprogramaciones': { main: [[conexion('Hay reprogramacion')]] },
    // Salida 0 = rama true. La rama false queda sin conectar a proposito.
    'Hay reprogramacion': { main: [[conexion('Avisar reprogramacion')], []] },
  };

  return {
    name: 'WF1 - Fixture Sync',
    nodes: conReintentosDeSheets(nodos),
    connections,
    settings: settings(),
    pinData: {},
  };
}

function build() {
  escribir(ARCHIVO, construirWorkflow());
}

if (require.main === module) build();

module.exports = { construirWorkflow, build };
