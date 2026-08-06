const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SNIPPETS, construirSnippet } = require('../scripts/build-snippets');

const DIR = path.join(__dirname, '..', 'n8n', 'code-snippets');

for (const snippet of SNIPPETS) {
  test(`el snippet ${snippet.nombre} esta sincronizado con lib/`, () => {
    const ruta = path.join(DIR, `${snippet.nombre}.js`);
    assert.ok(fs.existsSync(ruta), `falta ${ruta} — correr 'npm run build'`);
    const enDisco = fs.readFileSync(ruta, 'utf8');
    const esperado = construirSnippet(snippet.nombre);
    assert.strictEqual(enDisco, esperado,
      `${snippet.nombre} quedo desfasado de lib/ — correr 'npm run build'`);
  });
}

test('ningun snippet contiene require de modulos locales', () => {
  for (const snippet of SNIPPETS) {
    const contenido = construirSnippet(snippet.nombre);
    assert.ok(!/require\(['"]\.\.?\//.test(contenido),
      `${snippet.nombre} tiene un require local, no va a correr en n8n`);
  }
});

test('todos los snippets son sintacticamente validos', () => {
  // Sin esta verificacion, un snippet mal concatenado —por ejemplo, por un
  // require multilinea que dejo un 'const {' huerfano— recien fallaria al
  // pegarlo en n8n, lejos de donde se puede diagnosticar.
  //
  // Se usa new Function y no vm.Script ni 'node --check': los wrappers
  // terminan en 'return', que es ilegal en el top level de un script pero
  // valido dentro de un cuerpo de funcion, que es exactamente como n8n
  // ejecuta el codigo de un nodo Code.
  for (const snippet of SNIPPETS) {
    const contenido = construirSnippet(snippet.nombre);
    assert.doesNotThrow(() => new Function(contenido),
      `${snippet.nombre} genero JavaScript invalido`);
  }
});
