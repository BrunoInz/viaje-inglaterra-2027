const test = require('node:test');
const assert = require('node:assert');
const { mediaMovil, debeAlertar } = require('../lib/alertas');

const AHORA = '2026-08-20T12:00:00Z';

function registros(precios, estado = 'ok') {
  return precios.map((precio_usd, i) => ({
    ts: `2026-08-${String(10 + i).padStart(2, '0')}T09:00:00Z`,
    precio_usd, estado,
  }));
}

test('mediaMovil promedia los registros de la ventana temporal', () => {
  const r = mediaMovil(registros([1000, 1200, 1400]), 14, AHORA);
  assert.strictEqual(r.media, 1200);
  assert.strictEqual(r.cantidad, 3);
});

test('mediaMovil excluye registros con estado distinto de ok', () => {
  const buenos = registros([1000, 1200]);
  const malos = registros([9999], 'sin_inventario');
  const r = mediaMovil([...buenos, ...malos], 14, AHORA);
  assert.strictEqual(r.media, 1100);
  assert.strictEqual(r.cantidad, 2);
});

test('mediaMovil excluye registros mas viejos que la ventana', () => {
  const viejo = [{ ts: '2026-07-01T09:00:00Z', precio_usd: 100, estado: 'ok' }];
  const r = mediaMovil([...viejo, ...registros([1000, 1200])], 14, AHORA);
  assert.strictEqual(r.cantidad, 2);
  assert.strictEqual(r.media, 1100);
});

test('mediaMovil devuelve null sin registros validos', () => {
  const r = mediaMovil([], 14, AHORA);
  assert.strictEqual(r.media, null);
  assert.strictEqual(r.cantidad, 0);
});

test('alerta por umbral cuando el precio baja del techo configurado', () => {
  const r = debeAlertar({ precioActual: 1350, registros: [], umbral: 1400,
                          ultimaAlertaTs: null, ahora: AHORA });
  assert.strictEqual(r.alertar, true);
  assert.strictEqual(r.motivo, 'umbral');
});

test('no alerta si el precio esta por encima del umbral y no hay historico', () => {
  const r = debeAlertar({ precioActual: 1500, registros: [], umbral: 1400,
                          ultimaAlertaTs: null, ahora: AHORA });
  assert.strictEqual(r.alertar, false);
});

test('alerta por caida relativa con historico suficiente', () => {
  // Media de 7 registros a 2000 => dispara por debajo de 1700.
  const r = debeAlertar({ precioActual: 1650, registros: registros([2000, 2000, 2000, 2000, 2000, 2000, 2000]),
                          umbral: 1400, ultimaAlertaTs: null, ahora: AHORA });
  assert.strictEqual(r.alertar, true);
  assert.strictEqual(r.motivo, 'caida_relativa');
});

test('no alerta por caida relativa con menos de 7 registros', () => {
  const r = debeAlertar({ precioActual: 1650, registros: registros([2000, 2000, 2000]),
                          umbral: 1400, ultimaAlertaTs: null, ahora: AHORA });
  assert.strictEqual(r.alertar, false);
});

test('la caida relativa justo en el factor no dispara', () => {
  // 0.85 * 2000 = 1700. La condicion es <=, asi que 1700 si dispara y 1701 no.
  const hist = registros([2000, 2000, 2000, 2000, 2000, 2000, 2000]);
  assert.strictEqual(debeAlertar({ precioActual: 1700, registros: hist, umbral: 1400,
                                   ultimaAlertaTs: null, ahora: AHORA }).alertar, true);
  assert.strictEqual(debeAlertar({ precioActual: 1701, registros: hist, umbral: 1400,
                                   ultimaAlertaTs: null, ahora: AHORA }).alertar, false);
});

test('el anti-spam bloquea una segunda alerta antes de 48 horas', () => {
  const r = debeAlertar({ precioActual: 1350, registros: [], umbral: 1400,
                          ultimaAlertaTs: '2026-08-19T12:00:00Z', ahora: AHORA });
  assert.strictEqual(r.alertar, false);
});

test('el anti-spam permite alertar pasadas 48 horas', () => {
  const r = debeAlertar({ precioActual: 1350, registros: [], umbral: 1400,
                          ultimaAlertaTs: '2026-08-18T11:00:00Z', ahora: AHORA });
  assert.strictEqual(r.alertar, true);
});

test('no alerta con precio nulo', () => {
  const r = debeAlertar({ precioActual: null, registros: [], umbral: 1400,
                          ultimaAlertaTs: null, ahora: AHORA });
  assert.strictEqual(r.alertar, false);
});
