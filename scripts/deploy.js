'use strict';

/**
 * Sube los tres workflows a la instancia de n8n.
 *
 *   node scripts/deploy.js --dry-run              # muestra que haria, sin tocar nada
 *   node scripts/deploy.js                        # crea o actualiza todo
 *   node scripts/deploy.js --recrear-credenciales # rota los tokens (borra y recrea)
 *   node scripts/deploy.js --activar              # ademas los deja activos
 *
 * El repo guarda los JSON limpios: con el Sheet ID como placeholder y sin
 * ningun `credentials`. Este script los hidrata en memoria justo antes de
 * subirlos, asi los secretos nunca tocan el disco del proyecto.
 *
 * Es idempotente. El mapa de IDs va a .n8n-deploy.json (gitignoreado), pero
 * ademas se busca por nombre en la instancia: si ese archivo se pierde, el
 * deploy actualiza los workflows existentes en vez de duplicarlos.
 *
 * Los workflows se suben SIEMPRE desactivados. Activarlos es una decision
 * aparte, despues de correrlos a mano y verificar la salida.
 */

const fs = require('node:fs');
const path = require('node:path');

const { leerEnv, exigir } = require('./lib-env');
const { crearCliente } = require('./lib-n8n-api');

const RAIZ = path.join(__dirname, '..');
const RUTA_ESTADO = path.join(RAIZ, '.n8n-deploy.json');
const PLACEHOLDER_SHEET = 'REEMPLAZAR_CON_GOOGLE_SHEET_ID';

const WORKFLOWS = [
  { clave: 'wf1', generador: './build-wf1' },
  { clave: 'wf2', generador: './build-wf2' },
  { clave: 'wf3', generador: './build-wf3' },
];

/**
 * Cada token queda atado al dominio al que pertenece.
 *
 * n8n ofrece 'all' (mandar la credencial a donde sea), 'none' o 'domains' con
 * una lista. Se usa 'domains': si alguien edita la URL de un nodo por error o
 * de mas, el token no viaja a un host ajeno.
 *
 * Dos trampas del schema, las dos verificadas contra la instancia:
 *
 *  - Omitir `allowedHttpRequestDomains` da 400. El `if` del schema mira
 *    `properties.allowedHttpRequestDomains.enum` y, si la propiedad no esta,
 *    se cumple vacuamente y termina exigiendo `allowedDomains`.
 *  - El valor va como **host pelado**, sin esquema ni path. Con
 *    'https://api.football-data.org' n8n rechaza la llamada con "Domain not
 *    allowed", y con 'https://api.football-data.org/*' tambien. Andan
 *    'api.football-data.org' y '*.football-data.org'.
 */
function soloDominio(host) {
  return { allowedHttpRequestDomains: 'domains', allowedDomains: host };
}

/** Credenciales que se pueden crear por API: las que son solo un token. */
const CREDENCIALES = {
  footballData: (env) => ({
    name: 'Tracker Vuelos - football-data.org',
    type: 'httpHeaderAuth',
    data: {
      name: 'X-Auth-Token',
      value: env.FOOTBALL_DATA_TOKEN,
      ...soloDominio('api.football-data.org'),
    },
  }),
  serpapi: (env) => ({
    name: 'Tracker Vuelos - SerpApi',
    type: 'httpQueryAuth',
    data: {
      name: 'api_key',
      value: env.SERPAPI_KEY,
      ...soloDominio('serpapi.com'),
    },
  }),
  travelpayouts: (env) => ({
    name: 'Tracker Vuelos - Travelpayouts',
    type: 'httpHeaderAuth',
    data: {
      name: 'X-Access-Token',
      value: env.TRAVELPAYOUTS_TOKEN,
      ...soloDominio('api.travelpayouts.com'),
    },
  }),
  telegram: (env) => ({
    name: 'Tracker Vuelos - Telegram',
    type: 'telegramApi',
    data: { accessToken: env.TELEGRAM_BOT_TOKEN },
  }),
};

/**
 * Los nodos HTTP no se pueden resolver por tipo: hay dos credenciales
 * httpHeaderAuth distintas (football-data y Travelpayouts) y engancharlas al
 * reves daria 403 sin decir por que.
 */
const CREDENCIAL_POR_NODO = {
  'Traer PL': 'footballData',
  'Traer CL': 'footballData',
  'SerpApi raw': 'serpapi',
  'Travelpayouts BCN-LON raw': 'travelpayouts',
};

const TIPO_A_CREDENCIAL = {
  'n8n-nodes-base.telegram': 'telegram',
};

