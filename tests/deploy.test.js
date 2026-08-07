const test = require('node:test');
const assert = require('node:assert');
const {
  hidratar,
  cuerpoApi,
  CREDENCIALES,
  CREDENCIAL_POR_NODO,
  TIPO_A_CREDENCIAL,
  PLACEHOLDER_SHEET,
} = require('../scripts/deploy');

const GENERADORES = {
  wf1: require('../scripts/build-wf1').construirWorkflow,
  wf2: require('../scripts/build-wf2').construirWorkflow,
  wf3: require('../scripts/build-wf3').construirWorkflow,
};

const CREDS_FALSAS = {
  footballData: { id: 'id-football', name: 'cred football' },
  serpapi: { id: 'id-serpapi', name: 'cred serpapi' },
  travelpayouts: { id: 'id-travelpayouts', name: 'cred travelpayouts' },
  telegram: { id: 'id-telegram', name: 'cred telegram' },
  googleSheets: { id: 'id-sheets', name: 'cred sheets' },
};

function hidratarTodo(clave, opciones = {}) {
  return hidratar(GENERADORES[clave](), {
    sheetId: 'SHEET-DE-PRUEBA',
    credenciales: CREDS_FALSAS,
    ...opciones,
  });
}

test('todo nodo HTTP tiene una credencial asignada en el mapa', () => {
  // Si se agrega un nodo HTTP nuevo y nadie lo mapea, saldria a produccion sin
  // autenticar y fallaria recien al ejecutarse.
  for (const clave of Object.keys(GENERADORES)) {
    for (const nodo of GENERADORES[clave]().nodes) {
      if (nodo.type !== 'n8n-nodes-base.httpRequest') continue;
      if (!nodo.parameters.genericAuthType) continue; // Level va sin auth

      assert.ok(CREDENCIAL_POR_NODO[nodo.name],
        `${clave}: el nodo HTTP '${nodo.name}' no esta en CREDENCIAL_POR_NODO`);
    }
  }
});

test('cada nodo HTTP recibe una credencial del tipo que declara', () => {
  // Hay dos credenciales httpHeaderAuth distintas (football-data y
  // Travelpayouts): cruzarlas daria 403 sin decir por que.
  for (const clave of Object.keys(GENERADORES)) {
    const { workflow } = hidratarTodo(clave);

    for (const nodo of workflow.nodes) {
      if (nodo.type !== 'n8n-nodes-base.httpRequest') continue;

      const tipo = nodo.parameters.genericAuthType;
      if (!tipo) {
        assert.strictEqual(nodo.credentials, undefined,
          `${nodo.name} no declara auth pero se le engancho una credencial`);
        continue;
      }

      assert.ok(nodo.credentials && nodo.credentials[tipo],
        `${nodo.name} quedo sin credencial de tipo ${tipo}`);

      const esperada = CREDENCIALES[CREDENCIAL_POR_NODO[nodo.name]]({
        FOOTBALL_DATA_TOKEN: 'x', SERPAPI_KEY: 'x',
        TRAVELPAYOUTS_TOKEN: 'x', TELEGRAM_BOT_TOKEN: 'x',
      });
      assert.strictEqual(esperada.type, tipo,
        `${nodo.name} espera ${tipo} pero su credencial es ${esperada.type}`);
    }
  }
});

test('los nodos de Telegram y Sheets reciben su credencial', () => {
  for (const clave of Object.keys(GENERADORES)) {
    const { workflow } = hidratarTodo(clave);

    for (const nodo of workflow.nodes) {
      if (nodo.type === 'n8n-nodes-base.telegram') {
        assert.strictEqual(nodo.credentials.telegramApi.id, 'id-telegram',
          `${nodo.name} sin credencial de Telegram`);
      }
      if (nodo.type === 'n8n-nodes-base.googleSheets') {
        assert.strictEqual(nodo.credentials.googleSheetsOAuth2Api.id, 'id-sheets',
          `${nodo.name} sin credencial de Sheets`);
      }
    }
  }
});

