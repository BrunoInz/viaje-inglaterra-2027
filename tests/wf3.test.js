const test = require('node:test');
const assert = require('node:assert');
const { construirWorkflow } = require('../scripts/build-wf3');
const { testsComunes } = require('./lib/aserciones-wf');

const wf = construirWorkflow();
const nodo = (nombre) => wf.nodes.find((n) => n.name === nombre);

/** Nodos que alimentan directamente a `destino`. */
function entradasDe(destino) {
  const origenes = [];
  for (const [origen, salidas] of Object.entries(wf.connections)) {
    salidas.main.forEach((rama, indiceSalida) => {
      for (const d of rama) {
        if (d.node === destino) origenes.push({ origen, indiceSalida });
      }
    });
  }
  return origenes;
}

testsComunes({
  archivo: 'wf3-precios.json',
  wf,
  snippets: {
    'Normalizar precios': 'wf3-normalizar-precios',
    'Evaluar alertas': 'wf3-evaluar-alertas',
  },
});

test('el nodo SerpApi que ven los snippets se ejecuta por las dos ramas del IF de cuota', () => {
  // Sin esto, cuando la cuota esta agotada el nodo HTTP se saltea y
  // $('SerpApi').first() lanza en n8n: la rama degradada abortaria entera,
  // que es justo lo contrario de degradar.
  const origenes = entradasDe('SerpApi').map((e) => e.origen).sort();
  assert.deepStrictEqual(origenes, ['Cuota disponible?', 'SerpApi raw'],
    'el consolidador tiene que recibir tanto la rama true como la false');

  const desdeIf = entradasDe('SerpApi').find((e) => e.origen === 'Cuota disponible?');
  assert.strictEqual(desdeIf.indiceSalida, 1, 'la rama false del IF va directo al consolidador');
});

test('el consolidador de SerpApi no explota si la llamada nunca ocurrio', () => {
  const codigo = nodo('SerpApi').parameters.jsCode;
  assert.ok(/try\s*\{/.test(codigo) && /catch/.test(codigo),
    'referenciar un nodo no ejecutado lanza en n8n: hace falta try/catch');
});

test('SerpApi no corta la ejecucion cuando la API falla', () => {
  // Un 429 sin onError mata la ejecucion y ni Level ni Travelpayouts se consultan.
  assert.strictEqual(nodo('SerpApi raw').onError, 'continueRegularOutput');
});

test('la llamada a SerpApi cuelga solo de la rama true del IF de cuota', () => {
  const origenes = entradasDe('SerpApi raw');
  assert.strictEqual(origenes.length, 1);
  assert.strictEqual(origenes[0].origen, 'Cuota disponible?');
  assert.strictEqual(origenes[0].indiceSalida, 0, 'la rama true es la que gasta cuota');
});

test('el flag de cuota guarda el mes, no un booleano', () => {
  // Con un booleano habria que resetearlo a mano cada 1ro de mes.
  const expresion = nodo('Cuota disponible?').parameters.conditions.conditions[0].leftValue;
  assert.ok(expresion.includes('slice(0, 7)'),
    'la comparacion tiene que ser contra YYYY-MM para reactivarse sola al cambiar de mes');

  const valor = nodo('Marcar cuota agotada').parameters.columns.value;
  assert.strictEqual(valor.clave, 'serpapi_agotada_mes');
  assert.ok(valor.valor.includes('slice(0, 7)'), 'se guarda el mes en formato YYYY-MM');
});

test('ninguna API se consulta desde la rama del digest', () => {
  // El digest existe para no gastar cuota. Si colgara de un HTTP, cada domingo
  // se comerian 6 busquedas de SerpApi de gusto.
  const alcanzados = new Set(['Digest']);
  const pendientes = ['Digest'];

  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    for (const rama of (wf.connections[actual] || { main: [] }).main) {
      for (const d of rama) {
        if (!alcanzados.has(d.node)) {
          alcanzados.add(d.node);
          pendientes.push(d.node);
        }
      }
    }
  }

  for (const nombre of alcanzados) {
    const n = nodo(nombre);
    assert.notStrictEqual(n.type, 'n8n-nodes-base.httpRequest',
      `${nombre} es alcanzable desde el digest y consume una API`);
  }
});

