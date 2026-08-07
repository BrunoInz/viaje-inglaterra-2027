'use strict';

/**
 * Verificacion de punta a punta de la planilla (Task 7, Step 7).
 *
 *   node scripts/verificar-planilla.js
 *
 * Comprueba, desde n8n y con la credencial real, que:
 *   - la credencial de Google Sheets tiene acceso a la planilla
 *   - existen las 4 pestanas
 *   - `config` tiene los 9 parametros, con umbral_usd y telegram_chat_id cargados
 *
 * Es la unica forma de probar el acceso sin ejecutar los workflows de verdad:
 * la API publica de n8n no permite correr un workflow a mano, asi que se crea
 * uno descartable con un webhook, se llama, y se borra pase lo que pase.
 */

const crypto = require('node:crypto');

const { leerEnv, exigir } = require('./lib-env');
const { crearCliente } = require('./lib-n8n-api');

const PESTANAS = ['config', 'fixtures', 'ventanas', 'precios'];

const CLAVES_ESPERADAS = [
  'umbral_usd', 'ventanas_activas', 'dias_viaje', 'pasajeros',
  'clubes_accesibles', 'ciudades_ok', 'costo_noche_bcn',
  'telegram_chat_id', 'serpapi_agotada_mes',
];

function nodoLectura(pestana, sheetId, credencial, posicion) {
  return {
    parameters: {
      documentId: { __rl: true, value: sheetId, mode: 'id' },
      sheetName: { __rl: true, value: pestana, mode: 'name' },
      options: {},
    },
    id: `lee-${pestana}`,
    name: pestana,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: posicion,
    alwaysOutputData: true,
    // Un nodo de Sheets read corre UNA VEZ POR ITEM de entrada: sin esto, la
    // lectura encadenada detras de una pestana de 385 filas dispara 385
    // llamadas y Google corta por rate limit.
    executeOnce: true,
    onError: 'continueRegularOutput',
    // La API de Sheets corta ante lecturas seguidas; el limite se resetea por minuto.
    retryOnFail: true,
    maxTries: 5,
    waitBetweenTries: 8000,
    credentials: {
      googleSheetsOAuth2Api: { id: credencial.id, name: credencial.name },
    },
  };
}

const RESUMEN = `
function leer(nombre) {
  try {
    const items = $(nombre).all().map((i) => i.json);
    const primero = items[0] || {};
    if (primero.error) return { ok: false, detalle: String(primero.error).slice(0, 200) };
    return { ok: true, filas: items.filter((i) => Object.keys(i).length > 0).length, items };
  } catch (e) {
    return { ok: false, detalle: 'nodo no ejecutado' };
  }
}

const salida = {};
${PESTANAS.map((p) => `salida['${p}'] = leer('${p}');`).join('\n')}

const c = salida.config;
if (c.ok) {
  c.parametros = {};
  for (const fila of c.items) {
    if (fila.clave) c.parametros[fila.clave] = fila.valor;
  }
}
for (const k of Object.keys(salida)) delete salida[k].items;

return [{ json: salida }];`;

async function main() {
  const env = leerEnv();
  const { N8N_BASE_URL, N8N_API_KEY, GOOGLE_SHEET_ID, GOOGLE_SHEETS_CREDENTIAL_ID } =
    exigir(env, ['N8N_BASE_URL', 'N8N_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SHEETS_CREDENTIAL_ID']);

  const cliente = crearCliente({ baseUrl: N8N_BASE_URL, apiKey: N8N_API_KEY });
  const base = N8N_BASE_URL.replace(/\/+$/, '');
  const credencial = {
    id: GOOGLE_SHEETS_CREDENTIAL_ID,
    name: env.GOOGLE_SHEETS_CREDENTIAL_NAME || 'Google Sheets account',
  };

  const ruta = `verif-planilla-${crypto.randomUUID()}`;
  const nodos = [{
    parameters: { path: ruta, responseMode: 'lastNode', options: {} },
    id: 'webhook',
    name: 'Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 0],
    webhookId: crypto.randomUUID(),
  }];

  const connections = {};
  let previo = 'Webhook';

  PESTANAS.forEach((pestana, i) => {
    nodos.push(nodoLectura(pestana, GOOGLE_SHEET_ID, credencial, [220 * (i + 1), 0]));
    connections[previo] = { main: [[{ node: pestana, type: 'main', index: 0 }]] };
    previo = pestana;
  });

  nodos.push({
    parameters: { mode: 'runOnceForAllItems', jsCode: RESUMEN },
    id: 'resumen',
    name: 'Resumen',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [220 * (PESTANAS.length + 1), 0],
  });
  connections[previo] = { main: [[{ node: 'Resumen', type: 'main', index: 0 }]] };

  let id = null;
  let fallas = 0;

  try {
    const creado = await cliente.crearWorkflow({
      name: 'ZZ descartable - verificacion de planilla',
      nodes: nodos,
      connections,
      settings: { executionOrder: 'v1' },
    });
    id = creado.id;
    await cliente.activarWorkflow(id);

    const respuesta = await fetch(`${base}/webhook/${ruta}`);
    const datos = JSON.parse(await respuesta.text());

    console.log(`planilla ${GOOGLE_SHEET_ID}`);
    console.log(`credencial "${credencial.name}"\n`);

    for (const pestana of PESTANAS) {
      const r = datos[pestana];
      if (!r.ok) {
        console.log(`  FALLA  ${pestana.padEnd(10)} ${r.detalle}`);
        fallas += 1;
      } else {
        console.log(`  OK     ${pestana.padEnd(10)} ${r.filas} fila(s) con datos`);
      }
    }

    const parametros = (datos.config && datos.config.parametros) || {};
    if (datos.config && datos.config.ok) {
      console.log('\nconfig:');

      const faltantes = CLAVES_ESPERADAS.filter((c) => !(c in parametros));
      if (faltantes.length > 0) {
        console.log(`  FALTAN claves: ${faltantes.join(', ')}`);
        fallas += 1;
      }

      for (const clave of CLAVES_ESPERADAS) {
        if (!(clave in parametros)) continue;
        const valor = String(parametros[clave]);
        // serpapi_agotada_mes arranca vacia a proposito.
        const vacia = valor === '' && clave !== 'serpapi_agotada_mes';
        if (vacia) fallas += 1;
        console.log(`  ${vacia ? '!' : ' '} ${clave.padEnd(20)} ${valor || '(vacio)'}`);
      }

      if (String(parametros.umbral_usd) !== '1150') {
        console.log(`\n  ! umbral_usd es ${parametros.umbral_usd}, el spec dice 1150`);
      }
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    fallas += 1;
  } finally {
    if (id) {
      await cliente.desactivarWorkflow(id).catch(() => {});
      await fetch(`${base}/api/v1/workflows/${id}`, {
        method: 'DELETE',
        headers: { 'X-N8N-API-KEY': N8N_API_KEY },
      }).catch(() => {});
    }
  }

  console.log(fallas === 0 ? '\nOK: la planilla esta lista.' : `\n${fallas} problema(s).`);
  process.exitCode = fallas === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exitCode = 1;
});
