'use strict';

/**
 * Cambia un parametro de la pestana `config`.
 *
 *   node scripts/set-config.js umbral_usd 1150
 *   node scripts/set-config.js serpapi_agotada_mes ""
 *
 * Sirve para ajustar el tracker sin abrir la planilla, y para las pruebas del
 * plan que piden mover el umbral y devolverlo.
 *
 * Solo acepta las claves que el spec define: un tipeo crearia una fila nueva
 * que ningun workflow lee, y el parametro viejo seguiria vigente sin que nada
 * lo avise.
 */

const crypto = require('node:crypto');

const { leerEnv, exigir } = require('./lib-env');
const { crearCliente } = require('./lib-n8n-api');

const CLAVES_VALIDAS = [
  'umbral_usd', 'ventanas_activas', 'dias_viaje', 'pasajeros',
  'clubes_accesibles', 'ciudades_ok', 'costo_noche_bcn',
  'telegram_chat_id', 'serpapi_agotada_mes',
];

async function setConfig(clave, valor) {
  const env = leerEnv();
  const { N8N_BASE_URL, N8N_API_KEY, GOOGLE_SHEET_ID, GOOGLE_SHEETS_CREDENTIAL_ID } =
    exigir(env, ['N8N_BASE_URL', 'N8N_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SHEETS_CREDENTIAL_ID']);

  const cliente = crearCliente({ baseUrl: N8N_BASE_URL, apiKey: N8N_API_KEY });
  const base = N8N_BASE_URL.replace(/\/+$/, '');
  const ruta = `set-config-${crypto.randomUUID()}`;

  const workflow = {
    name: 'ZZ descartable - set config',
    nodes: [
      {
        parameters: { path: ruta, responseMode: 'lastNode', options: {} },
        id: 'webhook',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId: crypto.randomUUID(),
      },
      {
        parameters: {
          operation: 'appendOrUpdate',
          documentId: { __rl: true, value: GOOGLE_SHEET_ID, mode: 'id' },
          sheetName: { __rl: true, value: 'config', mode: 'name' },
          columns: {
            mappingMode: 'defineBelow',
            matchingColumns: ['clave'],
            value: { clave, valor: String(valor) },
            schema: [],
          },
          options: {},
        },
        id: 'escribir',
        name: 'Escribir',
        type: 'n8n-nodes-base.googleSheets',
        typeVersion: 4.5,
        position: [220, 0],
        retryOnFail: true,
        maxTries: 5,
        waitBetweenTries: 5000,
        credentials: {
          googleSheetsOAuth2Api: {
            id: GOOGLE_SHEETS_CREDENTIAL_ID,
            name: env.GOOGLE_SHEETS_CREDENTIAL_NAME || 'Google Sheets account',
          },
        },
      },
    ],
    connections: { Webhook: { main: [[{ node: 'Escribir', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1' },
  };

  let id = null;
  try {
    const creado = await cliente.crearWorkflow(workflow);
    id = creado.id;
    await cliente.activarWorkflow(id);

    const respuesta = await fetch(`${base}/webhook/${ruta}`);
    if (!respuesta.ok) throw new Error(`el webhook respondio HTTP ${respuesta.status}`);

    const cuerpo = await respuesta.text();
    if (/"error"/.test(cuerpo)) throw new Error(cuerpo.slice(0, 200));

    console.log(`config.${clave} = ${valor === '' ? '(vacio)' : valor}`);
  } finally {
    if (id) {
      await cliente.desactivarWorkflow(id).catch(() => {});
      await fetch(`${base}/api/v1/workflows/${id}`, {
        method: 'DELETE',
        headers: { 'X-N8N-API-KEY': N8N_API_KEY },
      }).catch(() => {});
    }
  }
}

async function main() {
  const [clave, ...resto] = process.argv.slice(2);
  const valor = resto.join(' ');

  if (!clave || resto.length === 0) {
    console.error('uso: node scripts/set-config.js <clave> <valor>');
    console.error(`claves: ${CLAVES_VALIDAS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!CLAVES_VALIDAS.includes(clave)) {
    console.error(`'${clave}' no es una clave del spec.`);
    console.error(`claves validas: ${CLAVES_VALIDAS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  await setConfig(clave, valor);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { setConfig, CLAVES_VALIDAS };
