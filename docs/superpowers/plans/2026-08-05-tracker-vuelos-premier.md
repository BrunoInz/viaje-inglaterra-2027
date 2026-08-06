# Tracker de vuelos + Premier League — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir tres workflows de n8n que crucen el fixture de Premier League con precios de vuelos EZE→Inglaterra y alerten por Telegram cuando aparece una oportunidad de compra.

**Architecture:** Toda la lógica de negocio vive en módulos JavaScript puros bajo `lib/`, testeados localmente con el runner nativo de Node. Un script de build inyecta esas funciones en los snippets que se pegan en los nodos Code de n8n, y un test de sincronización garantiza que snippet y librería nunca se desfasen. n8n queda reducido a orquestación: triggers, HTTP, Sheets y Telegram.

**Tech Stack:** Node.js 20+ (runner `node:test`, cero dependencias de producción), n8n, Google Sheets, Telegram Bot API. Fuentes de datos: football-data.org, SerpApi, Travelpayouts, endpoint de calendario de Level.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-08-05-tracker-vuelos-premier-design.md`. Ante cualquier discrepancia entre este plan y el spec, gana el spec.
- **Cero dependencias de producción.** El código de `lib/` corre dentro de nodos Code de n8n, que no resuelven `require` de paquetes locales. Solo built-ins de JavaScript. `devDependencies` está permitido.
- **CommonJS**, no ESM. Los snippets de n8n no soportan `import`.
- **Sin secretos en el repo.** API keys y tokens van en credenciales de n8n. `.env.example` documenta cuáles hacen falta, nunca sus valores.
- **Precios siempre por persona**, en USD enteros redondeados. Toda función que reciba un total de grupo lo divide por `pasajeros` antes de devolverlo.
- **Fechas en ISO 8601 UTC** (`2027-03-07T15:00:00Z`) para timestamps, `YYYY-MM-DD` para fechas de vuelo. Nunca formato local.
- **Valores de configuración jamás hardcodeados** en `lib/`. Se reciben como parámetro. La pestaña `config` de Sheets es la única fuente.
- Constantes fijadas por el spec, a copiar textualmente: `score` base 100, +20 por partido accesible, +30 por Champions, +10 por temporada baja (7 de enero a 15 de marzo). Ventana de viaje: 10 días. Offsets de variante: 2, 5 y 8 días antes del partido. Rango trackeable: hoy+60d a hoy+320d. Ventanas activas: 6. Umbral: USD 1.150. Factor de alerta relativa: 0.85. Mínimo de registros para media móvil: 7. Anti-spam: 48 horas. Costo de noche en Barcelona: USD 80.

---

## File Structure

```
viaje-inglaterra-2027/
├── package.json                       # scripts de test y build, sin deps de producción
├── .gitignore
├── .env.example                       # nombres de las credenciales requeridas
├── README.md                          # cómo correr tests, cómo regenerar snippets
├── lib/
│   ├── constantes.js                  # mapa tla→ciudad, offsets, umbrales del spec
│   ├── fixtures.js                    # normalizar football-data.org, detectar reprogramaciones
│   ├── ventanas.js                    # generar variantes, filtrar rango, puntuar
│   ├── precios.js                     # normalizar por pasajero, varianza cero, ruta vía BCN
│   └── alertas.js                     # media móvil, condiciones de disparo, anti-spam
├── n8n/code-snippets/                 # generados por scripts/build-snippets.js — no editar a mano
│   ├── wf1-normalizar-fixtures.js
│   ├── wf1-detectar-reprogramaciones.js
│   ├── wf2-calcular-ventanas.js
│   ├── wf3-normalizar-precios.js
│   └── wf3-evaluar-alertas.js
├── scripts/
│   └── build-snippets.js              # inyecta lib/ en las plantillas de snippet
└── tests/
    ├── fixtures.test.js
    ├── ventanas.test.js
    ├── precios.test.js
    ├── alertas.test.js
    └── sync.test.js                   # falla si los snippets no coinciden con lib/
