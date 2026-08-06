const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { construirWorkflow } = require('../scripts/build-wf1');

const RUTA = path.join(__dirname, '..', 'n8n', 'workflows', 'wf1-fixture-sync.json');
const wf = construirWorkflow();
const nombres = new Set(wf.nodes.map((n) => n.name));

test('el JSON en disco esta sincronizado con el generador', () => {
  assert.ok(fs.existsSync(RUTA), `falta ${RUTA} — correr 'npm run build'`);
  const enDisco = fs.readFileSync(RUTA, 'utf8');
  assert.strictEqual(enDisco, `${JSON.stringify(wf, null, 2)}\n`,
    "wf1-fixture-sync.json quedo desfasado — correr 'npm run build'");
});

test('toda conexion apunta a nodos que existen', () => {
  // Una conexion a un nodo inexistente importa sin error visible en n8n:
  // el workflow queda con ramas mudas que solo se descubren ejecutandolo.
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

test('todo nodo salvo el trigger recibe al menos una conexion', () => {
  const alcanzados = new Set();
  for (const salidas of Object.values(wf.connections)) {
    for (const rama of salidas.main) {
      for (const destino of rama) alcanzados.add(destino.node);
    }
  }

  for (const nodo of wf.nodes) {
    if (nodo.type === 'n8n-nodes-base.scheduleTrigger') continue;
    assert.ok(alcanzados.has(nodo.name), `${nodo.name} quedo huerfano en el grafo`);
  }
});

test('los nodos referenciados por expresion existen con ese nombre exacto', () => {
  // Los snippets llaman a $('Leer config'), $('Leer fixtures previos') y
  // $('Normalizar fixtures'). Renombrar cualquiera de esos nodos rompe el
  // workflow en runtime sin que nada lo avise antes.
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

test('el JSON no contiene credenciales', () => {
  const serializado = JSON.stringify(wf);
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');

  for (const linea of env.split('\n')) {
    const match = linea.match(/^([A-Z_]+)=(.+)$/);
    if (!match) continue;
    const valor = match[2].trim();
    if (valor.length < 8) continue;
    assert.ok(!serializado.includes(valor),
      `el workflow filtra el valor de ${match[1]} — tiene que ir por credencial de n8n`);
  }
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

test('los nodos Code embeben el snippet generado desde lib/', () => {
  const esperados = {
    'Normalizar fixtures': 'wf1-normalizar-fixtures',
    'Detectar reprogramaciones': 'wf1-detectar-reprogramaciones',
  };

  for (const [nombreNodo, nombreSnippet] of Object.entries(esperados)) {
    const nodo = wf.nodes.find((n) => n.name === nombreNodo);
    const snippet = fs.readFileSync(
      path.join(__dirname, '..', 'n8n', 'code-snippets', `${nombreSnippet}.js`), 'utf8');
    assert.strictEqual(nodo.parameters.jsCode, snippet,
      `${nombreNodo} no coincide con ${nombreSnippet}.js`);
  }
});

test('todo el codigo de los nodos Code es sintacticamente valido', () => {
  for (const nodo of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new Function(nodo.parameters.jsCode),
      `${nodo.name} genero JavaScript invalido`);
  }
});
