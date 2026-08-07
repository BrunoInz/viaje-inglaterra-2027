const test = require('node:test');
const assert = require('node:assert');
const { construirWorkflow } = require('../scripts/build-wf1');
const { testsComunes } = require('./lib/aserciones-wf');

const wf = construirWorkflow();

testsComunes({
  archivo: 'wf1-fixture-sync.json',
  wf,
  snippets: {
    'Normalizar fixtures': 'wf1-normalizar-fixtures',
    'Detectar reprogramaciones': 'wf1-detectar-reprogramaciones',
  },
});

test('el Merge recibe una rama en cada entrada', () => {
  const entradas = [];
  for (const salidas of Object.values(wf.connections)) {
    for (const rama of salidas.main) {
      for (const destino of rama) {
        if (destino.node === 'Unir competencias') entradas.push(destino.index);
      }
    }
  }

  assert.deepStrictEqual(entradas.sort(), [0, 1],
    'el Merge tiene que recibir exactamente una rama en la entrada 0 y otra en la 1');
});

test('las llamadas a football-data reintentan ante fallo', () => {
  const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.strictEqual(http.length, 2, 'se esperan exactamente 2 nodos HTTP: PL y CL');

  for (const nodo of http) {
    assert.strictEqual(nodo.retryOnFail, true, `${nodo.name} sin retryOnFail`);
    assert.strictEqual(nodo.maxTries, 3, `${nodo.name} con maxTries distinto de 3`);
  }
});

test('se traen las dos competencias: sin CL el bonus de Champions queda muerto', () => {
  const urls = wf.nodes
    .filter((n) => n.type === 'n8n-nodes-base.httpRequest')
    .map((n) => n.parameters.url);

  assert.ok(urls.some((u) => u.includes('/competitions/PL/matches')), 'falta la llamada a PL');
  assert.ok(urls.some((u) => u.includes('/competitions/CL/matches')), 'falta la llamada a CL');
});

test('leer fixtures previos emite datos aunque la pestana este vacia', () => {
  const nodo = wf.nodes.find((n) => n.name === 'Leer fixtures previos');
  assert.strictEqual(nodo.alwaysOutputData, true,
    'sin alwaysOutputData la primera corrida corta ahi, con la pestana vacia');
});