test('el loop vuelve a Ventana actual por las dos ramas del IF de alerta', () => {
  // Si solo volviera la rama con alerta, el loop se cortaria en la primera
  // ventana sin precio bajo y las otras cinco no se consultarian nunca.
  const salidas = wf.connections['Hay alerta?'].main;
  assert.strictEqual(salidas.length, 2, 'el IF tiene que tener las dos salidas conectadas');
  assert.deepStrictEqual(salidas[1], [{ node: 'Ventana actual', type: 'main', index: 0 }],
    'la rama sin alerta tiene que devolver el control al loop');

  const vuelven = entradasDe('Ventana actual').map((e) => e.origen);
  assert.ok(vuelven.includes('Marcar alerta'), 'la rama con alerta tampoco puede morir');
  assert.ok(vuelven.includes('Hay alerta?'), 'la rama sin alerta tiene que cerrar el loop');
});

test('leer historico corre una sola vez por ventana, no una por fila guardada', () => {
  // Un nodo de Sheets read se ejecuta UNA VEZ POR ITEM de entrada. 'Guardar
  // precios' emite una fila por fuente, asi que sin executeOnce el historico
  // completo se releeria por cada una, dentro del loop de 6 ventanas: Google
  // corta con "receiving too many requests" y la corrida muere a mitad de
  // camino, con precios guardados pero sin evaluar alertas.
  assert.strictEqual(nodo('Leer historico').executeOnce, true);
});

test('Evaluar alertas emite aunque no haya nada que alertar', () => {
  assert.strictEqual(nodo('Evaluar alertas').alwaysOutputData, true,
    'sin item de salida la rama muere y el loop nunca avanza');
});

test('la salida done del loop queda sin conectar', () => {
  const [done] = wf.connections['Ventana actual'].main;
  assert.deepStrictEqual(done, [], 'la salida 0 del loop no tiene continuacion');
});

test('el loop procesa las ventanas de a una', () => {
  // Los snippets hacen $('Ventana actual').first(): con batch mayor a 1
  // consultarian precios de una ventana y los atribuirian a otra.
  assert.strictEqual(nodo('Ventana actual').parameters.batchSize, 1);
});

test('solo se consultan las ventanas activas', () => {
  for (const nombre of ['Leer ventanas', 'Leer ventanas digest']) {
    const filtros = nodo(nombre).parameters.filtersUI.values;
    assert.deepStrictEqual(filtros, [{ lookupColumn: 'activa', lookupValue: 'TRUE' }],
      `${nombre} tiene que filtrar por activa = TRUE`);
  }
});

test('los precios se appendean, nunca se actualizan', () => {
  // La media movil de 14 dias necesita el historico completo: un
  // appendOrUpdate pisaria el registro del dia anterior.
  assert.strictEqual(nodo('Guardar precios').parameters.operation, 'append');
});

test('marcar alerta escribe ultima_alerta_ts sin tocar el resto de la ventana', () => {
  const marcar = nodo('Marcar alerta');
  const columnas = Object.keys(marcar.parameters.columns.value).sort();

  assert.strictEqual(marcar.parameters.operation, 'appendOrUpdate');
  assert.deepStrictEqual(marcar.parameters.columns.matchingColumns, ['ventana_id']);
  assert.deepStrictEqual(columnas, ['ultima_alerta_ts', 'ventana_id'],
    'escribir mas columnas pisaria el score y las fechas que calcula el WF2');
});

test('marcar alerta no lee el ventana_id del item de Telegram', () => {
  // El nodo de Telegram reemplaza el item por la respuesta de su API, asi que
  // $json.ventana ya no existe a esa altura de la rama.
  const expresion = nodo('Marcar alerta').parameters.columns.value.ventana_id;
  assert.ok(expresion.includes("$('Ventana actual')"),
    'el ventana_id tiene que venir del loop, no del item que dejo Telegram');
});

