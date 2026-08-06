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
