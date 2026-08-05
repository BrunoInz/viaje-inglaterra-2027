# Tracker de vuelos EZE → Inglaterra cruzado con fixture de Premier League

**Fecha:** 2026-08-05
**Autor:** Bruno
**Estado:** Diseño aprobado, pendiente de plan de implementación

---

## Contexto

Viaje de ~10 días a Inglaterra en 2027, dos personas, saliendo de Buenos Aires (EZE).
Objetivo doble: recorrer Inglaterra y ver partidos de Premier League, con **Manchester City
de local en el Etihad como requisito no negociable** más uno o dos partidos adicionales de
clubes con entradas accesibles.

Las fechas son flexibles: la prioridad es el precio del vuelo. Eso invierte el problema
habitual — en vez de fijar fechas y buscar vuelo, se buscan las ventanas de fechas que
combinan buen precio con buen calendario de partidos.

### Restricciones del dominio

Tres hechos condicionan todo el diseño:

1. **El inventario de las aerolíneas se abre ~330–360 días antes.** Al 2026-08-05 se puede
   ver hasta ~julio 2027. Ventanas posteriores a esa fecha no son trackeables todavía.

2. **Trackear 12 meses antes no produce el mejor precio.** En rutas intercontinentales el
   piso suele aparecer entre 2 y 6 meses antes de volar. El valor del tracking temprano es
   *conocer la línea base* de la ruta y *detectar promociones puntuales*, no esperar un
   mínimo absoluto.

3. **La Premier reprograma partidos por televisión.** Las fechas y horarios definitivos se
   confirman 6–8 semanas antes. Un partido de sábado 15:00 puede moverse a lunes 20:00 y
   romper una ventana de viaje ya comprada. El sistema debe detectar estos cambios.

### Fuera de alcance

- No reserva ni compra vuelos.
- No compra entradas de Premier (proceso manual, ver anexo).
- No trackea hoteles ni trenes.

---

## Decisiones de fuentes de datos

Se evaluaron las alternativas disponibles al 2026-08:

| Fuente | Estado | Decisión |
|---|---|---|
| Amadeus Self-Service | Portal en decomisión durante 2026, keys deshabilitadas a mitad de año | Descartada |
| Kiwi Tequila | Acceso requiere proyecto con 50.000+ usuarios mensuales | Descartada |
| Skyscanner Travel API | Partner-only, mínimo 100.000 MAU | Descartada |
| **SerpApi (Google Flights)** | Free tier: 250 búsquedas/mes, tope 50/hora | **Adoptada** |
| **Travelpayouts Data API** | Gratis con cuenta de afiliado, sin costo por llamada | **Adoptada** |
| **Level (endpoint de calendario)** | Público, sin API key, verificado 2026-08-05 | **Adoptada** |
| **football-data.org** | Free tier permanente, 10 req/min, incluye Premier League | **Adoptada** |

### Por qué tres fuentes de vuelos

Cumplen funciones distintas y complementarias:

- **SerpApi** devuelve datos reales de Google Flights e incluye *Price Insights*, que
  clasifica el precio actual como bajo/típico/alto contra el histórico de la ruta. Es la
  señal que permite distinguir una oferta real de una fluctuación. Su límite es la cuota.
- **Travelpayouts** entrega precios cacheados de búsquedas de usuarios de Aviasales
  (retención: 7 días), sin límite práctico de llamadas. Sirve para el barrido amplio —
  calendarios de meses completos y rutas open-jaw — donde la cuota de SerpApi no alcanza.

- **Level** expone un endpoint de calendario público, sin autenticación, que devuelve el
  precio más bajo de cada día de un mes para una ruta. Cubre **EZE ⇄ BCN**, que es la vía
  alternativa a Londres: Level es low-cost de largo alcance con base en Barcelona, y el
  tramo Barcelona–Londres se resuelve aparte por muy poco. Sin cuota y con precios reales
  de la propia aerolínea.

La limitación conocida de Travelpayouts es que sus precios pueden estar desactualizados o
ausentes en rutas poco buscadas. Se usa para **tendencia y descubrimiento**, nunca como
única base de una alerta de compra.

### Level — endpoint y detección de precios de relleno

```
GET https://www.flylevel.com/nwe/flights/api/calendar/
    ?triptype=OW&origin=EZE&destination=BCN&month=<M>&year=<YYYY>&currencyCode=USD
```

