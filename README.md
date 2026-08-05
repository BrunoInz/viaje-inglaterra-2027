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
