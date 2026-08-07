# Tracker de vuelos EZE → Inglaterra + Premier League

Cruza el fixture de Premier League con precios de vuelos y avisa por Telegram
cuando aparece una oportunidad de compra.

Diseño completo: `docs/superpowers/specs/2026-08-05-tracker-vuelos-premier-design.md`

## Desarrollo

    npm test          # corre todos los tests
    npm run build     # regenera los snippets y los tres workflows de n8n
    npm run deploy    # los sube a n8n (crea credenciales, workflows inactivos)

Flags del deploy: `--dry-run` muestra qué haría sin escribir nada; `--activar`
los deja activos; `--recrear-credenciales` rota los tokens (la API pública de
n8n no tiene update de credenciales, así que las borra y las vuelve a crear).

## Operación

    node scripts/ejecutar.js wf1           # correr un workflow a demanda
    node scripts/ejecutar.js wf3:diario
    node scripts/ejecutar.js wf3:digest
    node scripts/verificar-planilla.js     # la planilla responde y config está completa
    node scripts/verificar-datos.js        # las pestañas cumplen lo que el spec espera
    node scripts/set-config.js umbral_usd 1200

`ejecutar.js` existe porque la API pública de n8n **no permite correr un
workflow a mano**: despliega una copia temporal con el trigger cambiado por un
webhook, la dispara, sigue la ejecución y la borra. Los workflows reales no se
tocan.

## Los tres workflows

| Archivo | Qué hace | Cuándo corre |
|---|---|---|
| `wf1-fixture-sync.json` | trae el fixture de Premier y Champions | domingos 08:00 |
| `wf2-ventanas.json` | calcula y puntúa las ventanas de viaje | domingos 08:30 |
| `wf3-precios.json` | consulta precios y alerta; digest semanal | diario 09:00 + domingos 20:00 |

## Regla importante

Todo lo que está bajo `n8n/` es **generado**. No lo edites a mano y **no lo
sobrescribas con el export de n8n**: un export trae los IDs de credenciales y
el ID de la planilla, que no van al repo.

- Para cambiar la lógica de negocio: editá `lib/` y corré `npm run build`.
- Para cambiar la forma de un workflow: editá `scripts/build-wf*.js` y
  reimportá el JSON en n8n.

Los tests de sincronización fallan si algo se desfasa.

Los JSON del repo llevan el Sheet ID como placeholder y **ningún** bloque
`credentials`. El deploy los hidrata en memoria justo antes de subirlos, así
los secretos nunca tocan el disco del proyecto.

## Notas de n8n aprendidas a los golpes

- Las credenciales HTTP restringidas por dominio quieren el **host pelado**
  (`api.football-data.org`). Con `https://…` o con `/*` al final, n8n rechaza
  la llamada con *Domain not allowed*.
- Omitir `allowedHttpRequestDomains` al crear la credencial da 400: el `if` del
  schema se cumple vacuamente y termina exigiendo `allowedDomains`.
- `GET /workflows` pagina de a 100 aunque pidas más. Sin seguir el `nextCursor`,
  en una instancia con cientos de workflows el deploy no encuentra los suyos y
  los duplica.
- Un `PUT` sobre un workflow activo devuelve 500. Hay que desactivarlo primero.
- Un nodo de Sheets con operación *read* corre **una vez por item de entrada**.
  Encadenarlo detrás de una pestaña de 385 filas dispara 385 llamadas y Google
  corta por rate limit. Se arregla con `executeOnce`.
- El filtro del nodo de Sheets compara **contra texto**. La columna `activa` es
  un booleano, así que `activa = TRUE` devolvía cero filas — sin error, nada.
  Filtrar en un Code es más predecible.
- `flylevel.com` responde **403 sin User-Agent de navegador**. El endpoint es
  público, pero rechaza lo que parece un bot.
- Travelpayouts **ignora `depart_date`** y responde caché de cualquier mes.
