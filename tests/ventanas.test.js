const test = require('node:test');
const assert = require('node:assert');
const { estaEnRangoTrackeable, esTemporadaBaja, generarVentanas } = require('../lib/ventanas');

const HOY = '2026-08-05';
const CONFIG = {
  ventanas_activas: 6,
  clubes_accesibles: ['FUL', 'BRE', 'WHU', 'CRY', 'WOL', 'EVE', 'AVL', 'BUR', 'BOU'],
  ciudades_ok: ['London', 'Manchester', 'Liverpool'],
};

function partidoCity(id, fecha) {
  return { match_id: id, fecha_utc: fecha, tla_local: 'MCI', ciudad: 'Manchester',
           estadio: 'Etihad Stadium', competencia: 'PL', visitante: 'Rival FC' };
}

test('estaEnRangoTrackeable rechaza partidos a menos de 60 dias', () => {
  assert.strictEqual(estaEnRangoTrackeable('2026-09-01T15:00:00Z', HOY), false);
});

test('estaEnRangoTrackeable acepta partidos dentro de la ventana', () => {
  assert.strictEqual(estaEnRangoTrackeable('2027-01-15T15:00:00Z', HOY), true);
});

test('estaEnRangoTrackeable rechaza partidos a mas de 320 dias', () => {
  assert.strictEqual(estaEnRangoTrackeable('2027-09-01T15:00:00Z', HOY), false);
});

test('esTemporadaBaja reconoce el rango del 7 de enero al 15 de marzo', () => {
  assert.strictEqual(esTemporadaBaja('2027-02-10'), true);
  assert.strictEqual(esTemporadaBaja('2027-01-07'), true);
  assert.strictEqual(esTemporadaBaja('2027-03-15'), true);
  assert.strictEqual(esTemporadaBaja('2027-01-06'), false);
  assert.strictEqual(esTemporadaBaja('2027-03-16'), false);
});

test('generarVentanas produce tres variantes por partido de City', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const v = generarVentanas(city, city, CONFIG, HOY);
  assert.strictEqual(v.length, 3);
});

test('las variantes usan los offsets del spec y duran 10 dias', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const v = generarVentanas(city, city, CONFIG, HOY);
  const idas = v.map((x) => x.fecha_ida).sort();
  assert.deepStrictEqual(idas, ['2027-02-12', '2027-02-15', '2027-02-18']);
  for (const ventana of v) {
    const ida = new Date(ventana.fecha_ida + 'T00:00:00Z');
    const vuelta = new Date(ventana.fecha_vuelta + 'T00:00:00Z');
    assert.strictEqual((vuelta - ida) / 86400000, 10);
  }
});

test('el score base de una ventana sin extras es 100 mas temporada baja', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const v = generarVentanas(city, city, CONFIG, HOY);
  // Todas las idas de febrero caen en temporada baja: 100 + 10
  assert.strictEqual(v[0].score, 110);
});

test('cada partido accesible dentro de la ventana suma 20', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const extra = { match_id: 2, fecha_utc: '2027-02-21T15:00:00Z', tla_local: 'FUL',
                  ciudad: 'London', competencia: 'PL', visitante: 'Z' };
  const v = generarVentanas(city, [...city, extra], CONFIG, HOY);
  const conExtra = v.find((x) => x.fecha_ida === '2027-02-12');
  assert.strictEqual(conExtra.score, 130); // 100 + 10 baja + 20
  assert.strictEqual(conExtra.partidos_extra, '2');
});

test('un partido de un club no accesible no suma score', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const arsenal = { match_id: 3, fecha_utc: '2027-02-21T15:00:00Z', tla_local: 'ARS',
                    ciudad: 'London', competencia: 'PL', visitante: 'Z' };
  const v = generarVentanas(city, [...city, arsenal], CONFIG, HOY);
  assert.strictEqual(v[0].score, 110);
});

test('un partido accesible en una ciudad fuera de ruta no suma score', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const lejos = { match_id: 4, fecha_utc: '2027-02-21T15:00:00Z', tla_local: 'BOU',
                  ciudad: 'Bournemouth', competencia: 'PL', visitante: 'Z' };
  const v = generarVentanas(city, [...city, lejos], CONFIG, HOY);
  assert.strictEqual(v[0].score, 110);
});

test('un partido de Champions de City en la ventana suma 30', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const cl = { match_id: 5, fecha_utc: '2027-02-17T20:00:00Z', tla_local: 'MCI',
               ciudad: 'Manchester', competencia: 'CL', visitante: 'Real Madrid' };
  const v = generarVentanas(city, [...city, cl], CONFIG, HOY);
  const conCl = v.find((x) => x.fecha_ida === '2027-02-12');
  assert.strictEqual(conCl.score, 140); // 100 + 10 baja + 30 champions
});

test('las ventanas vienen ordenadas por score descendente', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const extra = { match_id: 2, fecha_utc: '2027-02-13T15:00:00Z', tla_local: 'FUL',
                  ciudad: 'London', competencia: 'PL', visitante: 'Z' };
  const v = generarVentanas(city, [...city, extra], CONFIG, HOY);
  for (let i = 1; i < v.length; i++) {
    assert.ok(v[i - 1].score >= v[i].score);
  }
});

test('solo las primeras ventanas_activas quedan activas', () => {
  const city = [
    partidoCity(1, '2027-02-20T15:00:00Z'),
    partidoCity(2, '2027-03-06T15:00:00Z'),
    partidoCity(3, '2027-04-10T15:00:00Z'),
  ];
  const v = generarVentanas(city, city, CONFIG, HOY);
  assert.strictEqual(v.length, 9);
  assert.strictEqual(v.filter((x) => x.activa).length, 6);
});

test('los partidos fuera del rango trackeable no generan ventanas', () => {
  const city = [partidoCity(1, '2026-09-01T15:00:00Z')];
  assert.deepStrictEqual(generarVentanas(city, city, CONFIG, HOY), []);
});

test('el ventana_id es estable entre corridas', () => {
  const city = [partidoCity(1, '2027-02-20T15:00:00Z')];
  const a = generarVentanas(city, city, CONFIG, HOY);
  const b = generarVentanas(city, city, CONFIG, '2026-08-12');
  const idsA = a.map((x) => x.ventana_id).sort();
  const idsB = b.map((x) => x.ventana_id).sort();
  assert.deepStrictEqual(idsA, idsB);
});
