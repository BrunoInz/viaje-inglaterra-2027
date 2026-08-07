# Tracker de vuelos EZE → Inglaterra + Premier League

Cruza el fixture de Premier League con precios de vuelos y avisa por Telegram
cuando aparece una oportunidad de compra.

Diseño completo: `docs/superpowers/specs/2026-08-05-tracker-vuelos-premier-design.md`

## Desarrollo

    npm test     # corre todos los tests
    npm run build  # regenera los snippets y los tres workflows de n8n

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
