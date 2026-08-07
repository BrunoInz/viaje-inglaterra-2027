'use strict';

/**
 * Valida el contenido de las pestanas contra lo que el spec espera.
 *
 *   node scripts/verificar-datos.js
 *
 * Cubre los pasos de verificacion de las Tasks 8, 9 y 10 del plan. Lee por
 * webhook con un workflow descartable, igual que verificar-planilla.js, porque
 * la API publica de n8n no permite ejecutar nada a mano.
 *
 * Cada chequeo dice que rompe si falla, no solo que fallo.
 */

const crypto = require('node:crypto');

const { leerEnv, exigir } = require('./lib-env');
const { crearCliente } = require('./lib-n8n-api');

const PESTANAS = ['fixtures', 'ventanas', 'precios'];

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
    credentials: { googleSheetsOAuth2Api: { id: credencial.id, name: credencial.name } },
  };
}

/**
 * Separa las filas de los errores de lectura.
 *
 * Con onError + alwaysOutputData, un fallo de la API de Sheets —tipicamente
 * "The service is receiving too many requests from you"— llega como un item
 * mas. Contarlo como fila hace que una pestana vacia parezca tener datos y que
 * una lectura fallida pase por "pestana vacia".
 */
const RECOLECTAR = `
function juntar(nombre) {
  try {
    const items = $(nombre).all().map((i) => i.json);
    const conError = items.find((i) => i && i.error);
    if (conError) return { error: String(conError.error).slice(0, 200), filas: [] };
    return { error: null, filas: items.filter((j) => Object.keys(j).length > 0) };
  } catch (e) {
    return { error: 'nodo no ejecutado: ' + e.message, filas: [] };
  }
}

const salida = {};
${PESTANAS.map((p) => `salida['${p}'] = juntar('${p}');`).join('\n')}
return [{ json: salida }];`;

async function leerPestanas(cliente, base, apiKey, sheetId, credencial) {
  const ruta = `verif-datos-${crypto.randomUUID()}`;
  const nodos = [{
    parameters: { path: ruta, responseMode: 'lastNode', options: {} },
    id: 'webhook', name: 'Webhook', type: 'n8n-nodes-base.webhook',
    typeVersion: 2, position: [0, 0], webhookId: crypto.randomUUID(),
  }];

  const connections = {};
  let previo = 'Webhook';

  PESTANAS.forEach((pestana, i) => {
    nodos.push(nodoLectura(pestana, sheetId, credencial, [220 * (i + 1), 0]));
    connections[previo] = { main: [[{ node: pestana, type: 'main', index: 0 }]] };
    previo = pestana;
  });

  nodos.push({
    parameters: { mode: 'runOnceForAllItems', jsCode: RECOLECTAR },
    id: 'recolectar', name: 'Recolectar', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [220 * (PESTANAS.length + 1), 0],
  });
  connections[previo] = { main: [[{ node: 'Recolectar', type: 'main', index: 0 }]] };

  let id = null;
  try {
    const creado = await cliente.crearWorkflow({
      name: 'ZZ descartable - verificacion de datos',
      nodes: nodos, connections, settings: { executionOrder: 'v1' },
    });
    id = creado.id;
    await cliente.activarWorkflow(id);

    const respuesta = await fetch(`${base}/webhook/${ruta}`);
    return JSON.parse(await respuesta.text());
  } finally {
    if (id) {
      await cliente.desactivarWorkflow(id).catch(() => {});
      await fetch(`${base}/api/v1/workflows/${id}`,
        { method: 'DELETE', headers: { 'X-N8N-API-KEY': apiKey } }).catch(() => {});
    }
  }
}

const chequeos = [];
function chequear(condicion, titulo, siFalla) {
  chequeos.push({ ok: Boolean(condicion), titulo, siFalla });
}

function verificarFixtures(filas) {
  console.log(`\nfixtures: ${filas.length} filas`);
  if (filas.length === 0) {
    console.log('  (vacia — correr: node scripts/ejecutar.js wf1)');
    return;
  }

  const porCompetencia = {};
  for (const f of filas) porCompetencia[f.competencia] = (porCompetencia[f.competencia] || 0) + 1;
  console.log(`  por competencia: ${JSON.stringify(porCompetencia)}`);

  chequear(porCompetencia.PL === 380, 'los 380 partidos de Premier de la temporada',
    `hay ${porCompetencia.PL} de PL en vez de 380`);

  const clNoCity = filas.filter((f) => f.competencia === 'CL' && f.tla_local !== 'MCI');
  chequear(clNoCity.length === 0, "de Champions solo entran los de City de local",
    `${clNoCity.length} partidos de CL sin City de local: el nodo 'Solo City en CL' no filtra`);

  chequear((porCompetencia.CL || 0) > 0, 'hay partidos de City por Champions',
    'sin partidos de CL el bonus de +30 del scoring queda muerto');

  const sinId = filas.filter((f) => !String(f.match_id || '').trim());
  chequear(sinId.length === 0, 'ninguna fila sin match_id',
    `${sinId.length} filas sin match_id: el upsert las duplicaria en cada corrida`);

  const city = filas.filter((f) => f.tla_local === 'MCI');
  const sinCiudad = city.filter((f) => !String(f.ciudad || '').trim());
  chequear(sinCiudad.length === 0, `los ${city.length} partidos de City tienen ciudad`,
    `${sinCiudad.length} sin ciudad: el filtro de accesibilidad geografica los descarta`);

  const ids = new Set(filas.map((f) => String(f.match_id)));
  chequear(ids.size === filas.length, 'no hay match_id duplicados',
    `${filas.length - ids.size} duplicados: el appendOrUpdate no esta matcheando`);
}