```

**Por qué esta división:** cada módulo de `lib/` corresponde a una responsabilidad del spec y a un nodo Code distinto. `constantes.js` está separado porque lo consumen tres módulos y duplicarlo sería la fuente más probable de desincronización.

---

### Task 1: Scaffolding del proyecto

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `README.md`, `lib/constantes.js`
- Test: `tests/constantes.test.js`

**Interfaces:**
- Consumes: nada, es la primera tarea.
- Produces: `lib/constantes.js` exporta `CIUDAD_POR_TLA` (objeto `{[tla: string]: string}`), `OFFSETS_VARIANTE` (`number[]`), `DIAS_VIAJE` (`number`), `SCORE` (objeto con `BASE`, `POR_ACCESIBLE`, `CHAMPIONS`, `TEMPORADA_BAJA`), `TEMPORADA_BAJA` (objeto con `DESDE_MMDD` y `HASTA_MMDD`), `RANGO_TRACKEABLE` (objeto con `PISO_DIAS` y `TECHO_DIAS`), `ALERTA` (objeto con `FACTOR`, `MIN_REGISTROS`, `ANTISPAM_HORAS`).

- [ ] **Step 1: Inicializar el repositorio**

La carpeta ya existe con `docs/` adentro pero no es un repo git todavía.

```bash
cd "C:/Users/Bruno/Desktop/viaje-inglaterra-2027"
git init
git branch -M main
```

- [ ] **Step 2: Crear `package.json`**

```json
{
  "name": "viaje-inglaterra-2027",
  "version": "1.0.0",
  "private": true,
  "description": "Tracker de vuelos EZE-Inglaterra cruzado con el fixture de Premier League",
  "scripts": {
    "test": "node --test \"tests/*.test.js\"",
    "build": "node scripts/build-snippets.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: Crear `.gitignore`**

```
node_modules/
.env
*.log
.DS_Store
```

- [ ] **Step 4: Crear `.env.example`**

Documenta qué credenciales hacen falta. Nunca sus valores.

```
# Cargar como credenciales dentro de n8n, no como variables de entorno del repo.
# Este archivo solo documenta cuáles se necesitan.

FOOTBALL_DATA_TOKEN=      # https://www.football-data.org/client/register
SERPAPI_KEY=              # https://serpapi.com/manage-api-key
TRAVELPAYOUTS_TOKEN=      # https://www.travelpayouts.com/programs/
TELEGRAM_BOT_TOKEN=       # generado por @BotFather
TELEGRAM_CHAT_ID=         # obtenido con getUpdates
GOOGLE_SHEET_ID=          # de la URL del Sheet
```

- [ ] **Step 5: Escribir el test de constantes**

Verifica que los valores del spec estén presentes y sean los correctos. Es un test de regresión contra ediciones accidentales.

```js
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
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/constantes'`

- [ ] **Step 7: Escribir `lib/constantes.js`**

```js
'use strict';

// Ciudad de cada club, para el filtro de accesibilidad geografica.
// Solo se listan los clubes que el spec considera relevantes.
const CIUDAD_POR_TLA = {
  MCI: 'Manchester',
  MUN: 'Manchester',
  LIV: 'Liverpool',
  EVE: 'Liverpool',
  FUL: 'London',
  BRE: 'London',
  WHU: 'London',
  CRY: 'London',
  ARS: 'London',
  CHE: 'London',
  TOT: 'London',
  WOL: 'Wolverhampton',
  AVL: 'Birmingham',
  BUR: 'Burnley',
  BOU: 'Bournemouth',
};

const OFFSETS_VARIANTE = [2, 5, 8];
const DIAS_VIAJE = 10;

const SCORE = {
  BASE: 100,
  POR_ACCESIBLE: 20,
  CHAMPIONS: 30,
  TEMPORADA_BAJA: 10,
};

// Temporada baja de vuelos segun el spec: 7 de enero a 15 de marzo.
const TEMPORADA_BAJA = {
  DESDE_MMDD: '01-07',
  HASTA_MMDD: '03-15',
};

const RANGO_TRACKEABLE = {
  PISO_DIAS: 60,
  TECHO_DIAS: 320,
};

const ALERTA = {
  FACTOR: 0.85,
  MIN_REGISTROS: 7,
  ANTISPAM_HORAS: 48,
};

module.exports = {
  CIUDAD_POR_TLA,
  OFFSETS_VARIANTE,
  DIAS_VIAJE,
  SCORE,
  TEMPORADA_BAJA,
  RANGO_TRACKEABLE,
  ALERTA,
};
```

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS, 6 tests

- [ ] **Step 9: Escribir el README**

```markdown
# Tracker de vuelos EZE → Inglaterra + Premier League

Cruza el fixture de Premier League con precios de vuelos y avisa por Telegram
cuando aparece una oportunidad de compra.

Diseño completo: `docs/superpowers/specs/2026-08-05-tracker-vuelos-premier-design.md`

## Desarrollo

    npm test     # corre todos los tests
    npm run build  # regenera los snippets de n8n desde lib/

## Regla importante

Los archivos de `n8n/code-snippets/` son **generados**. No los edites a mano:
modificá `lib/` y corré `npm run build`. El test de sincronización falla si se
desfasan.
```

- [ ] **Step 10: Commit**

```bash
git add package.json .gitignore .env.example README.md lib/constantes.js tests/constantes.test.js docs/
git commit -m "chore: scaffolding del proyecto y constantes del spec"
```

---

### Task 2: Normalización de fixtures y detección de reprogramaciones

**Files:**
- Create: `lib/fixtures.js`
- Test: `tests/fixtures.test.js`

**Interfaces:**
- Consumes: `CIUDAD_POR_TLA` de `lib/constantes.js`.
- Produces:
  - `normalizarPartido(raw, competencia)` → objeto con `{match_id: number, fecha_utc: string, local: string, visitante: string, tla_local: string, estadio: string, ciudad: string, competencia: string, estado: string}`
  - `detectarReprogramaciones(previos, actuales, tlaObjetivo)` → array de `{match_id, visitante, fecha_anterior, fecha_nueva}`

- [ ] **Step 1: Escribir los tests que fallan**

```js
// tests/fixtures.test.js
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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/fixtures'`

- [ ] **Step 3: Escribir `lib/fixtures.js`**

```js
'use strict';

const { CIUDAD_POR_TLA } = require('./constantes');

function normalizarPartido(raw, competencia) {
  const tla = (raw.homeTeam && raw.homeTeam.tla) || '';
  return {
    match_id: raw.id,
    fecha_utc: raw.utcDate,
    local: (raw.homeTeam && raw.homeTeam.name) || '',
    visitante: (raw.awayTeam && raw.awayTeam.name) || '',
    tla_local: tla,
    estadio: raw.venue || '',
    ciudad: CIUDAD_POR_TLA[tla] || '',
    competencia,
    estado: raw.status || '',
  };
}

// Google Sheets devuelve numeros como string al leerlos. Comparar sin
// normalizar haria que todos los partidos parezcan nuevos en cada corrida.
function detectarReprogramaciones(previos, actuales, tlaObjetivo) {
  const indice = new Map(previos.map((p) => [String(p.match_id), p]));
  const cambios = [];

  for (const actual of actuales) {
    if (actual.tla_local !== tlaObjetivo) continue;
    const previo = indice.get(String(actual.match_id));
    if (!previo) continue; // partido nuevo, no es una reprogramacion
    if (previo.fecha_utc === actual.fecha_utc) continue;

    cambios.push({
      match_id: actual.match_id,
      visitante: actual.visitante,
      fecha_anterior: previo.fecha_utc,
      fecha_nueva: actual.fecha_utc,
    });
  }

  return cambios;
}

module.exports = { normalizarPartido, detectarReprogramaciones };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS, 14 tests acumulados

- [ ] **Step 5: Commit**

```bash
git add lib/fixtures.js tests/fixtures.test.js
git commit -m "feat: normalizacion de fixtures y deteccion de reprogramaciones"
```

---

### Task 3: Generación y puntuación de ventanas

**Files:**
- Create: `lib/ventanas.js`
- Test: `tests/ventanas.test.js`

**Interfaces:**
- Consumes: `OFFSETS_VARIANTE`, `DIAS_VIAJE`, `SCORE`, `TEMPORADA_BAJA`, `RANGO_TRACKEABLE` de `lib/constantes.js`.
- Produces:
  - `estaEnRangoTrackeable(fechaPartido, hoy)` → `boolean`
  - `esTemporadaBaja(fechaIda)` → `boolean`
  - `generarVentanas(partidosCity, todosLosPartidos, config, hoy)` → array de `{ventana_id, fecha_ida, fecha_vuelta, match_id_city, partidos_extra, score, activa}` ordenado por score descendente, con `activa: true` en las primeras `config.ventanas_activas`.
  - `config` es un objeto `{ventanas_activas: number, clubes_accesibles: string[], ciudades_ok: string[]}`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// tests/ventanas.test.js
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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/ventanas'`

- [ ] **Step 3: Escribir `lib/ventanas.js`**

```js
'use strict';

// El require va en UNA sola linea a proposito: scripts/build-snippets.js
// elimina los require locales filtrando linea por linea, y un require
// multilinea dejaria un 'const {' huerfano en el snippet generado.
const { OFFSETS_VARIANTE, DIAS_VIAJE, SCORE, TEMPORADA_BAJA, RANGO_TRACKEABLE } = require('./constantes');

const MS_POR_DIA = 86400000;

function aFecha(iso) {
  return new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
}

function aYMD(date) {
  return date.toISOString().slice(0, 10);
}

function sumarDias(fechaYMD, dias) {
  return aYMD(new Date(aFecha(fechaYMD).getTime() + dias * MS_POR_DIA));
}

function estaEnRangoTrackeable(fechaPartido, hoy) {
  const dias = (aFecha(fechaPartido) - aFecha(hoy)) / MS_POR_DIA;
  return dias >= RANGO_TRACKEABLE.PISO_DIAS && dias <= RANGO_TRACKEABLE.TECHO_DIAS;
}

// Compara solo mes y dia: el rango de temporada baja se repite cada año.
function esTemporadaBaja(fechaIda) {
  const mmdd = String(fechaIda).slice(5, 10);
  return mmdd >= TEMPORADA_BAJA.DESDE_MMDD && mmdd <= TEMPORADA_BAJA.HASTA_MMDD;
}

function esAccesible(partido, config) {
  return config.clubes_accesibles.includes(partido.tla_local)
    && config.ciudades_ok.includes(partido.ciudad);
}

function estaDentro(fechaPartido, ida, vuelta) {
  const f = aFecha(fechaPartido);
  return f >= aFecha(ida) && f <= aFecha(vuelta);
}

function generarVentanas(partidosCity, todosLosPartidos, config, hoy) {
  const ventanas = [];

  for (const partido of partidosCity) {
    if (!estaEnRangoTrackeable(partido.fecha_utc, hoy)) continue;

    for (const offset of OFFSETS_VARIANTE) {
      const fecha_ida = sumarDias(partido.fecha_utc, -offset);
      const fecha_vuelta = sumarDias(fecha_ida, DIAS_VIAJE);

      const extras = todosLosPartidos.filter((p) =>
        String(p.match_id) !== String(partido.match_id)
        && estaDentro(p.fecha_utc, fecha_ida, fecha_vuelta)
        && esAccesible(p, config));

      const champions = todosLosPartidos.some((p) =>
        String(p.match_id) !== String(partido.match_id)
        && p.competencia === 'CL'
        && p.tla_local === 'MCI'
        && estaDentro(p.fecha_utc, fecha_ida, fecha_vuelta));

      let score = SCORE.BASE + SCORE.POR_ACCESIBLE * extras.length;
      if (champions) score += SCORE.CHAMPIONS;
      if (esTemporadaBaja(fecha_ida)) score += SCORE.TEMPORADA_BAJA;

      ventanas.push({
        // Derivado del partido y el offset, nunca de la fecha de corrida:
        // asi el id sobrevive entre ejecuciones y el historico no se corta.
        ventana_id: `${partido.match_id}-${offset}`,
        fecha_ida,
        fecha_vuelta,
        match_id_city: partido.match_id,
        partidos_extra: extras.map((p) => p.match_id).join(';'),
        score,
        activa: false,
        ultima_alerta_ts: null,
      });
    }
  }

  // Se copia antes de ordenar y se reconstruye cada objeto en vez de mutarlo:
  // sort() y una asignacion directa modificarian en el lugar, contra la regla
  // de inmutabilidad del proyecto. Se usa el spread y no toSorted() porque
  // este codigo termina inline en un nodo Code de n8n, cuya version de Node no
  // controlamos.
  const ordenadas = [...ventanas].sort((a, b) =>
    b.score - a.score || a.fecha_ida.localeCompare(b.fecha_ida));

  return ordenadas.map((v, i) => ({ ...v, activa: i < config.ventanas_activas }));
}

module.exports = { estaEnRangoTrackeable, esTemporadaBaja, generarVentanas };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS, 29 tests acumulados

- [ ] **Step 5: Commit**

```bash
git add lib/ventanas.js tests/ventanas.test.js
git commit -m "feat: generacion y puntuacion de ventanas de viaje"
```

---

### Task 4: Normalización de precios y ruta vía Barcelona

**Files:**
- Create: `lib/precios.js`
- Test: `tests/precios.test.js`

**Interfaces:**
- Consumes: nada de `lib/`.
- Produces:
  - `normalizarPrecioGrupo(total, pasajeros)` → `number` entero, precio por persona
  - `tieneInventario(dayPrices)` → `boolean`, `false` si todos los precios son idénticos
  - `precioDelDia(dayPrices, fechaYMD)` → `number | null`
  - `precioViaBarcelona({ezeBcn, bcnEze, bcnLon, costoNocheBcn})` → `number | null`

- [ ] **Step 1: Escribir los tests que fallan**

```js
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

test('precioViaBarcelona devuelve null si costoNocheBcn no es numerico', () => {
  // En produccion este valor llega como Number(config.costo_noche_bcn) leyendo
  // una celda de Sheets. Una celda con texto da NaN, y un NaN escrito al
  // historico se propaga por la media movil sin que nada lo delate.
  assert.strictEqual(precioViaBarcelona({ ezeBcn: 469, bcnEze: 500, bcnLon: 120, costoNocheBcn: 'abc' }), null);
});

test('precioViaBarcelona trata costoNocheBcn ausente como cero', () => {
  assert.strictEqual(precioViaBarcelona({ ezeBcn: 469, bcnEze: 500, bcnLon: 120 }), 1089);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/precios'`

- [ ] **Step 3: Escribir `lib/precios.js`**

```js
'use strict';

function normalizarPrecioGrupo(total, pasajeros) {
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  if (typeof pasajeros !== 'number' || pasajeros < 1) return null;
  return Math.round(total / pasajeros);
}

// Level responde con un precio de relleno uniforme cuando todavia no cargo
// tarifas para ese mes. Se detecta por varianza cero y no filtrando un valor
// concreto: el numero de relleno puede cambiar sin aviso, la uniformidad no.
function tieneInventario(dayPrices) {
  if (!Array.isArray(dayPrices) || dayPrices.length === 0) return false;
  const distintos = new Set(dayPrices.map((d) => d.price));
  return distintos.size > 1;
}

function precioDelDia(dayPrices, fechaYMD) {
  if (!Array.isArray(dayPrices)) return null;
  const encontrado = dayPrices.find((d) => d.date === fechaYMD);
  return encontrado ? encontrado.price : null;
}

function esNumeroValido(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function precioViaBarcelona({ ezeBcn, bcnEze, bcnLon, costoNocheBcn }) {
  if (![ezeBcn, bcnEze, bcnLon].every(esNumeroValido)) return null;

  // costoNocheBcn puede faltar y vale 0 en ese caso, pero cualquier otro valor
  // no numerico invalida el resultado: sumarlo daria NaN, y un NaN en el
  // historico se propaga por la media movil sin dejar rastro. Un null, en
  // cambio, lo descarta el filtro de estado aguas abajo.
  if (costoNocheBcn !== null && costoNocheBcn !== undefined && !esNumeroValido(costoNocheBcn)) {
    return null;
  }

  return ezeBcn + bcnEze + bcnLon + (costoNocheBcn || 0);
}

module.exports = { normalizarPrecioGrupo, tieneInventario, precioDelDia, precioViaBarcelona };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS, 41 tests acumulados

- [ ] **Step 5: Commit**

```bash
git add lib/precios.js tests/precios.test.js
git commit -m "feat: normalizacion de precios y ruta via Barcelona"
```

---

### Task 5: Media móvil y condiciones de alerta

**Files:**
- Create: `lib/alertas.js`
- Test: `tests/alertas.test.js`

**Interfaces:**
- Consumes: `ALERTA` de `lib/constantes.js`.
- Produces:
  - `mediaMovil(registros, dias, ahora)` → `{media: number|null, cantidad: number}`. Solo considera registros con `estado === 'ok'`.
  - `debeAlertar({precioActual, registros, umbral, ultimaAlertaTs, ahora})` → `{alertar: boolean, motivo: string|null}`. `motivo` es `'umbral'`, `'caida_relativa'` o `null`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// tests/alertas.test.js
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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/alertas'`

- [ ] **Step 3: Escribir `lib/alertas.js`**

```js
'use strict';

const { ALERTA } = require('./constantes');

const MS_POR_HORA = 3600000;
const MS_POR_DIA = 86400000;

function mediaMovil(registros, dias, ahora) {
  const limite = new Date(ahora).getTime() - dias * MS_POR_DIA;

  const validos = (registros || []).filter((r) =>
    r.estado === 'ok'
    && typeof r.precio_usd === 'number'
    && Number.isFinite(r.precio_usd)
    && new Date(r.ts).getTime() >= limite);

  if (validos.length === 0) return { media: null, cantidad: 0 };

  const suma = validos.reduce((acc, r) => acc + r.precio_usd, 0);
  return { media: suma / validos.length, cantidad: validos.length };
}

function debeAlertar({ precioActual, registros, umbral, ultimaAlertaTs, ahora }) {
  const sinAlerta = { alertar: false, motivo: null };

  if (typeof precioActual !== 'number' || !Number.isFinite(precioActual)) return sinAlerta;

  // El anti-spam se evalua primero: si esta bloqueado no importa el motivo.
  if (ultimaAlertaTs) {
    const horas = (new Date(ahora).getTime() - new Date(ultimaAlertaTs).getTime()) / MS_POR_HORA;
    if (horas < ALERTA.ANTISPAM_HORAS) return sinAlerta;
  }

  if (precioActual < umbral) return { alertar: true, motivo: 'umbral' };

  const { media, cantidad } = mediaMovil(registros, 14, ahora);
  if (media !== null && cantidad >= ALERTA.MIN_REGISTROS
      && precioActual <= ALERTA.FACTOR * media) {
    return { alertar: true, motivo: 'caida_relativa' };
  }

  return sinAlerta;
}

module.exports = { mediaMovil, debeAlertar };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS, 53 tests acumulados

- [ ] **Step 5: Commit**

```bash
git add lib/alertas.js tests/alertas.test.js
git commit -m "feat: media movil y condiciones de alerta"
```

---

### Task 6: Generación de snippets y test de sincronización

**Files:**
- Create: `scripts/build-snippets.js`, `tests/sync.test.js`
- Create (generados): `n8n/code-snippets/*.js`

**Interfaces:**
- Consumes: todos los módulos de `lib/`.
- Produces: `construirSnippet(nombre)` → `string` con el contenido del snippet. `SNIPPETS` → array de `{nombre, modulos, wrapper}`.

**Por qué generar en vez de copiar:** los nodos Code de n8n no resuelven `require` de archivos locales, así que el código debe vivir inline. Copiar a mano es la forma más segura de que la lógica testeada y la que corre en producción se desfasen sin que nadie se entere.

- [ ] **Step 1: Escribir el test de sincronización**

```js
// tests/sync.test.js
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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/build-snippets'`

- [ ] **Step 3: Escribir `scripts/build-snippets.js`**

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const DIR_LIB = path.join(RAIZ, 'lib');
const DIR_SALIDA = path.join(RAIZ, 'n8n', 'code-snippets');

// Cada snippet declara que modulos de lib/ necesita inline y con que codigo
// de orquestacion de n8n se envuelve.
const SNIPPETS = [
  {
    nombre: 'wf1-normalizar-fixtures',
    modulos: ['constantes', 'fixtures'],
    wrapper: `
// La competencia viaja en cada item: WF1 fusiona la rama de Premier con la de
// Champions, y despues del Merge ya no se puede saber de que rama vino cada uno.
return $input.all().map((item) => ({
  json: normalizarPartido(item.json, item.json._competencia || 'PL'),
}));`,
  },
  {
    nombre: 'wf1-detectar-reprogramaciones',
    modulos: ['constantes', 'fixtures'],
    wrapper: `
const previos = $('Leer fixtures previos').all().map((i) => i.json);
const actuales = $('Normalizar fixtures').all().map((i) => i.json);
const cambios = detectarReprogramaciones(previos, actuales, 'MCI');
return cambios.map((c) => ({ json: c }));`,
  },
  {
    nombre: 'wf2-calcular-ventanas',
    modulos: ['constantes', 'ventanas'],
    wrapper: `
const config = $('Leer config').first().json;
const todos = $('Leer fixtures').all().map((i) => i.json);
const city = todos.filter((p) => p.tla_local === 'MCI' && p.competencia === 'PL');
const hoy = new Date().toISOString().slice(0, 10);

const parametros = {
  ventanas_activas: Number(config.ventanas_activas),
  clubes_accesibles: String(config.clubes_accesibles).split(';'),
  ciudades_ok: String(config.ciudades_ok).split(';'),
};

return generarVentanas(city, todos, parametros, hoy).map((v) => ({ json: v }));`,
  },
  {
    nombre: 'wf3-normalizar-precios',
    modulos: ['precios'],
    wrapper: `
const config = $('Leer config').first().json;
const pasajeros = Number(config.pasajeros);
const ventana = $('Ventana actual').first().json;
const salida = [];

// SerpApi: precio total del grupo, hay que dividirlo.
const serp = $('SerpApi').first().json;
const totalSerp = serp && serp.best_flights && serp.best_flights[0]
  ? serp.best_flights[0].price : null;
salida.push({
  json: {
    ts: new Date().toISOString(),
    ventana_id: ventana.ventana_id,
    ruta: 'EZE-LON-EZE',
    fuente: 'serpapi',
    precio_usd: normalizarPrecioGrupo(totalSerp, pasajeros),
    aerolinea: serp && serp.best_flights && serp.best_flights[0]
      ? (serp.best_flights[0].flights[0].airline || '') : '',
    escalas: serp && serp.best_flights && serp.best_flights[0]
      ? serp.best_flights[0].flights.length - 1 : null,
    price_insight: serp && serp.price_insights ? serp.price_insights.price_level : '',
    estado: totalSerp === null ? 'error_fuente' : 'ok',
  },
});

// Level: ida y vuelta por separado, con deteccion de mes sin inventario.
const idaLevel = $('Level EZE-BCN').first().json;
const vueltaLevel = $('Level BCN-EZE').first().json;
const diasIda = (idaLevel.data && idaLevel.data.dayPrices) || [];
const diasVuelta = (vueltaLevel.data && vueltaLevel.data.dayPrices) || [];

if (!tieneInventario(diasIda) || !tieneInventario(diasVuelta)) {
  salida.push({
    json: {
      ts: new Date().toISOString(),
      ventana_id: ventana.ventana_id,
      ruta: 'EZE-BCN-LON',
      fuente: 'level',
      precio_usd: null,
      aerolinea: 'Level',
      escalas: null,
      price_insight: '',
      estado: 'sin_inventario',
    },
  });
} else {
  const bcnLon = Number($('Travelpayouts BCN-LON').first().json.precio_usd) || null;
  const total = precioViaBarcelona({
    ezeBcn: precioDelDia(diasIda, ventana.fecha_ida),
    bcnEze: precioDelDia(diasVuelta, ventana.fecha_vuelta),
    bcnLon,
    costoNocheBcn: Number(config.costo_noche_bcn),
  });
  salida.push({
    json: {
      ts: new Date().toISOString(),
      ventana_id: ventana.ventana_id,
      ruta: 'EZE-BCN-LON',
      fuente: 'level',
      precio_usd: total,
      aerolinea: 'Level + conexion',
      escalas: 1,
      price_insight: '',
      estado: total === null ? 'error_fuente' : 'ok',
    },
  });
}

return salida;`,
  },
  {
    nombre: 'wf3-evaluar-alertas',
    modulos: ['constantes', 'alertas'],
    wrapper: `
const config = $('Leer config').first().json;
const ventana = $('Ventana actual').first().json;
const historico = $('Leer historico').all().map((i) => i.json);
const nuevos = $('Normalizar precios').all().map((i) => i.json);
const ahora = new Date().toISOString();

const delaVentana = historico.filter((h) => h.ventana_id === ventana.ventana_id);
const salida = [];

for (const registro of nuevos) {
  if (registro.estado !== 'ok') continue;
  const veredicto = debeAlertar({
    precioActual: registro.precio_usd,
    registros: delaVentana.filter((h) => h.ruta === registro.ruta),
    umbral: Number(config.umbral_usd),
    ultimaAlertaTs: ventana.ultima_alerta_ts || null,
    ahora,
  });
  if (veredicto.alertar) {
    salida.push({ json: { ...registro, motivo: veredicto.motivo, ventana } });
  }
}

return salida;`,
  },
];

const ENCABEZADO = `// GENERADO AUTOMATICAMENTE por scripts/build-snippets.js
// No editar a mano: modificar lib/ y correr 'npm run build'.
`;

// Quita 'use strict', los require locales y el module.exports para poder
// concatenar varios modulos en un unico scope de nodo Code.
function extraerCuerpo(nombreModulo) {
  const fuente = fs.readFileSync(path.join(DIR_LIB, `${nombreModulo}.js`), 'utf8');
  return fuente
    .split('\n')
    .filter((linea) => !/^'use strict';/.test(linea))
    // El patron debe coincidir con el de tests/sync.test.js. Si el extractor
    // reconociera menos requires que el test, un modulo con require('../x')
    // pondria el test en rojo sin que quede claro por que el extractor no lo
    // saco.
    .filter((linea) => !/require\(['"]\.\.?\//.test(linea))
    .join('\n')
    .replace(/module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/m, '')
    .trim();
}

function construirSnippet(nombre) {
  const snippet = SNIPPETS.find((s) => s.nombre === nombre);
  if (!snippet) throw new Error(`snippet desconocido: ${nombre}`);
  const cuerpos = snippet.modulos.map(extraerCuerpo).join('\n\n');
  return `${ENCABEZADO}\n${cuerpos}\n\n// --- orquestacion n8n ---\n${snippet.wrapper.trim()}\n`;
}

function build() {
  fs.mkdirSync(DIR_SALIDA, { recursive: true });
  for (const snippet of SNIPPETS) {
    const destino = path.join(DIR_SALIDA, `${snippet.nombre}.js`);
    fs.writeFileSync(destino, construirSnippet(snippet.nombre), 'utf8');
    console.log(`escrito ${destino}`);
  }
}

if (require.main === module) build();

module.exports = { SNIPPETS, construirSnippet, build };
```

- [ ] **Step 4: Generar los snippets**

Run: `npm run build`
Expected: cinco líneas `escrito ...`, y `n8n/code-snippets/` con 5 archivos.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS, 60 tests acumulados

- [ ] **Step 6: Inspeccionar un snippet generado a ojo**

Abrir `n8n/code-snippets/wf2-calcular-ventanas.js` y verificar que:
- arranca con el encabezado de "GENERADO AUTOMATICAMENTE"
- contiene las funciones de `constantes.js` y `ventanas.js` completas, sin `const {` huérfanos ni `module.exports` residual
- termina con el bloque de orquestación de n8n

No usar `node --check`: el archivo termina en `return`, ilegal en el top level de un script. El test del Step 5 ya valida la sintaxis con `new Function`, que es como n8n lo ejecuta.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-snippets.js tests/sync.test.js n8n/code-snippets/
git commit -m "feat: generacion de snippets de n8n desde lib con test de sincronizacion"
```

---

### Task 7: Credenciales y planilla de Google Sheets

**Files:** ninguno en el repo. Esta tarea produce recursos externos.

**Interfaces:**
- Produces: un Google Sheet con 4 pestañas y sus encabezados exactos, más 5 credenciales cargadas en n8n. Las tareas 8, 9 y 10 dependen de esto.

Esta tarea es manual y bloquea a las tres siguientes. Es la única que requiere acciones de Bruno fuera del repo.

- [ ] **Step 1: Registrar football-data.org**

Ir a https://www.football-data.org/client/register. El token llega por mail.
Verificar que funciona:

```bash
curl -s -H "X-Auth-Token: TU_TOKEN" \
  "https://api.football-data.org/v4/competitions/PL/teams" | head -c 300
```

Expected: JSON con `"count": 20` y el array `teams`.

- [ ] **Step 2: Registrar SerpApi**

Ir a https://serpapi.com/users/sign_up. El plan gratuito da 250 búsquedas mensuales.
Verificar:

```bash
curl -s "https://serpapi.com/search?engine=google_flights&departure_id=EZE&arrival_id=LHR&outbound_date=2027-02-12&return_date=2027-02-22&currency=USD&adults=2&api_key=TU_KEY" | head -c 400
```

Expected: JSON con `best_flights` o `other_flights`.
**Ojo:** cada llamada consume cuota. No repetir de más.

- [ ] **Step 3: Registrar Travelpayouts**

Ir a https://www.travelpayouts.com/ y crear cuenta de afiliado. El token está en el panel.

- [ ] **Step 4: Crear el bot de Telegram**

En Telegram, hablarle a `@BotFather`, mandar `/newbot` y seguir los pasos. Guardar el token.
Después mandarle un mensaje cualquiera al bot recién creado y obtener el chat_id:

```bash
curl -s "https://api.telegram.org/botTU_TOKEN/getUpdates"
```

Expected: JSON con `result[0].message.chat.id`. Ese número es el `telegram_chat_id`.

- [ ] **Step 5: Crear la planilla**

Crear un Google Sheet nuevo llamado `tracker-vuelos-inglaterra-2027` con **cuatro pestañas**, con estos encabezados en la fila 1 exactamente en este orden:

`fixtures`:
```
match_id | fecha_utc | local | visitante | tla_local | estadio | ciudad | competencia | estado | actualizado_ts
```

`ventanas`:
```
ventana_id | fecha_ida | fecha_vuelta | match_id_city | partidos_extra | score | activa | ultima_alerta_ts
```

`precios`:
```
ts | ventana_id | ruta | fuente | precio_usd | aerolinea | escalas | price_insight | estado
```

`config` — dos columnas, `clave` y `valor`, con estas filas:
```
umbral_usd          | 1150
ventanas_activas    | 6
dias_viaje          | 10
pasajeros           | 2
clubes_accesibles   | FUL;BRE;WHU;CRY;WOL;EVE;AVL;BUR;BOU
ciudades_ok         | London;Manchester;Liverpool
costo_noche_bcn     | 80
telegram_chat_id    | <el obtenido en el paso 4>
serpapi_agotada_mes | <vacio>
```

La fila `serpapi_agotada_mes` arranca vacía. La escribe el propio workflow cuando detecta que se acabó la cuota, y guarda el mes en formato `YYYY-MM`.

- [ ] **Step 6: Cargar las credenciales en n8n**

En la instancia de n8n (ver la memoria `n8n_credentials`), crear:
- Credencial **Google Sheets OAuth2** con acceso a la planilla creada.
- Credencial **Telegram** con el token del bot.
- Los tokens de football-data.org, SerpApi y Travelpayouts van como **Header Auth** o como parámetro de query en cada nodo HTTP, según lo que pida cada API.

- [ ] **Step 7: Verificar de punta a punta**

Crear un workflow descartable en n8n con un solo nodo Google Sheets que lea la pestaña `config`. Ejecutarlo.
Expected: 9 filas, con `umbral_usd = 1150`.

Borrar el workflow descartable.

- [ ] **Step 8: Registrar el ID de la planilla**

Copiar el ID del Sheet desde la URL (`docs.google.com/spreadsheets/d/<ID>/edit`) y anotarlo. Las tareas siguientes lo necesitan. **No commitearlo al repo.**

---

### Task 8: Workflow 1 — Fixture Sync

**Files:**
- Create: `n8n/workflows/wf1-fixture-sync.json` (export del workflow terminado)

**Interfaces:**
- Consumes: `n8n/code-snippets/wf1-normalizar-fixtures.js` y `wf1-detectar-reprogramaciones.js` de la Task 6; las credenciales y la planilla de la Task 7.
- Produces: la pestaña `fixtures` poblada. La Task 9 la lee.

- [ ] **Step 1: Construir el workflow en n8n**

Nodos, en orden:

1. **Schedule Trigger** — semanal, domingos 08:00, timezone `America/Argentina/Buenos_Aires`.
2. **Google Sheets** (`Leer config`) — lee la pestaña `config`.
3. **Google Sheets** (`Leer fixtures previos`) — lee la pestaña `fixtures`. Si está vacía devuelve cero items, y eso es válido en la primera corrida.
4. **HTTP Request** (`Traer PL`) — `GET https://api.football-data.org/v4/competitions/PL/matches`, header `X-Auth-Token`. En **Settings**, activar *Retry On Fail*: 3 intentos, 5000 ms entre reintentos.
5. **HTTP Request** (`Traer CL`) — `GET https://api.football-data.org/v4/competitions/CL/matches`, mismo header y mismo retry.

   **Sin este nodo el bonus de Champions nunca se activa.** El scoring de la Task 3 suma +30 cuando encuentra un partido con `competencia === 'CL'` y `tla_local === 'MCI'`, pero si nadie trae esos partidos la condición jamás se cumple y el bonus queda muerto en el código.

   El free tier de football-data.org cubre 12 competiciones incluyendo Champions, y el límite es de 10 requests por minuto: dos llamadas semanales están holgadamente dentro.

6. **Code** (`Marcar competencia`) — n8n pierde el origen al fusionar ramas, así que hay que etiquetar antes de unir. Modo *Run Once for All Items*, un nodo por cada rama:

```js
// En la rama de PL usar 'PL'; en la de CL, 'CL'.
const competencia = 'PL';
return $input.all().map((item) => ({ json: { ...item.json, _competencia: competencia } }));
```

7. **Merge** (`Unir competencias`) — modo *Append*. Entrada 1 desde la rama PL, entrada 2 desde la rama CL.

8. **Filter** (`Solo City en CL`) — descarta los partidos de Champions que no involucran a City de local, que son cientos y no aportan nada:

```
{{ $json._competencia === 'PL' || ($json.homeTeam && $json.homeTeam.tla === 'MCI') }}
```

9. **Code** (`Normalizar fixtures`) — pegar el contenido de `n8n/code-snippets/wf1-normalizar-fixtures.js`. Modo *Run Once for All Items*. El snippet ya lee `_competencia` de cada item, que es lo que dejan los nodos `Marcar competencia`.
10. **Code** (`Detectar reprogramaciones`) — pegar `wf1-detectar-reprogramaciones.js`.
11. **IF** — `{{ $json.match_id }}` *is not empty*. Rama true → nodo 12.
12. **Telegram** (`Avisar reprogramacion`) — mensaje:

```
⚠️ PARTIDO REPROGRAMADO

City vs {{ $json.visitante }}
Antes:  {{ $json.fecha_anterior }}
Ahora:  {{ $json.fecha_nueva }}

Revisá si te rompe alguna ventana de viaje.
```

13. **Google Sheets** (`Guardar fixtures`) — operación *Append or Update*, columna de matcheo `match_id`, conectado desde `Normalizar fixtures`.

- [ ] **Step 2: Ejecutar manualmente y verificar**

Ejecutar el workflow con el botón *Test workflow*.
Expected: la pestaña `fixtures` tiene ~380 filas de Premier (380 partidos por temporada) más un puñado de partidos de City por Champions. Ninguna fila con `match_id` vacío. La columna `ciudad` está poblada para los clubes del mapa.

- [ ] **Step 2b: Verificar que llegaron los partidos de Champions**

Filtrar la pestaña `fixtures` por `competencia = CL`.
Expected: solo aparecen partidos donde `tla_local = MCI`. Si aparecen partidos de otros equipos, el nodo `Solo City en CL` está mal configurado. Si no aparece ninguno y City está jugando Champions esta temporada, el bonus de +30 va a quedar inactivo — revisar el nodo `Traer CL`.

- [ ] **Step 3: Verificar la detección de reprogramaciones**

Editar a mano en la planilla la `fecha_utc` de un partido donde `tla_local = MCI`, poniéndole una fecha distinta. Volver a ejecutar el workflow.
Expected: llega un mensaje de Telegram con el aviso de reprogramación, y la fila vuelve a la fecha real.

- [ ] **Step 4: Activar el workflow y exportarlo**

Activar el toggle. Después, menú `...` → *Download*, y guardar el JSON en `n8n/workflows/wf1-fixture-sync.json`.

- [ ] **Step 5: Commit**

```bash
git add n8n/workflows/wf1-fixture-sync.json
git commit -m "feat: workflow 1 de sincronizacion de fixtures"
```

---

### Task 9: Workflow 2 — Cálculo de ventanas

**Files:**
- Create: `n8n/workflows/wf2-ventanas.json`

**Interfaces:**
- Consumes: la pestaña `fixtures` que puebla la Task 8; el snippet `wf2-calcular-ventanas.js`.
- Produces: la pestaña `ventanas` poblada, con exactamente 6 filas donde `activa = TRUE`. La Task 10 la lee.

- [ ] **Step 1: Construir el workflow**

1. **Schedule Trigger** — semanal, domingos 08:30, `America/Argentina/Buenos_Aires`.
2. **Google Sheets** (`Leer config`) — pestaña `config`.
3. **Google Sheets** (`Leer fixtures`) — pestaña `fixtures`.
4. **Code** (`Calcular ventanas`) — pegar `n8n/code-snippets/wf2-calcular-ventanas.js`. Modo *Run Once for All Items*.
5. **Google Sheets** (`Guardar ventanas`) — *Append or Update*, columna de matcheo `ventana_id`.

**Importante:** `ultima_alerta_ts` no está entre las columnas que escribe el snippet. Al usar *Append or Update* matcheando por `ventana_id`, el valor existente se conserva. Si se usara *Append* a secas, el anti-spam se reiniciaría cada domingo y las alertas se duplicarían.

- [ ] **Step 2: Ejecutar y verificar el conteo**

Ejecutar manualmente.
Expected: la pestaña `ventanas` tiene 3 filas por cada partido de City de local dentro del rango de 60 a 320 días. Exactamente 6 tienen `activa = TRUE`.

- [ ] **Step 3: Verificar el scoring contra el spec a mano**

Tomar la ventana con mayor score y verificar la cuenta manualmente:
- 100 de base
- +20 por cada `match_id` listado en `partidos_extra`
- +30 si hay un partido de City por Champions entre `fecha_ida` y `fecha_vuelta`
- +10 si `fecha_ida` cae entre el 7 de enero y el 15 de marzo

Expected: el número coincide con la columna `score`.

- [ ] **Step 4: Verificar la estabilidad de los ids**

Ejecutar el workflow una segunda vez.
Expected: la cantidad de filas no cambia. No se crearon duplicados. Los `ventana_id` son los mismos.

- [ ] **Step 5: Activar, exportar y commitear**

```bash
git add n8n/workflows/wf2-ventanas.json
git commit -m "feat: workflow 2 de calculo de ventanas de viaje"
```

---

### Task 10: Workflow 3 — Precios y alertas

**Files:**
- Create: `n8n/workflows/wf3-precios.json`

**Interfaces:**
- Consumes: la pestaña `ventanas` de la Task 9; los snippets `wf3-normalizar-precios.js` y `wf3-evaluar-alertas.js`.
- Produces: la pestaña `precios` creciendo a diario, y mensajes de Telegram.

Este workflow tiene **dos triggers**: el diario de precios y el dominical del digest. El digest no consulta ninguna API.

- [ ] **Step 1: Construir la rama diaria**

1. **Schedule Trigger** (`Diario`) — todos los días 09:00, `America/Argentina/Buenos_Aires`.
2. **Google Sheets** (`Leer config`) — pestaña `config`.
3. **Google Sheets** (`Leer ventanas`) — pestaña `ventanas`, con filtro `activa = TRUE`.
4. **Loop Over Items** (`Ventana actual`) — batch size 1. Todo lo que sigue va adentro del loop.
5. **HTTP Request** (`SerpApi`) — retry 3 intentos:

```
https://serpapi.com/search?engine=google_flights&departure_id=EZE&arrival_id=LHR&outbound_date={{ $json.fecha_ida }}&return_date={{ $json.fecha_vuelta }}&currency=USD&adults={{ $('Leer config').first().json.pasajeros }}&api_key={{ $credentials.serpapi }}
```

6. **HTTP Request** (`Level EZE-BCN`) — sin autenticación:

```
https://www.flylevel.com/nwe/flights/api/calendar/?triptype=OW&origin=EZE&destination=BCN&month={{ $('Ventana actual').first().json.fecha_ida.split('-')[1] }}&year={{ $('Ventana actual').first().json.fecha_ida.split('-')[0] }}&currencyCode=USD
```

7. **HTTP Request** (`Level BCN-EZE`) — igual pero `origin=BCN&destination=EZE`, usando mes y año de `fecha_vuelta`.
8. **HTTP Request** (`Travelpayouts BCN-LON`) — endpoint de calendario de Travelpayouts para `origin=BCN&destination=LON`, con el token en header.
9. **Code** (`Normalizar precios`) — pegar `wf3-normalizar-precios.js`.
10. **Google Sheets** (`Guardar precios`) — operación *Append*. Acá sí es append puro: cada corrida agrega registros históricos nuevos, no actualiza los previos.
11. **Google Sheets** (`Leer historico`) — pestaña `precios`.
12. **Code** (`Evaluar alertas`) — pegar `wf3-evaluar-alertas.js`.
13. **Telegram** (`Alerta`):

```
🚨 ALERTA DE PRECIO BAJO 🚨

✈️ Ruta: {{ $json.ruta }}
📅 Ida: {{ $json.ventana.fecha_ida }}
📅 Vuelta: {{ $json.ventana.fecha_vuelta }}
💰 Precio: USD {{ $json.precio_usd }} por persona
🎯 Motivo: {{ $json.motivo }}
📊 Fuente: {{ $json.fuente }}
⚽ Partido: match {{ $json.ventana.match_id_city }}
```

14. **Google Sheets** (`Marcar alerta`) — *Append or Update* en `ventanas`, matcheando `ventana_id`, escribiendo `ultima_alerta_ts` con el timestamp actual. **Sin este nodo el anti-spam nunca se activa**, porque `debeAlertar` lee ese campo.

- [ ] **Step 1b: Agregar el modo de degradación por cuota agotada**

El spec exige que al agotarse la cuota de SerpApi el sistema avise **una sola vez** y siga funcionando con las fuentes sin límite. Sin esto, el workflow tiraría error todos los días de fin de mes y Bruno recibiría el mismo aviso treinta veces, o peor, dejaría de trackear en silencio.

Agregar la fila `serpapi_agotada_mes` a la pestaña `config`, inicialmente vacía. Guarda un valor `YYYY-MM`.

**Nodo `Cuota disponible?`** — un IF que va **antes** del nodo `SerpApi` (entre `Ventana actual` y `SerpApi`):

```
{{ $('Leer config').first().json.serpapi_agotada_mes !== new Date().toISOString().slice(0, 7) }}
```

Rama *true* → `SerpApi`. Rama *false* → salta directo a `Level EZE-BCN`, sin consumir cuota.

**En el nodo `SerpApi`**, abrir *Settings* y activar **Continue On Fail**. Sin eso, un 429 corta la ejecución entera y ni siquiera se consultan Level ni Travelpayouts.

**Nodo `Detectar cuota agotada`** — un IF inmediatamente después de `SerpApi`:

```
{{ $json.error !== undefined && String($json.error).toLowerCase().includes('run out of searches') }}
```

Rama *true* → dos nodos en secuencia:

- **Google Sheets** (`Marcar cuota agotada`) — *Append or Update* en `config`, matcheando por `clave`, escribiendo `serpapi_agotada_mes` con `{{ new Date().toISOString().slice(0, 7) }}`.
- **Telegram** (`Avisar cuota`):

```
⚠️ Se agotó la cuota mensual de SerpApi.

El tracker sigue funcionando con Level y Travelpayouts,
pero sin los datos de Google Flights ni el price insight
hasta que arranque el mes que viene.
```

El flag guarda el mes, no un booleano: al cambiar de mes la comparación deja de coincidir por sí sola y SerpApi se reactiva sin intervención manual.

- [ ] **Step 2: Construir la rama del digest**

15. **Schedule Trigger** (`Digest`) — domingos 20:00, `America/Argentina/Buenos_Aires`.
16. **Google Sheets** (`Leer ventanas digest`) — pestaña `ventanas`, filtro `activa = TRUE`.
17. **Google Sheets** (`Leer precios digest`) — pestaña `precios`.
18. **Code** (`Armar digest`) — este nodo no usa `lib/`, es puro formateo:

```js
const ventanas = $('Leer ventanas digest').all().map((i) => i.json);
const precios = $('Leer precios digest').all().map((i) => i.json);
const ahora = Date.now();

const lineas = ventanas.map((v) => {
  const suyos = precios.filter((p) => p.ventana_id === v.ventana_id && p.estado === 'ok');
  if (suyos.length === 0) return `${v.fecha_ida} → ${v.fecha_vuelta} | sin datos aun`;

  const ordenados = suyos.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const actual = Number(ordenados[0].precio_usd);
  const minimo = Math.min(...suyos.map((p) => Number(p.precio_usd)));

  const haceUnaSemana = suyos.filter((p) => ahora - new Date(p.ts).getTime() >= 6 * 86400000);
  const previo = haceUnaSemana.length ? Number(haceUnaSemana[0].precio_usd) : null;
  const delta = previo === null ? '—' : (actual > previo ? `+${actual - previo}` : `${actual - previo}`);

  const extras = String(v.partidos_extra || '').split(';').filter(Boolean).length;
  return `${v.fecha_ida} → ${v.fecha_vuelta}\n  USD ${actual} (min ${minimo}, sem ${delta}) | score ${v.score} | +${extras} partidos`;
});

return [{ json: { texto: `📊 RESUMEN SEMANAL\n\n${lineas.join('\n\n')}` } }];
```

19. **Telegram** (`Enviar digest`) — manda `{{ $json.texto }}`.

- [ ] **Step 3: Ejecutar la rama diaria y verificar**

Ejecutar manualmente el trigger diario.
Expected: la pestaña `precios` gana entre 6 y 12 filas nuevas. Las que corresponden a Level para meses de 2027 sin inventario tienen `estado = sin_inventario` y `precio_usd` vacío.

- [ ] **Step 4: Verificar la normalización de precio**

Elegir una fila de `precios` con `fuente = serpapi` y `estado = ok`. Buscar la misma ruta y fechas manualmente en Google Flights con 2 adultos.
Expected: el valor de la planilla es aproximadamente **la mitad** del total que muestra Google Flights. Si coincide con el total, la división por pasajeros no está funcionando.

- [ ] **Step 5: Verificar la alerta forzando el umbral**

En la pestaña `config`, subir `umbral_usd` a `99999` temporalmente. Ejecutar la rama diaria.
Expected: llega alerta de Telegram por cada ventana con precio válido, con motivo `umbral`.

Ejecutar una segunda vez sin cambiar nada.
Expected: **no llega ninguna alerta nueva** — el anti-spam de 48 horas la bloquea. Si llegan de nuevo, el nodo `Marcar alerta` no está escribiendo `ultima_alerta_ts`.

Devolver `umbral_usd` a `1150`.

- [ ] **Step 6: Verificar el digest**

Ejecutar manualmente el trigger del digest.
Expected: llega un solo mensaje con una entrada por cada ventana activa. **La cuota de SerpApi no se movió** — verificarlo en https://serpapi.com/dashboard.

- [ ] **Step 7: Activar, exportar y commitear**

```bash
git add n8n/workflows/wf3-precios.json
git commit -m "feat: workflow 3 de precios y alertas"
```

---

## Verificación final

- [ ] `npm test` pasa completo, 60 tests.
- [ ] `npm run build` no produce diferencias contra lo commiteado (el test de sync lo cubre).
- [ ] Los tres workflows están activos en n8n.
- [ ] La pestaña `precios` crece a diario sin filas con `ventana_id` o `ts` vacíos.
- [ ] El consumo de SerpApi en el dashboard va a ritmo de ~6 llamadas por día, proyectando menos de 250 mensuales.
- [ ] Ninguna alerta se disparó a partir de una fila con `estado ≠ ok`.
- [ ] El repo no contiene ningún token ni el ID de la planilla.
