'use strict';

/**
 * Ejecuta uno de los workflows a demanda, sin pasar por la UI.
 *
 *   node scripts/ejecutar.js wf1
 *   node scripts/ejecutar.js wf2
 *   node scripts/ejecutar.js wf3:diario
 *   node scripts/ejecutar.js wf3:digest
 *
 * La API publica de n8n no tiene "correr este workflow", asi que se despliega
 * una COPIA temporal con el Schedule Trigger reemplazado por un Webhook, se la
 * dispara, se sigue la ejecucion y se la borra. Los workflows de verdad no se
 * tocan: siguen inactivos y con su trigger original.
 *
 * Los efectos son reales — escribe en la planilla y puede mandar Telegram —
 * porque de eso se trata verificar.
 */

const crypto = require('node:crypto');

const { leerEnv, exigir } = require('./lib-env');
const { crearCliente } = require('./lib-n8n-api');
const { hidratar, cuerpoApi } = require('./deploy');

const OBJETIVOS = {
  wf1: { generador: './build-wf1', trigger: 'Domingos 08:00' },
  wf2: { generador: './build-wf2', trigger: 'Domingos 08:30' },
  'wf3:diario': { generador: './build-wf3', trigger: 'Diario' },
  'wf3:digest': { generador: './build-wf3', trigger: 'Digest' },
};

const TIPO_TRIGGER = 'n8n-nodes-base.scheduleTrigger';
const ESPERA_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Reemplaza el trigger elegido por un webhook y descarta los demas.
 *
 * El webhook conserva el NOMBRE del trigger original: las conexiones de n8n se
 * resuelven por nombre, asi que renombrarlo dejaria el workflow desconectado.
 */
function ponerWebhook(workflow, nombreTrigger, ruta) {
  const nodes = [];

  for (const nodo of workflow.nodes) {
    if (nodo.type !== TIPO_TRIGGER) {
      nodes.push(nodo);
      continue;
    }

    if (nodo.name !== nombreTrigger) continue; // otro trigger: fuera

    nodes.push({
      parameters: { path: ruta, responseMode: 'onReceived', options: {} },
      id: nodo.id,
      name: nodo.name,
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: nodo.position,
      webhookId: crypto.randomUUID(),
    });
  }

  const vivos = new Set(nodes.map((n) => n.name));
  const connections = Object.fromEntries(
    Object.entries(workflow.connections).filter(([origen]) => vivos.has(origen))
  );

  return { ...workflow, nodes, connections };
}

function describir(ejecucion) {
  const inicio = new Date(ejecucion.startedAt).getTime();
  const fin = ejecucion.stoppedAt ? new Date(ejecucion.stoppedAt).getTime() : Date.now();
  return `${ejecucion.status} en ${Math.round((fin - inicio) / 1000)}s`;
}

/** Busca el mensaje de error mas util dentro de los datos de la ejecucion. */
function detalleDelError(datos) {
  if (!datos) return null;

  const ejecucion = datos.data && datos.data.resultData;
  if (!ejecucion) return null;

  if (ejecucion.error) {
    const nodo = ejecucion.lastNodeExecuted ? ` (nodo '${ejecucion.lastNodeExecuted}')` : '';
    return `${ejecucion.error.message}${nodo}`;
  }

  for (const [nombre, corridas] of Object.entries(ejecucion.runData || {})) {
    for (const corrida of corridas) {
      if (corrida.error) return `${corrida.error.message} (nodo '${nombre}')`;
    }
  }

  return null;
}

/** Cuantos items emitio cada nodo. Es la evidencia de que hizo algo. */
function resumirNodos(datos) {
  const runData = datos && datos.data && datos.data.resultData && datos.data.resultData.runData;
  if (!runData) return [];

  return Object.entries(runData).map(([nombre, corridas]) => {
    const items = corridas.reduce((total, corrida) => {
      const principal = (corrida.data && corrida.data.main) || [];
      return total + principal.reduce((sub, rama) => sub + (rama ? rama.length : 0), 0);
    }, 0);
    return { nombre, items, corridas: corridas.length };
  });
}