Respuesta: `data.dayPrices[]` con `date`, `price` y `tags`.

**Verificación del 2026-08-05 sobre la ruta EZE→BCN:**

| Mes consultado | Precios devueltos |
|---|---|
| 2026-10 | 469 ×19d · 502 ×7d · 902 ×28d · 2177 · 2627 |
| 2027-01 | 902 ×32d · 966 · 1101 · 1254 · 1277 ×8d · 1342 · 1449 · 1625 |
| 2027-03 | **902 en los 61 registros** |
| 2027-06 | 902 ×41d · 1277 ×19d |

**Level devuelve un precio de relleno cuando todavía no cargó tarifas para esa fecha.** Marzo
2027 responde 902 uniformemente: no es una tarifa, es la ausencia de inventario. Tomarlo como
precio real anclaría la media móvil de esas ventanas en un número inventado y produciría
alertas falsas.

**Regla de descarte:** si todos los días del mes devuelven el mismo precio, el mes se marca
`sin_inventario` y **no se registra ningún precio**. Se usa este criterio — varianza cero —
en vez de filtrar el número 902, porque el valor de relleno puede cambiar y un número mágico
hardcodeado fallaría en silencio.

Consecuencia práctica: las ventanas de 2027 alejadas van a arrancar sin dato de Level e ir
poblándose a medida que la aerolínea carga inventario. Es el comportamiento esperado, no un
error.

---

## Arquitectura

Tres workflows independientes en n8n, comunicados a través de Google Sheets.

```
football-data.org ──► WF1 Fixture Sync ──► Sheets:fixtures
                          (semanal)            │
                                               ▼
                                        WF2 Ventanas ──► Sheets:ventanas
                                          (semanal)          │
                                                             ▼
SerpApi ─────────┐                                    WF3 Precios
Travelpayouts ───┴──────────────────────────────────►  (diario)
                                                             │
                                                             ├─► Sheets:precios
                                                             └─► Telegram
```

Se eligió separarlos en tres en vez de uno solo por dos razones: **cadencias distintas**
(el fixture cambia semanalmente, los precios diariamente) y **aislamiento de fallos** (si
football-data.org está caído, el tracking de precios sigue funcionando sobre las ventanas
ya calculadas).

---

## WF1 · Fixture Sync

**Disparo:** cron semanal, domingos 08:00 ART.

**Responsabilidad:** mantener `Sheets:fixtures` sincronizada y detectar reprogramaciones.

**Flujo:**

1. `GET https://api.football-data.org/v4/competitions/PL/teams` con header `X-Auth-Token`.
   Resuelve la tabla de equipos de la temporada en curso. **No se hardcodean IDs de
   equipos** — se resuelven por su código `tla` (ej. `MCI`, `FUL`), porque los IDs de
   ascendidos cambian entre temporadas.
2. `GET https://api.football-data.org/v4/competitions/PL/matches` para traer el fixture
   completo.
3. Normalizar cada partido al esquema de `fixtures`.
4. Comparar contra lo ya guardado. Para cada partido cuyo `local` sea Manchester City:
   si cambió `fecha_utc`, emitir alerta de reprogramación por Telegram.
5. Escribir/actualizar en Sheets con `match_id` como clave.

**Nota sobre Champions League:** el free tier de football-data.org cubre 12 competiciones
incluyendo Champions. Los partidos de City de local en Champions se traen en una segunda
llamada al código de competición `CL` y se marcan con `competencia = "CL"`, porque suman
score pero no son el requisito obligatorio.

---

## WF2 · Cálculo de ventanas

**Disparo:** cron semanal, domingos 08:30 ART (después de WF1).

**Responsabilidad:** convertir el fixture en ventanas de viaje candidatas y puntuarlas.

**Flujo:**

1. Filtrar `fixtures` donde `local = Manchester City`, `estadio = Etihad`, y la fecha esté
   dentro del rango trackeable:
   - **Piso:** hoy + 60 días. Antes de eso no tiene sentido trackear: no hay margen para
     que baje el precio ni para gestionar entradas.
   - **Techo:** hoy + 320 días. Más allá, las aerolíneas todavía no cargaron inventario.
2. Por cada partido de City, generar **3 variantes de ventana** de 10 días:
   - Partido al inicio: `ida = partido − 2 días`, `vuelta = ida + 10`
   - Partido al medio: `ida = partido − 5 días`, `vuelta = ida + 10`
   - Partido al final: `ida = partido − 8 días`, `vuelta = ida + 10`
