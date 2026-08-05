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