function verificarVentanas(filas, config) {
  console.log(`\nventanas: ${filas.length} filas`);
  if (filas.length === 0) {
    console.log('  (vacia — correr: node scripts/ejecutar.js wf2)');
    return;
  }

  const activas = filas.filter((v) => String(v.activa).toUpperCase() === 'TRUE');
  const esperadas = Number(config.ventanas_activas || 6);

  console.log(`  activas: ${activas.length} de ${filas.length}`);
  chequear(activas.length === esperadas, `exactamente ${esperadas} ventanas activas`,
    `hay ${activas.length}: el WF3 consultaria precios de mas o de menos`);

  chequear(filas.length % 3 === 0, 'tres variantes por partido de City',
    `${filas.length} no es multiplo de 3: falta alguna variante de offset`);

  const ids = new Set(filas.map((v) => v.ventana_id));
  chequear(ids.size === filas.length, 'no hay ventana_id duplicados',
    `${filas.length - ids.size} duplicados: se perderia el historico de precios`);

  const ordenadas = [...activas].sort((a, b) => Number(b.score) - Number(a.score));
  if (ordenadas.length > 0) {
    const mejor = ordenadas[0];
    console.log(`  mejor score: ${mejor.score} (${mejor.fecha_ida} → ${mejor.fecha_vuelta})`);

    const extras = String(mejor.partidos_extra || '').split(';').filter(Boolean).length;
    const base = 100 + 20 * extras;
    console.log(`    base 100 + ${extras} extras x20 = ${base}`
      + `, y ${Number(mejor.score) - base} de bonus (champions +30 / temporada baja +10)`);

    const bonus = Number(mejor.score) - base;
    chequear([0, 10, 30, 40].includes(bonus), 'el score se explica por las reglas del spec',
      `el bonus de ${bonus} no es combinacion de +30 champions y +10 temporada baja`);
  }

  const menorActiva = Math.min(...activas.map((v) => Number(v.score)));
  const mayorInactiva = filas.filter((v) => String(v.activa).toUpperCase() !== 'TRUE')
    .reduce((max, v) => Math.max(max, Number(v.score)), -Infinity);

  if (Number.isFinite(mayorInactiva)) {
    chequear(menorActiva >= mayorInactiva, 'las activas son las de mayor score',
      `hay una inactiva con score ${mayorInactiva} por encima de una activa con ${menorActiva}`);
  }
}

function verificarPrecios(filas) {
  console.log(`\nprecios: ${filas.length} filas`);
  if (filas.length === 0) {
    console.log('  (vacia — correr: node scripts/ejecutar.js wf3:diario)');
    return;
  }

  const porEstado = {};
  for (const p of filas) porEstado[p.estado] = (porEstado[p.estado] || 0) + 1;
  console.log(`  por estado: ${JSON.stringify(porEstado)}`);

  const sinVentana = filas.filter((p) => !String(p.ventana_id || '').trim());
  chequear(sinVentana.length === 0, 'ninguna fila sin ventana_id',
    `${sinVentana.length} filas huerfanas: no entran en ninguna media movil`);

  const sinTs = filas.filter((p) => !String(p.ts || '').trim());
  chequear(sinTs.length === 0, 'ninguna fila sin ts',
    `${sinTs.length} sin timestamp: la media movil de 14 dias las ignora`);

  const okConPrecioMalo = filas.filter((p) => p.estado === 'ok'
    && !(Number(p.precio_usd) > 0));
  chequear(okConPrecioMalo.length === 0, 'toda fila ok tiene precio valido',
    `${okConPrecioMalo.length} filas ok sin precio: podrian disparar una alerta falsa`);
}

async function main() {
  const env = leerEnv();
  const { N8N_BASE_URL, N8N_API_KEY, GOOGLE_SHEET_ID, GOOGLE_SHEETS_CREDENTIAL_ID } =
    exigir(env, ['N8N_BASE_URL', 'N8N_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SHEETS_CREDENTIAL_ID']);

  const cliente = crearCliente({ baseUrl: N8N_BASE_URL, apiKey: N8N_API_KEY });
  const base = N8N_BASE_URL.replace(/\/+$/, '');

  const datos = await leerPestanas(cliente, base, N8N_API_KEY, GOOGLE_SHEET_ID, {
    id: GOOGLE_SHEETS_CREDENTIAL_ID,
    name: env.GOOGLE_SHEETS_CREDENTIAL_NAME || 'Google Sheets account',
  });

  // Un error de lectura no es una pestana vacia: sin este corte, los chequeos
  // reportarian "faltan las 6 ventanas activas" cuando el problema es que
  // Google no contesto.
  const ilegibles = PESTANAS.filter((p) => datos[p] && datos[p].error);
  for (const pestana of ilegibles) {
    console.log(`\n${pestana}: NO SE PUDO LEER — ${datos[pestana].error}`);
  }

  if (ilegibles.length > 0) {
    console.log('\nLa API de Sheets limita las lecturas seguidas. Esperar un minuto y reintentar.');
    process.exitCode = 1;
    return;
  }

  verificarFixtures(datos.fixtures.filas);
  verificarVentanas(datos.ventanas.filas, { ventanas_activas: 6 });
  verificarPrecios(datos.precios.filas);

  console.log('\nchequeos:');
  let fallas = 0;
  for (const c of chequeos) {
    console.log(`  ${c.ok ? 'OK   ' : 'FALLA'} ${c.titulo}`);
    if (!c.ok) {
      console.log(`         ${c.siFalla}`);
      fallas += 1;
    }
  }

  console.log(fallas === 0
    ? `\n${chequeos.length}/${chequeos.length} OK.`
    : `\n${fallas} de ${chequeos.length} fallaron.`);
  process.exitCode = fallas === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exitCode = 1;
});