3. Por cada ventana, contar los partidos accesibles que caen dentro del rango.
4. Puntuar:

   ```
   score = 100                        (partido de City en Etihad — base obligatoria)
         +  20 × partidos accesibles en la ventana
         +  30  si hay partido de City de local por Champions dentro de la ventana
         +  10  si la ventana cae entre el 7 de enero y el 15 de marzo (temporada baja)
   ```

5. Ordenar por score descendente y marcar las **6 mejores** como `activa = TRUE`.
   El resto queda en la hoja con `activa = FALSE` para referencia.

**Definición de "partido accesible":** partido de local, en Londres / Gran Manchester /
Liverpool, de un club de la lista blanca configurable en `Sheets:config`. Lista inicial:
Fulham, Brentford, West Ham, Crystal Palace, Wolverhampton, Everton, Aston Villa, Burnley,
Bournemouth. Se excluyen deliberadamente Arsenal, Liverpool, Manchester United, Chelsea y
Tottenham: sus entradas no se consiguen sin membership previa de años o paquetes de
hospitality, así que inflarían el score de ventanas que en la práctica no son realizables.

**Estabilidad de ventanas:** si una ventana ya activa sigue cumpliendo condiciones, conserva
su `ventana_id`. Esto preserva la continuidad del histórico de precios, que es lo que
alimenta la media móvil de las alertas.

---

## WF3 · Precios

**Disparo:** cron diario, 09:00 ART.

**Responsabilidad:** consultar precios, registrar y decidir alertas.

### Reparto de cuota

SerpApi ofrece 250 búsquedas/mes con tope de 50 por hora. El reparto:

- **6 ventanas activas × 1 consulta diaria = 180 llamadas/mes.**
- Margen restante: 70 llamadas para re-runs, pruebas y consultas manuales.
- Tope horario: nunca se superan 6 llamadas en la misma corrida, muy por debajo de 50.

Travelpayouts absorbe todo lo demás sin costo de cuota.

### Flujo

1. Leer las ventanas con `activa = TRUE`.
2. **Por cada ventana, consultar SerpApi** — ruta principal ida y vuelta:
   ```
   GET https://serpapi.com/search
       ?engine=google_flights
       &departure_id=EZE
       &arrival_id=LHR,LGW,STN
       &outbound_date=<ida>
       &return_date=<vuelta>
       &currency=USD
       &adults=2
       &api_key=<key>
   ```
   Guardar precio, aerolínea, cantidad de escalas y el campo de *price insights*.

   **Normalización de precio:** al consultar con `adults=2`, Google Flights devuelve el
   importe **total del grupo**, no el unitario. Todo precio se divide por `pasajeros` antes
   de escribirse en `Sheets:precios`. La columna `precio_usd` siempre almacena valor **por
   persona**, y el `umbral_usd` de configuración se compara siempre contra ese valor
   unitario. Sin esta normalización explícita el umbral de 1.400 nunca se dispararía.
3. **Consultar Travelpayouts** para las variantes que la cuota de SerpApi no cubre:
   - Calendario mensual completo del mes de cada ventana activa:
     ```
     GET https://api.travelpayouts.com/v1/prices/calendar
         ?origin=BUE&destination=LON&depart_date=<YYYY-MM>&currency=usd
     ```
   - Variante **open-jaw**: llegada a Londres, regreso desde Manchester. Dado que el viaje
     recorre Inglaterra de sur a norte, el open-jaw evita un tren de vuelta y en ocasiones
     resulta más barato que el ida y vuelta convencional.
   - Tramo **BCN ⇄ Londres**, insumo de la ruta vía Barcelona (paso 4).
4. **Consultar Level** para la ruta vía Barcelona:
   - Calendario de EZE→BCN del mes de ida y de BCN→EZE del mes de vuelta.
   - Aplicar la regla de varianza cero. Si el mes está `sin_inventario`, se omite la ruta
     para esa ventana en esta corrida.
   - Construir el precio compuesto:
     `total_via_bcn = Level(EZE→BCN) + Level(BCN→EZE) + Travelpayouts(BCN⇄LON)`
   - Registrar como una ruta más, con `ruta = EZE-BCN-LON`, para que compita en igualdad de
     condiciones con el directo.