function leerEstado() {
  if (!fs.existsSync(RUTA_ESTADO)) return { credenciales: {}, workflows: {} };

  try {
    const guardado = JSON.parse(fs.readFileSync(RUTA_ESTADO, 'utf8'));
    return {
      credenciales: guardado.credenciales || {},
      workflows: guardado.workflows || {},
    };
  } catch (error) {
    console.warn(`  aviso: ${RUTA_ESTADO} ilegible (${error.message}), se reconstruye`);
    return { credenciales: {}, workflows: {} };
  }
}

function guardarEstado(estado) {
  fs.writeFileSync(RUTA_ESTADO, `${JSON.stringify(estado, null, 2)}\n`, 'utf8');
}

/**
 * La API publica de n8n no tiene update de credenciales: solo POST y DELETE.
 * Para cambiar un token o la lista de dominios hay que borrar y volver a
 * crear, y despues re-subir los workflows porque cambian los ids.
 */
async function recrearCredenciales(cliente, estado, dryRun) {
  const claves = Object.keys(estado.credenciales);
  if (claves.length === 0) return;

  console.log('  recreando credenciales existentes:');

  for (const clave of claves) {
    const { id, name } = estado.credenciales[clave];

    if (dryRun) {
      console.log(`  - ${name} (${id}) [dry-run]`);
      continue;
    }

    try {
      await cliente.borrarCredencial(id);
      console.log(`  - ${name} (${id}) borrada`);
    } catch (error) {
      // Si ya no existe en la instancia, alcanza con olvidarla del estado.
      console.log(`  - ${name} (${id}): ${error.message}`);
    }

    delete estado.credenciales[clave];
  }

  if (!dryRun) guardarEstado(estado);
}

async function asegurarCredenciales(cliente, env, estado, dryRun) {
  const resueltas = {};

  for (const [clave, definir] of Object.entries(CREDENCIALES)) {
    const definicion = definir(env);

    if (estado.credenciales[clave]) {
      resueltas[clave] = estado.credenciales[clave];
      console.log(`  = ${definicion.name} (ya creada)`);
      continue;
    }

    if (dryRun) {
      console.log(`  + ${definicion.name} (${definicion.type}) [dry-run]`);
      resueltas[clave] = { id: `DRY-${clave}`, name: definicion.name };
      continue;
    }

    const creada = await cliente.crearCredencial(definicion);
    resueltas[clave] = { id: creada.id, name: definicion.name };
    estado.credenciales[clave] = resueltas[clave];
    guardarEstado(estado);
    console.log(`  + ${definicion.name} (${definicion.type}) -> ${creada.id}`);
  }

  // Google Sheets usa OAuth2: el consentimiento pasa por el navegador, asi que
  // la credencial se crea a mano en la UI y aca solo se referencia su id.
  if (env.GOOGLE_SHEETS_CREDENTIAL_ID) {
    resueltas.googleSheets = {
      id: env.GOOGLE_SHEETS_CREDENTIAL_ID,
      name: env.GOOGLE_SHEETS_CREDENTIAL_NAME || 'Google Sheets account',
    };
    console.log('  = Google Sheets OAuth2 (id tomado del .env)');
  } else {
    console.log('  ! Google Sheets OAuth2: sin GOOGLE_SHEETS_CREDENTIAL_ID en .env');
    console.log('    los nodos de Sheets van a quedar sin credencial enganchada');
  }

  return resueltas;
}

/** Devuelve una copia del workflow con Sheet ID y credenciales inyectados. */
function hidratar(wf, { sheetId, credenciales }) {
  const pendientes = { sheetId: false, credenciales: new Set() };

  const nodes = wf.nodes.map((nodo) => {
    const copia = JSON.parse(JSON.stringify(nodo));

    if (copia.parameters && copia.parameters.documentId) {
      if (sheetId) {
        copia.parameters.documentId = { ...copia.parameters.documentId, value: sheetId };
      } else {
        pendientes.sheetId = true;
      }
    }

    const clave = CREDENCIAL_POR_NODO[copia.name]
      || TIPO_A_CREDENCIAL[copia.type]
      || (copia.type === 'n8n-nodes-base.googleSheets' ? 'googleSheets' : null);

    if (clave) {
      const credencial = credenciales[clave];
      if (credencial) {
        const tipo = copia.parameters.genericAuthType
          || (clave === 'googleSheets' ? 'googleSheetsOAuth2Api' : 'telegramApi');
        copia.credentials = { [tipo]: { id: credencial.id, name: credencial.name } };
      } else {
        pendientes.credenciales.add(clave);
      }
    }

    return copia;
  });

  return { workflow: { ...wf, nodes }, pendientes };
}