test('el placeholder del Sheet ID se reemplaza en todos los nodos de Sheets', () => {
  for (const clave of Object.keys(GENERADORES)) {
    const { workflow } = hidratarTodo(clave);
    const serializado = JSON.stringify(workflow);

    assert.ok(!serializado.includes(PLACEHOLDER_SHEET),
      `${clave}: quedo un nodo con el placeholder sin reemplazar`);

    for (const nodo of workflow.nodes) {
      if (nodo.type !== 'n8n-nodes-base.googleSheets') continue;
      assert.strictEqual(nodo.parameters.documentId.value, 'SHEET-DE-PRUEBA');
    }
  }
});

test('sin Sheet ID se avisa en vez de subir el placeholder en silencio', () => {
  const { pendientes } = hidratarTodo('wf1', { sheetId: undefined });
  assert.strictEqual(pendientes.sheetId, true);
});

test('sin la credencial de Sheets se avisa cuales nodos quedaron sueltos', () => {
  const credenciales = { ...CREDS_FALSAS };
  delete credenciales.googleSheets;

  const { workflow, pendientes } = hidratarTodo('wf2', { credenciales });

  assert.ok(pendientes.credenciales.has('googleSheets'));
  for (const nodo of workflow.nodes) {
    if (nodo.type !== 'n8n-nodes-base.googleSheets') continue;
    assert.strictEqual(nodo.credentials, undefined);
  }
});

test('hidratar no muta el workflow que devuelve el generador', () => {
  // El generador es la fuente de verdad del JSON del repo: si hidratar mutara
  // sus nodos, el proximo build escribiria credenciales al disco.
  const limpio = GENERADORES.wf1();
  const antes = JSON.stringify(limpio);

  hidratar(limpio, { sheetId: 'X', credenciales: CREDS_FALSAS });

  assert.strictEqual(JSON.stringify(limpio), antes,
    'hidratar modifico el workflow original');
});

test('el cuerpo que se manda a la API no lleva campos que n8n rechaza', () => {
  // POST/PUT /workflows devuelve 400 ante id, active, pinData o tags.
  const { workflow } = hidratarTodo('wf3');
  const cuerpo = cuerpoApi(workflow);

  assert.deepStrictEqual(Object.keys(cuerpo).sort(),
    ['connections', 'name', 'nodes', 'settings']);
});

test('cada credencial declara el dominio al que puede viajar su token', () => {
  const env = {
    FOOTBALL_DATA_TOKEN: 'a', SERPAPI_KEY: 'b',
    TRAVELPAYOUTS_TOKEN: 'c', TELEGRAM_BOT_TOKEN: 'd',
  };

  const esperado = {
    footballData: 'api.football-data.org',
    serpapi: 'serpapi.com',
    travelpayouts: 'api.travelpayouts.com',
  };

  for (const [clave, host] of Object.entries(esperado)) {
    const { data } = CREDENCIALES[clave](env);
    assert.strictEqual(data.allowedHttpRequestDomains, 'domains',
      `${clave} deberia restringir el dominio`);
    assert.strictEqual(data.allowedDomains, host);
    assert.ok(!/^https?:\/\//.test(data.allowedDomains),
      `${clave}: n8n rechaza el dominio con esquema, va el host pelado`);
  }
});

test('el mapa por tipo no pisa al mapa por nombre', () => {
  // CREDENCIAL_POR_NODO tiene prioridad: si un nodo cayera en los dos mapas,
  // el orden de resolucion decidiria en silencio cual credencial se usa.
  for (const nombre of Object.keys(CREDENCIAL_POR_NODO)) {
    for (const clave of Object.keys(GENERADORES)) {
      const nodo = GENERADORES[clave]().nodes.find((n) => n.name === nombre);
      if (nodo) {
        assert.ok(!TIPO_A_CREDENCIAL[nodo.type],
          `${nombre} esta en los dos mapas de credenciales`);
      }
    }
  }
});