async function esperarEjecucion(cliente, workflowId) {
  const limite = Date.now() + TIMEOUT_MS;
  let ultima = null;

  while (Date.now() < limite) {
    const { data } = await cliente.listarEjecuciones(workflowId, 1);

    if (data && data.length > 0) {
      [ultima] = data;
      if (ultima.status !== 'running' && ultima.status !== 'waiting' && ultima.finished !== false) {
        return ultima;
      }
      if (ultima.status !== 'running' && ultima.status !== 'waiting') return ultima;
    }

    process.stdout.write('.');
    await new Promise((resolver) => { setTimeout(resolver, ESPERA_MS); });
  }

  throw new Error(`la ejecucion no termino en ${TIMEOUT_MS / 1000}s`);
}

async function main() {
  const objetivo = process.argv[2];

  if (!OBJETIVOS[objetivo]) {
    console.error(`uso: node scripts/ejecutar.js <${Object.keys(OBJETIVOS).join('|')}>`);
    process.exitCode = 1;
    return;
  }

  const env = leerEnv();
  const { N8N_BASE_URL, N8N_API_KEY } = exigir(env, [
    'N8N_BASE_URL', 'N8N_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SHEETS_CREDENTIAL_ID',
  ]);

  const cliente = crearCliente({ baseUrl: N8N_BASE_URL, apiKey: N8N_API_KEY });
  const base = N8N_BASE_URL.replace(/\/+$/, '');
  const estado = require('../.n8n-deploy.json');

  const credenciales = {
    ...estado.credenciales,
    googleSheets: {
      id: env.GOOGLE_SHEETS_CREDENTIAL_ID,
      name: env.GOOGLE_SHEETS_CREDENTIAL_NAME || 'Google Sheets account',
    },
  };

  const { generador, trigger } = OBJETIVOS[objetivo];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { construirWorkflow } = require(generador);

  const { workflow, pendientes } = hidratar(construirWorkflow(), {
    sheetId: env.GOOGLE_SHEET_ID,
    credenciales,
  });

  if (pendientes.sheetId || pendientes.credenciales.size > 0) {
    throw new Error('faltan Sheet ID o credenciales: correr primero npm run deploy');
  }

  const ruta = `ejecutar-${crypto.randomUUID()}`;
  const temporal = ponerWebhook(workflow, trigger, ruta);
  temporal.name = `ZZ ejecucion manual - ${objetivo}`;

  console.log(`${objetivo}: ${temporal.nodes.length} nodos, disparando por webhook\n`);

  let id = null;

  try {
    const creado = await cliente.crearWorkflow(cuerpoApi(temporal));
    id = creado.id;
    await cliente.activarWorkflow(id);

    const disparo = await fetch(`${base}/webhook/${ruta}`);
    if (!disparo.ok) throw new Error(`el webhook respondio HTTP ${disparo.status}`);

    process.stdout.write('ejecutando');
    const ejecucion = await esperarEjecucion(cliente, id);
    console.log(`\n\n${describir(ejecucion)}\n`);

    const datos = await cliente.obtenerEjecucion(ejecucion.id, true);

    const error = detalleDelError(datos);
    if (error) console.log(`ERROR: ${error}\n`);

    const nodos = resumirNodos(datos);
    if (nodos.length > 0) {
      console.log('items por nodo:');
      for (const n of nodos) {
        const veces = n.corridas > 1 ? ` (${n.corridas} corridas)` : '';
        console.log(`  ${String(n.items).padStart(5)}  ${n.nombre}${veces}`);
      }
    }

    process.exitCode = ejecucion.status === 'success' ? 0 : 1;
  } finally {
    if (id) {
      await cliente.desactivarWorkflow(id).catch(() => {});
      await fetch(`${base}/api/v1/workflows/${id}`, {
        method: 'DELETE',
        headers: { 'X-N8N-API-KEY': N8N_API_KEY },
      }).catch(() => {});
      console.log('\n(workflow temporal borrado)');
    }
  }
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exitCode = 1;
});