/**
 * n8n rechaza campos que no estan en el schema de la API publica (`id`,
 * `active`, `pinData`, `tags`). Se manda solo lo que acepta.
 */
function cuerpoApi(wf) {
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
  };
}

async function subir(cliente, cuerpo, existente, dryRun) {
  if (dryRun) return { id: existente ? existente.id : 'DRY-nuevo', accion: existente ? 'actualizado' : 'creado' };

  if (!existente) {
    const creado = await cliente.crearWorkflow(cuerpo);
    return { id: creado.id, accion: 'creado' };
  }

  // Un PUT sobre un workflow activo devuelve 500 en esta version de n8n.
  if (existente.active) {
    await cliente.desactivarWorkflow(existente.id);
    console.log(`    (se desactivo para poder editarlo)`);
  }

  await cliente.actualizarWorkflow(existente.id, cuerpo);
  return { id: existente.id, accion: 'actualizado' };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const activar = process.argv.includes('--activar');
  if (dryRun) console.log('MODO DRY-RUN: no se escribe nada en n8n\n');

  const env = leerEnv();
  const { N8N_BASE_URL, N8N_API_KEY } = exigir(env, ['N8N_BASE_URL', 'N8N_API_KEY']);
  exigir(env, ['FOOTBALL_DATA_TOKEN', 'SERPAPI_KEY', 'TRAVELPAYOUTS_TOKEN', 'TELEGRAM_BOT_TOKEN']);

  const cliente = crearCliente({ baseUrl: N8N_BASE_URL, apiKey: N8N_API_KEY });
  const estado = leerEstado();

  console.log(`instancia: ${N8N_BASE_URL}\n`);

  console.log('credenciales:');
  if (process.argv.includes('--recrear-credenciales')) {
    await recrearCredenciales(cliente, estado, dryRun);
  }
  const credenciales = await asegurarCredenciales(cliente, env, estado, dryRun);

  console.log('\nworkflows:');
  const existentes = await cliente.listarWorkflows();
  const porNombre = new Map(existentes.map((w) => [w.name, w]));

  const pendientesGlobales = { sheetId: false, credenciales: new Set() };

  for (const { clave, generador } of WORKFLOWS) {
    // eslint-disable-next-line global-require
    const { construirWorkflow } = require(generador);
    const limpio = construirWorkflow();

    const { workflow, pendientes } = hidratar(limpio, {
      sheetId: env.GOOGLE_SHEET_ID,
      credenciales,
    });

    if (pendientes.sheetId) pendientesGlobales.sheetId = true;
    for (const p of pendientes.credenciales) pendientesGlobales.credenciales.add(p);

    const existente = estado.workflows[clave]
      ? existentes.find((w) => w.id === estado.workflows[clave]) || porNombre.get(workflow.name)
      : porNombre.get(workflow.name);

    const { id, accion } = await subir(cliente, cuerpoApi(workflow), existente, dryRun);

    if (!dryRun) {
      estado.workflows[clave] = id;
      guardarEstado(estado);
    }

    // Activar es una decision aparte: por defecto quedan inactivos para poder
    // correrlos a mano con scripts/ejecutar.js y mirar la salida antes de
    // dejarlos sueltos contra la planilla y Telegram.
    let situacion = 'inactivo';
    if (activar && !dryRun) {
      await cliente.activarWorkflow(id);
      situacion = 'ACTIVO';
    } else if (activar) {
      situacion = 'se activaria';
    }

    console.log(`  ${accion === 'creado' ? '+' : '~'} ${workflow.name} -> ${id} (${accion}, ${situacion})`);
  }

  console.log('\nlisto.');

  if (pendientesGlobales.sheetId || pendientesGlobales.credenciales.size > 0) {
    console.log('\nFALTA para que funcionen:');
    if (pendientesGlobales.sheetId) {
      console.log('  - GOOGLE_SHEET_ID en .env (los nodos de Sheets quedaron con el placeholder)');
    }
    for (const clave of pendientesGlobales.credenciales) {
      console.log(`  - credencial '${clave}' sin enganchar`);
    }
    console.log('  Completar y volver a correr: node scripts/deploy.js');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  hidratar,
  cuerpoApi,
  CREDENCIALES,
  CREDENCIAL_POR_NODO,
  TIPO_A_CREDENCIAL,
  PLACEHOLDER_SHEET,
};
