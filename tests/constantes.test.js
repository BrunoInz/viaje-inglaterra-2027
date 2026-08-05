// tests/constantes.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/constantes');

test('los offsets de variante son los tres del spec', () => {
  assert.deepStrictEqual(C.OFFSETS_VARIANTE, [2, 5, 8]);
});

test('el viaje dura 10 dias', () => {
  assert.strictEqual(C.DIAS_VIAJE, 10);
});

test('los pesos de score coinciden con el spec', () => {
  assert.strictEqual(C.SCORE.BASE, 100);
  assert.strictEqual(C.SCORE.POR_ACCESIBLE, 20);
  assert.strictEqual(C.SCORE.CHAMPIONS, 30);
  assert.strictEqual(C.SCORE.TEMPORADA_BAJA, 10);
});

test('el rango trackeable va de 60 a 320 dias', () => {
  assert.strictEqual(C.RANGO_TRACKEABLE.PISO_DIAS, 60);
  assert.strictEqual(C.RANGO_TRACKEABLE.TECHO_DIAS, 320);
});

test('los parametros de alerta coinciden con el spec', () => {
  assert.strictEqual(C.ALERTA.FACTOR, 0.85);
  assert.strictEqual(C.ALERTA.MIN_REGISTROS, 7);
  assert.strictEqual(C.ALERTA.ANTISPAM_HORAS, 48);
});

test('el mapa de ciudades cubre los clubes accesibles del spec', () => {
  for (const tla of ['MCI', 'FUL', 'BRE', 'WHU', 'CRY', 'WOL', 'EVE', 'AVL', 'BUR', 'BOU']) {
    assert.ok(C.CIUDAD_POR_TLA[tla], `falta la ciudad de ${tla}`);
  }
});
