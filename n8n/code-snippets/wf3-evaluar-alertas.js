// GENERADO AUTOMATICAMENTE por scripts/build-snippets.js
// No editar a mano: modificar lib/ y correr 'npm run build'.

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

// --- orquestacion n8n ---
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

return salida;
