// tests/precios.test.js
const test = require('node:test');
const assert = require('node:assert');
const { normalizarPrecioGrupo, tieneInventario, precioDelDia, precioViaBarcelona } = require('../lib/precios');

test('normalizarPrecioGrupo divide el total del grupo por los pasajeros', () => {
  assert.strictEqual(normalizarPrecioGrupo(2800, 2), 1400);
});

test('normalizarPrecioGrupo redondea a entero', () => {
  assert.strictEqual(normalizarPrecioGrupo(2801, 2), 1401);
});

test('normalizarPrecioGrupo devuelve null ante entradas invalidas', () => {
  assert.strictEqual(normalizarPrecioGrupo(null, 2), null);
  assert.strictEqual(normalizarPrecioGrupo(2800, 0), null);
});

test('tieneInventario es false cuando todos los dias valen lo mismo', () => {
  // Caso real de Level: marzo 2027 devolvio 902 en los 61 registros.
  const relleno = Array.from({ length: 61 }, (_, i) => ({ date: `2027-03-${i}`, price: 902 }));
  assert.strictEqual(tieneInventario(relleno), false);
});

test('tieneInventario es true cuando hay variacion de precios', () => {
  const real = [{ date: '2026-10-01', price: 469 }, { date: '2026-10-02', price: 902 }];
  assert.strictEqual(tieneInventario(real), true);
});

test('tieneInventario es false ante lista vacia', () => {
  assert.strictEqual(tieneInventario([]), false);
});

test('precioDelDia encuentra el precio de una fecha concreta', () => {
  const dias = [{ date: '2026-10-01', price: 469 }, { date: '2026-10-02', price: 502 }];
  assert.strictEqual(precioDelDia(dias, '2026-10-02'), 502);
});

test('precioDelDia devuelve null si la fecha no esta', () => {
  assert.strictEqual(precioDelDia([{ date: '2026-10-01', price: 469 }], '2026-10-09'), null);
});

test('precioViaBarcelona suma los tres tramos y la noche de hotel', () => {
  const total = precioViaBarcelona({ ezeBcn: 469, bcnEze: 500, bcnLon: 120, costoNocheBcn: 80 });
  assert.strictEqual(total, 1169);
});

test('precioViaBarcelona devuelve null si falta cualquier tramo', () => {
  assert.strictEqual(precioViaBarcelona({ ezeBcn: null, bcnEze: 500, bcnLon: 120, costoNocheBcn: 80 }), null);
  assert.strictEqual(precioViaBarcelona({ ezeBcn: 469, bcnEze: null, bcnLon: 120, costoNocheBcn: 80 }), null);
  assert.strictEqual(precioViaBarcelona({ ezeBcn: 469, bcnEze: 500, bcnLon: null, costoNocheBcn: 80 }), null);
});
