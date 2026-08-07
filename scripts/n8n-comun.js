'use strict';

/**
 * Piezas compartidas por los tres generadores de workflows.
 *
 * Lo unico que vale la pena centralizar es lo que, si se desincroniza entre
 * workflows, rompe en runtime sin aviso: el shape de los nodos de Google
 * Sheets, el aplanado de la pestana `config` y la forma de las conexiones.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const DIR_SNIPPETS = path.join(RAIZ, 'n8n', 'code-snippets');
const DIR_SALIDA = path.join(RAIZ, 'n8n', 'workflows');

// Se reemplaza a mano en n8n despues de importar (Task 7, Step 8). El ID real
// nunca entra al repo: los tests fallan si alguna credencial se cuela.
const SHEET_ID = 'REEMPLAZAR_CON_GOOGLE_SHEET_ID';

const ZONA = 'America/Argentina/Buenos_Aires';

// La pestana `config` es clave/valor —una fila por parametro—, pero los
// snippets hacen $('Leer config').first().json.umbral_usd. Este Code aplana
// esas filas en un unico objeto. Se llama 'Leer config' a proposito: es el
// nombre que los snippets referencian. El nodo de Sheets pasa a 'Leer config
// raw'. Aplica a los tres workflows.
const APLANAR_CONFIG = `// La pestana config es clave/valor: una fila por parametro. Los snippets
// esperan un unico objeto, asi que se aplana aca.
const config = {};

for (const item of $input.all()) {
  if (item.json.clave) config[item.json.clave] = item.json.valor;
}

return [{ json: config }];`;

function leerSnippet(nombre) {
  return fs.readFileSync(path.join(DIR_SNIPPETS, `${nombre}.js`), 'utf8');
}

function hojaSheets(nombreHoja) {
  return {
    documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
    sheetName: { __rl: true, value: nombreHoja, mode: 'name' },
  };
}

function nodoCode(id, nombre, codigo, posicion, notas) {
  return {
    parameters: { mode: 'runOnceForAllItems', jsCode: codigo },
    id,
    name: nombre,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: posicion,
    ...(notas ? { notes: notas } : {}),
  };
}

function conexion(nodo, indiceEntrada = 0) {
  return { node: nodo, type: 'main', index: indiceEntrada };
}

/** Los dos nodos que resuelven la pestana `config`, listos para insertar. */
function nodosConfig({ sufijo = '', posicionRaw, posicionAplanado }) {
  const nombreRaw = `Leer config raw${sufijo}`;
  const nombrePlano = `Leer config${sufijo}`;

  return {
    nombreRaw,
    nombrePlano,
    nodos: [
      {
        parameters: { ...hojaSheets('config'), options: {} },
        id: `sheets-config-raw${sufijo ? '-digest' : ''}`,
        name: nombreRaw,
        type: 'n8n-nodes-base.googleSheets',
        typeVersion: 4.5,
        position: posicionRaw,
      },
      nodoCode(
        `code-aplanar-config${sufijo ? '-digest' : ''}`,
        nombrePlano,
        APLANAR_CONFIG,
        posicionAplanado,
        `Se llama "${nombrePlano}" a proposito: es el nombre que referencian los snippets.`
      ),
    ],
  };
}

/**
 * Agrega reintentos a todos los nodos de Google Sheets.
 *
 * La API de Sheets corta con "The service is receiving too many requests from
 * you" ante lecturas o escrituras seguidas, y es un limite que se toca de
 * verdad: el WF3 hace 9 operaciones por corrida, varias adentro de un loop de
 * 6 ventanas. Sin reintentos, un pico de trafico deja la ejecucion a medias —
 * con precios guardados pero sin evaluar alertas, por ejemplo.
 *
 * 5 intentos cada 5 segundos cubren de sobra la ventana de rate limit, que se
 * resetea por minuto.
 */
function conReintentosDeSheets(nodos) {
  return nodos.map((nodo) => (
    nodo.type === 'n8n-nodes-base.googleSheets'
      ? { ...nodo, retryOnFail: true, maxTries: 5, waitBetweenTries: 5000 }
      : nodo
  ));
}

function escribir(nombreArchivo, workflow) {
  fs.mkdirSync(DIR_SALIDA, { recursive: true });
  const destino = path.join(DIR_SALIDA, nombreArchivo);
  fs.writeFileSync(destino, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
  console.log(`escrito ${destino}`);
}

function settings() {
  return { executionOrder: 'v1', timezone: ZONA, saveManualExecutions: true };
}

module.exports = {
  RAIZ,
  DIR_SALIDA,
  SHEET_ID,
  ZONA,
  APLANAR_CONFIG,
  leerSnippet,
  hojaSheets,
  nodoCode,
  conexion,
  nodosConfig,
  conReintentosDeSheets,
  escribir,
  settings,
};
