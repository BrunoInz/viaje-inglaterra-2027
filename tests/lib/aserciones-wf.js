'use strict';

/**
 * Aserciones que valen para cualquiera de los tres workflows generados.
 *
 * Todas cubren fallas que n8n NO reporta al importar: un JSON con una conexion
 * colgada o una expresion que nombra un nodo inexistente importa sin error y
 * recien revienta —o peor, calla— al ejecutarse.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const DIR_WORKFLOWS = path.join(RAIZ, 'n8n', 'workflows');
const DIR_SNIPPETS = path.join(RAIZ, 'n8n', 'code-snippets');

const TIPOS_TRIGGER = new Set([
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.manualTrigger',
]);

/**
 * Registra la bateria comun de tests para un workflow generado.
 *
 * @param {object} opciones
 * @param {string} opciones.archivo   nombre del JSON dentro de n8n/workflows/
 * @param {object} opciones.wf        el workflow que devuelve el generador
 * @param {Object<string,string>} [opciones.snippets] nodo Code -> nombre de snippet
 */
function testsComunes({ archivo, wf, snippets = {} }) {
  const ruta = path.join(DIR_WORKFLOWS, archivo);
  const nombres = new Set(wf.nodes.map((n) => n.name));

  test(`${archivo}: el JSON en disco esta sincronizado con el generador`, () => {
    assert.ok(fs.existsSync(ruta), `falta ${ruta} — correr 'npm run build'`);
    assert.strictEqual(fs.readFileSync(ruta, 'utf8'), `${JSON.stringify(wf, null, 2)}\n`,
      `${archivo} quedo desfasado — correr 'npm run build'`);
  });

  test(`${archivo}: los nombres de nodo son unicos`, () => {
    // n8n resuelve $('X') y las conexiones por nombre: dos nodos homonimos
    // hacen que una de las dos referencias apunte al nodo equivocado.
    assert.strictEqual(nombres.size, wf.nodes.length, 'hay nombres de nodo repetidos');
  });

  test(`${archivo}: toda conexion apunta a nodos que existen`, () => {
    for (const [origen, salidas] of Object.entries(wf.connections)) {
      assert.ok(nombres.has(origen), `conexion desde nodo inexistente: ${origen}`);
      for (const rama of salidas.main) {
        for (const destino of rama) {
          assert.ok(nombres.has(destino.node),
            `${origen} conecta a un nodo inexistente: ${destino.node}`);
        }
      }
    }
  });

  test(`${archivo}: todo nodo salvo los triggers recibe al menos una conexion`, () => {
    const alcanzados = new Set();
    for (const salidas of Object.values(wf.connections)) {
      for (const rama of salidas.main) {
        for (const destino of rama) alcanzados.add(destino.node);
      }
    }

    for (const nodo of wf.nodes) {
      if (TIPOS_TRIGGER.has(nodo.type)) continue;
      assert.ok(alcanzados.has(nodo.name), `${nodo.name} quedo huerfano en el grafo`);
    }
  });

  test(`${archivo}: los nodos referenciados por expresion existen con ese nombre exacto`, () => {
    const referencias = new Set();
    const patron = /\$\('([^']+)'\)/g;

    for (const nodo of wf.nodes) {
      const texto = JSON.stringify(nodo.parameters);
      let match;
      while ((match = patron.exec(texto)) !== null) referencias.add(match[1]);
    }

    assert.ok(referencias.size > 0, 'no se detecto ninguna referencia $() — el patron fallo');
    for (const referencia of referencias) {
      assert.ok(nombres.has(referencia),
        `un nodo referencia $('${referencia}') pero no existe un nodo con ese nombre`);
    }
  });

  test(`${archivo}: el JSON no contiene credenciales`, () => {
    const serializado = JSON.stringify(wf);
    const env = fs.readFileSync(path.join(RAIZ, '.env'), 'utf8');

    for (const linea of env.split('\n')) {
      // Los digitos importan: sin ellos N8N_API_KEY quedaba fuera del chequeo.
      const match = linea.match(/^([A-Z0-9_]+)=(.+)$/);
      if (!match) continue;
      const valor = match[2].trim();
      if (valor.length < 8) continue;
      assert.ok(!serializado.includes(valor),
        `el workflow filtra el valor de ${match[1]} — tiene que ir por credencial de n8n`);
    }
  });

  test(`${archivo}: los nodos Code embeben el snippet generado desde lib/`, () => {
    for (const [nombreNodo, nombreSnippet] of Object.entries(snippets)) {
      const nodo = wf.nodes.find((n) => n.name === nombreNodo);
      assert.ok(nodo, `no existe el nodo ${nombreNodo}`);
      const snippet = fs.readFileSync(path.join(DIR_SNIPPETS, `${nombreSnippet}.js`), 'utf8');
      assert.strictEqual(nodo.parameters.jsCode, snippet,
        `${nombreNodo} no coincide con ${nombreSnippet}.js`);
    }
  });

  test(`${archivo}: todo el codigo de los nodos Code es sintacticamente valido`, () => {
    for (const nodo of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
      assert.doesNotThrow(() => new Function(nodo.parameters.jsCode),
        `${nodo.name} genero JavaScript invalido`);
    }
  });

  test(`${archivo}: los nodos de Google Sheets reintentan ante rate limit`, () => {
    // La API de Sheets corta con "receiving too many requests" ante
    // operaciones seguidas. Sin reintentos la ejecucion queda a medias: por
    // ejemplo con los precios guardados pero sin evaluar las alertas.
    for (const nodo of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets')) {
      assert.strictEqual(nodo.retryOnFail, true, `${nodo.name} sin retryOnFail`);
      assert.ok(nodo.maxTries >= 3, `${nodo.name} con pocos reintentos`);
      assert.ok(nodo.waitBetweenTries >= 5000,
        `${nodo.name}: el rate limit se resetea por minuto, esperar menos de 5s no ayuda`);
    }
  });

  test(`${archivo}: el Sheet ID va como placeholder, nunca el real`, () => {
    const sheets = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets');
    assert.ok(sheets.length > 0, 'se esperaba al menos un nodo de Google Sheets');
    for (const nodo of sheets) {
      assert.strictEqual(nodo.parameters.documentId.value, 'REEMPLAZAR_CON_GOOGLE_SHEET_ID',
        `${nodo.name} lleva un documentId que no es el placeholder`);
    }
  });
}

module.exports = { testsComunes, DIR_WORKFLOWS };
