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

function precioViaBarcelona({ ezeBcn, bcnEze, bcnLon, costoNocheBcn }) {
  const tramos = [ezeBcn, bcnEze, bcnLon];
  if (tramos.some((t) => typeof t !== 'number' || !Number.isFinite(t))) return null;
  return ezeBcn + bcnEze + bcnLon + (costoNocheBcn || 0);
}

module.exports = { normalizarPrecioGrupo, tieneInventario, precioDelDia, precioViaBarcelona };
