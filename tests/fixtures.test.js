const test = require('node:test');
const assert = require('node:assert');
const { normalizarPartido, detectarReprogramaciones } = require('../lib/fixtures');

const CRUDO = {
  id: 497342,
  utcDate: '2027-03-06T15:00:00Z',
  status: 'SCHEDULED',
  homeTeam: { name: 'Manchester City FC', tla: 'MCI' },
  awayTeam: { name: 'Fulham FC', tla: 'FUL' },
  venue: 'Etihad Stadium',
};

test('normalizarPartido mapea los campos de football-data.org', () => {
  const p = normalizarPartido(CRUDO, 'PL');
  assert.strictEqual(p.match_id, 497342);
  assert.strictEqual(p.fecha_utc, '2027-03-06T15:00:00Z');
  assert.strictEqual(p.local, 'Manchester City FC');
  assert.strictEqual(p.visitante, 'Fulham FC');
  assert.strictEqual(p.tla_local, 'MCI');
  assert.strictEqual(p.estadio, 'Etihad Stadium');
  assert.strictEqual(p.competencia, 'PL');
  assert.strictEqual(p.estado, 'SCHEDULED');
});

test('normalizarPartido resuelve la ciudad desde el tla del local', () => {
  assert.strictEqual(normalizarPartido(CRUDO, 'PL').ciudad, 'Manchester');
});

test('normalizarPartido tolera venue ausente sin romper', () => {
  const sinVenue = { ...CRUDO, venue: undefined };
  assert.strictEqual(normalizarPartido(sinVenue, 'PL').estadio, '');
});

test('normalizarPartido deja la ciudad vacia si el tla no esta mapeado', () => {
  const desconocido = { ...CRUDO, homeTeam: { name: 'Otro FC', tla: 'XXX' } };
  assert.strictEqual(normalizarPartido(desconocido, 'PL').ciudad, '');
});

test('detectarReprogramaciones encuentra un cambio de fecha del equipo objetivo', () => {
  const previos = [{ match_id: 497342, fecha_utc: '2027-03-06T15:00:00Z', tla_local: 'MCI', visitante: 'Fulham FC' }];
  const actuales = [{ match_id: 497342, fecha_utc: '2027-03-08T20:00:00Z', tla_local: 'MCI', visitante: 'Fulham FC' }];
  const cambios = detectarReprogramaciones(previos, actuales, 'MCI');
  assert.strictEqual(cambios.length, 1);
  assert.strictEqual(cambios[0].fecha_anterior, '2027-03-06T15:00:00Z');
  assert.strictEqual(cambios[0].fecha_nueva, '2027-03-08T20:00:00Z');
});

test('detectarReprogramaciones ignora equipos que no son el objetivo', () => {
  const previos = [{ match_id: 1, fecha_utc: '2027-03-06T15:00:00Z', tla_local: 'FUL', visitante: 'X' }];
  const actuales = [{ match_id: 1, fecha_utc: '2027-03-09T20:00:00Z', tla_local: 'FUL', visitante: 'X' }];
  assert.deepStrictEqual(detectarReprogramaciones(previos, actuales, 'MCI'), []);
});

test('detectarReprogramaciones no reporta partidos nuevos como reprogramados', () => {
  const actuales = [{ match_id: 999, fecha_utc: '2027-04-01T15:00:00Z', tla_local: 'MCI', visitante: 'Y' }];
  assert.deepStrictEqual(detectarReprogramaciones([], actuales, 'MCI'), []);
});

test('detectarReprogramaciones compara ids de distinto tipo sin fallar', () => {
  // Sheets devuelve numeros como string. Sin normalizar, todo partido pareceria nuevo.
  const previos = [{ match_id: '497342', fecha_utc: '2027-03-06T15:00:00Z', tla_local: 'MCI', visitante: 'F' }];
  const actuales = [{ match_id: 497342, fecha_utc: '2027-03-08T20:00:00Z', tla_local: 'MCI', visitante: 'F' }];
  assert.strictEqual(detectarReprogramaciones(previos, actuales, 'MCI').length, 1);
});