5. Escribir todas las cotizaciones en `Sheets:precios` con timestamp.
6. Evaluar condiciones de alerta.

### Sobre la ruta vía Barcelona

Son **tickets separados**, con dos consecuencias que el sistema debe reflejar:

- **No hay protección de conexión.** Si Level llega tarde, el vuelo a Londres se pierde y
  ninguna aerolínea responde. El itinerario exige **al menos una noche en Barcelona**, no una
  conexión de horas.
- **Esa noche tiene costo.** Para comparar honestamente contra el vuelo directo se suma un
  cargo fijo configurable, `costo_noche_bcn` (valor inicial: USD 80), al total de la ruta vía
  Barcelona. Sin ese ajuste la comparación favorecería sistemáticamente a la escala.

El sobrecosto no es solo una penalidad: una noche en Barcelona a la ida es una escala
razonable en un viaje de 10 días. Pero la decisión es de Bruno, no del workflow — el sistema
informa ambos totales y no elige por él.

### Condiciones de alerta

**Alerta inmediata** si se cumple cualquiera de las dos:

- `precio < umbral` (valor inicial: USD 1.400 por persona, ida y vuelta)
- `precio ≤ 0.85 × media_móvil_14_días(ventana)` — esta es la que detecta promociones
  reales, porque es relativa a la línea base propia de cada ventana en vez de a un número
  fijo.

La segunda condición requiere al menos 7 registros previos de esa ventana para activarse.
Antes de eso la media no es representativa y solo dispararía ruido.

**Anti-spam:** máximo una alerta por ventana cada 48 horas. Se registra `ultima_alerta_ts`
en la fila de la ventana.

**Digest semanal:** WF3 tiene **dos triggers**. El cron diario de las 09:00 ejecuta la rama
de consulta y alertas descrita arriba. Un segundo cron, domingos 20:00 ART, ejecuta una rama
distinta que no consulta ninguna API: lee `Sheets:precios` y arma una tabla de las 6 ventanas
activas con fechas, precio actual, mínimo histórico registrado, variación respecto de la
semana anterior y los partidos que incluye cada una. Al no llamar APIs, el digest no consume
cuota de SerpApi.

**Destinatario:** un único `chat_id` de Telegram (Bruno). El campo vive en `Sheets:config`
para poder sumar destinatarios después sin tocar el workflow.

---

## Modelo de datos — Google Sheets

Se eligió Sheets sobre Postgres porque el volumen es trivial (≈180 filas/mes en la pestaña
más activa), permite inspección visual inmediata, y habilita compartir el documento sin
construir ninguna interfaz.

### Pestaña `fixtures`
| Columna | Tipo | Notas |
|---|---|---|
| `match_id` | número | clave, viene de football-data.org |
| `fecha_utc` | ISO 8601 | fuente de verdad horaria |
| `local` | texto | |
| `visitante` | texto | |
| `tla_local` | texto | código de 3 letras |
| `estadio` | texto | |
| `ciudad` | texto | usado para el filtro de accesibilidad |
| `competencia` | texto | `PL` o `CL` |
| `estado` | texto | `SCHEDULED`, `TIMED`, `FINISHED` |
| `actualizado_ts` | ISO 8601 | |

### Pestaña `ventanas`
| Columna | Tipo | Notas |
|---|---|---|
| `ventana_id` | texto | estable entre corridas |
| `fecha_ida` | fecha | |
| `fecha_vuelta` | fecha | |
| `match_id_city` | número | partido que ancla la ventana |
| `partidos_extra` | texto | lista separada por `;` |
| `score` | número | |
| `activa` | booleano | |
| `ultima_alerta_ts` | ISO 8601 | control de anti-spam |

### Pestaña `precios`
| Columna | Tipo | Notas |
|---|---|---|
| `ts` | ISO 8601 | |
| `ventana_id` | texto | |
| `ruta` | texto | `EZE-LON-EZE`, `EZE-LON/MAN-EZE`, `EZE-BCN-LON` |
| `fuente` | texto | `serpapi`, `travelpayouts` o `level` |
| `precio_usd` | número | por persona, ya normalizado |
| `aerolinea` | texto | |
| `escalas` | número | |
| `price_insight` | texto | `low` / `typical` / `high`, solo SerpApi |
| `estado` | texto | `ok` · `sin_inventario` · `error_fuente` |

