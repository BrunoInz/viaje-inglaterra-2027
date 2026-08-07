'use strict';

/**
 * Genera n8n/workflows/wf2-ventanas.json listo para importar en n8n.
 *
 * Lee la pestana `fixtures` que puebla el WF1, calcula las ventanas de viaje
 * con el snippet de lib/ventanas.js y las guarda en la pestana `ventanas`.
 *
 * Dos desviaciones deliberadas respecto del plan original, documentadas en los
 * `notes` de cada nodo:
 *
 *  1. La pestana `config` es clave/valor, asi que va el mismo par
 *     'Leer config raw' + Code 'Leer config' del WF1.
 *  2. 'Guardar ventanas' mapea columnas explicitas en vez de autoMapInputData.
 *     El snippet emite `ultima_alerta_ts: null` en cada corrida —contrato del
 *     objeto ventana, verificado en tests/ventanas.test.js—, y con automapeo
 *     Google Sheets escribiria esa columna en blanco todos los domingos,
 *     borrando el anti-spam de 48 horas que el WF3 acaba de registrar. Al
 *     listar las columnas a mano, la de `ultima_alerta_ts` ni se toca y el
 *     valor existente sobrevive.
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

const ARCHIVO = 'wf2-ventanas.json';

// Todas las columnas de la pestana `ventanas` MENOS ultima_alerta_ts, que la
// escribe solo el WF3. Ver la nota 2 del encabezado.
const COLUMNAS_VENTANA = [
  'ventana_id',
  'fecha_ida',
  'fecha_vuelta',
  'match_id_city',
  'partidos_extra',
  'score',
  'activa',
];

function mapeoExplicito(columnas) {
  const value = {};
  for (const columna of columnas) value[columna] = `={{ $json.${columna} }}`;
  return value;
}

function construirWorkflow() {
  const config = nodosConfig({ posicionRaw: [0, 300], posicionAplanado: [220, 300] });

  const nodos = [
    {
      parameters: {
        rule: {
          interval: [{ field: 'weeks', triggerAtDay: [0], triggerAtHour: 8, triggerAtMinute: 30 }],
        },
      },
      id: 'trigger-semanal',
      name: 'Domingos 08:30',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-220, 300],
      notes: 'Media hora despues del WF1: la pestana fixtures ya quedo actualizada.',
    },
    ...config.nodos,
    {
      parameters: { ...hojaSheets('fixtures'), options: {} },
      id: 'sheets-fixtures',
      name: 'Leer fixtures',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [440, 300],
      notes: 'Nombre exacto: el snippet hace $(\'Leer fixtures\').all().',
    },
    nodoCode('code-ventanas', 'Calcular ventanas', leerSnippet('wf2-calcular-ventanas'), [660, 300]),
    {
      parameters: {
        operation: 'appendOrUpdate',
        ...hojaSheets('ventanas'),
        columns: {
          mappingMode: 'defineBelow',
          matchingColumns: ['ventana_id'],
          value: mapeoExplicito(COLUMNAS_VENTANA),
          schema: [],
        },
        options: {},
      },
      id: 'sheets-guardar-ventanas',
      name: 'Guardar ventanas',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [880, 300],
      notes:
        'Mapeo explicito a proposito: con automapeo se escribiria ultima_alerta_ts en blanco '
        + 'cada domingo y el anti-spam de 48h del WF3 se reiniciaria solo.',
    },
  ];

  const connections = {
    'Domingos 08:30': { main: [[conexion(config.nombreRaw)]] },
    [config.nombreRaw]: { main: [[conexion(config.nombrePlano)]] },
    [config.nombrePlano]: { main: [[conexion('Leer fixtures')]] },
    'Leer fixtures': { main: [[conexion('Calcular ventanas')]] },
    'Calcular ventanas': { main: [[conexion('Guardar ventanas')]] },
  };

  return {
    name: 'WF2 - Calculo de ventanas',
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

module.exports = { construirWorkflow, build, COLUMNAS_VENTANA };
