// GENERADO AUTOMATICAMENTE por scripts/build-snippets.js
// No editar a mano: modificar lib/ y correr 'npm run build'.

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

function precioViaBarcelona({ ezeBcn, bcnEze, bcnLon, costoNocheBcn }) {
  const tramos = [ezeBcn, bcnEze, bcnLon];
  if (tramos.some((t) => typeof t !== 'number' || !Number.isFinite(t))) return null;
  // costoNocheBcn is optional (defaults to 0) but if provided must be a valid number
  if (costoNocheBcn != null && (typeof costoNocheBcn !== 'number' || !Number.isFinite(costoNocheBcn))) {
    return null;
  }
  return ezeBcn + bcnEze + bcnLon + (costoNocheBcn || 0);
}

// --- orquestacion n8n ---
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

return salida;