La columna `estado` distingue tres situaciones que de otro modo se verían igual: un precio
válido, un mes sin tarifas cargadas, y un fallo de la API. Solo las filas con `estado = ok`
alimentan medias móviles y alertas.

### Pestaña `config`
| Clave | Valor inicial |
|---|---|
| `umbral_usd` | 1400 |
| `ventanas_activas` | 6 |
| `dias_viaje` | 10 |
| `pasajeros` | 2 |
| `clubes_accesibles` | `FUL;BRE;WHU;CRY;WOL;EVE;AVL;BUR;BOU` |
| `ciudades_ok` | `London;Manchester;Liverpool` |
| `costo_noche_bcn` | 80 |
| `telegram_chat_id` | *(a completar en setup)* |

Tener la configuración en una pestaña y no dentro de los nodos permite ajustar el umbral o
la lista de clubes desde el celular sin abrir n8n.

---

## Manejo de errores

- **Reintentos:** cada nodo HTTP con 3 intentos y backoff exponencial.
- **Degradación:** si una fuente de vuelos falla, la otra continúa. Se registra el fallo en
  `precios` con `precio_usd` vacío y la fuente marcada, para no dejar huecos silenciosos en
  el histórico.
- **Cuota agotada de SerpApi:** al detectar el error de cuota, se envía **una única**
  notificación por Telegram y el workflow pasa a modo solo-Travelpayouts hasta el reinicio
  mensual. Se registra un flag en `config` para no repetir el aviso.
- **Integridad:** nunca se escribe una fila con `ventana_id` o `ts` vacíos.
- **Fixture no disponible:** si WF1 falla, WF2 no corre y las ventanas existentes se
  mantienen. WF3 sigue trackeando sobre ellas.

---

## Criterios de éxito

1. Al mes de operación, el histórico permite responder: *¿cuál es el precio típico de
   EZE–Londres para cada ventana candidata?*
2. Toda reprogramación de un partido de City de local genera aviso dentro de los 7 días.
3. Ninguna semana pasa sin digest.
4. El consumo de SerpApi se mantiene por debajo de 250 llamadas mensuales.
5. Ninguna fila con `estado ≠ ok` participa del cálculo de medias móviles. Verificable
   auditando `Sheets:precios` contra las alertas emitidas.
6. Para cada ventana activa el digest informa **ambos totales** — directo y vía Barcelona —
   cuando hay datos de los dos.

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| El endpoint de Level es interno, no una API pública documentada. Puede cambiar de forma o dejar de responder sin aviso. | Se trata como fuente opcional: si falla, se registra `error_fuente` y el resto del sistema sigue. Nunca es la única base de una alerta. |
| Los precios de Travelpayouts son cacheados y pueden no estar vigentes al momento de comprar. | Toda alerta incluye la fuente. Las de Travelpayouts se verifican manualmente antes de comprar. |
| SerpApi puede cambiar su free tier. | El diseño degrada a Travelpayouts + Level, ambos sin cuota. |
| El fixture 2027/28 no existe hasta junio 2027. | El techo de 320 días ya excluye ese rango. Las ventanas de agosto 2027 en adelante recién se calculan cuando haya fixture. |

---

## Anexo — Entradas (proceso manual)

Fuera del alcance del sistema, pero condiciona las fechas y por eso se documenta.

**Manchester City.** Es el más accesible de los clubes grandes: el Etihad tiene ~53.000
localidades y no agota contra rivales de mitad de tabla. El camino es la membership
*Cityzens* de nivel Matchday, que da acceso a las ventas anticipadas. Debe estar activa
**antes** de que abran las ventas del partido elegido, típicamente 4–8 semanas antes.

**Orden de operaciones recomendado:**

1. Dejar correr el tracker 4–6 semanas para conocer la línea base de precios.
2. Elegir la ventana objetivo entre las 6 activas.
3. Sacar la membership Cityzens.
4. Comprar la entrada de City cuando abra la venta anticipada.
5. Recién entonces comprar el vuelo.

El orden importa: el vuelo se consigue casi siempre, la entrada no. Comprar el vuelo primero
es asumir el riesgo de viajar y no entrar a la cancha.

**Partidos accesibles:** Fulham, Brentford y Crystal Palace suelen tener venta general real
sin membership. Se compran con 2–4 semanas de anticipación, ya con el viaje confirmado.