test('el normalizador de Travelpayouts entrega el campo que el snippet lee', () => {
  // El endpoint devuelve un objeto con fechas como claves, no el array
  // dayPrices de Level, y ademas ignora depart_date.
  const codigo = nodo('Travelpayouts BCN-LON').parameters.jsCode;
  assert.ok(codigo.includes('precio_usd'), 'el snippet hace .json.precio_usd');

  const snippet = nodo('Normalizar precios').parameters.jsCode;
  assert.ok(snippet.includes("$('Travelpayouts BCN-LON').first().json.precio_usd"),
    'cambio el contrato del snippet: revisar el normalizador');
});

test('las dos consultas a Level usan la fecha que les corresponde', () => {
  assert.ok(nodo('Level EZE-BCN').parameters.url.includes('fecha_ida'), 'la ida usa fecha_ida');
  assert.ok(nodo('Level BCN-EZE').parameters.url.includes('fecha_vuelta'),
    'la vuelta usa fecha_vuelta');
  assert.ok(nodo('Level EZE-BCN').parameters.url.includes('origin=EZE&destination=BCN'));
  assert.ok(nodo('Level BCN-EZE').parameters.url.includes('origin=BCN&destination=EZE'));
});

test('ningun nodo HTTP lleva el token en la URL', () => {
  // Los tokens van por credencial de n8n. En la URL viajarian al repo y a los
  // logs de ejecucion de cada corrida.
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
    assert.ok(!/[?&](api_key|token|apikey)=/i.test(n.parameters.url),
      `${n.name} lleva un token en la URL`);
  }
});

test('las APIs con token autentican por credencial; Level va sin auth', () => {
  const esperado = {
    'SerpApi raw': 'httpQueryAuth',          // la key va como parametro api_key
    'Travelpayouts BCN-LON raw': 'httpHeaderAuth', // header X-Access-Token
    'Level EZE-BCN': undefined,              // endpoint publico, no pide nada
    'Level BCN-EZE': undefined,
  };

  for (const [nombre, tipo] of Object.entries(esperado)) {
    const parametros = nodo(nombre).parameters;
    assert.strictEqual(parametros.genericAuthType, tipo,
      `${nombre} tiene el tipo de autenticacion equivocado`);
    assert.strictEqual(parametros.authentication, tipo ? 'genericCredentialType' : undefined,
      `${nombre} no deberia declarar authentication`);
  }
});

test('todas las llamadas externas reintentan ante fallo', () => {
  const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.strictEqual(http.length, 4, 'SerpApi, los dos de Level y Travelpayouts');

  for (const n of http) {
    assert.strictEqual(n.retryOnFail, true, `${n.name} sin retryOnFail`);
    assert.strictEqual(n.maxTries, 3, `${n.name} con maxTries distinto de 3`);
  }
});

test('los dos triggers corren cuando el spec dice', () => {
  const diario = nodo('Diario').parameters.rule.interval[0];
  assert.strictEqual(diario.field, 'days');
  assert.strictEqual(diario.triggerAtHour, 9);

  const digest = nodo('Digest').parameters.rule.interval[0];
  assert.strictEqual(digest.field, 'weeks');
  assert.deepStrictEqual(digest.triggerAtDay, [0]);
  assert.strictEqual(digest.triggerAtHour, 20);
});

test('el digest compara contra el precio de hace una semana, no contra el primero de todos', () => {
  // La pestana precios crece por append: tomar el elemento 0 daria el registro
  // mas viejo del historico y al mes la columna "sem" mentiria.
  const codigo = nodo('Armar digest').parameters.jsCode;
  assert.ok(codigo.includes('ordenados.find('),
    'el previo tiene que salir de la lista ordenada por ts descendente');
  assert.ok(!/haceUnaSemana\[0\]/.test(codigo), 'quedo el acceso por indice al array sin ordenar');
});

test('el workflow corre en la zona horaria de Buenos Aires', () => {
  assert.strictEqual(wf.settings.timezone, 'America/Argentina/Buenos_Aires');
});
