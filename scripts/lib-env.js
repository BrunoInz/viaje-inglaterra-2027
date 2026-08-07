'use strict';

/** Lectura del .env sin dependencias. No se logea ningun valor. */

const fs = require('node:fs');
const path = require('node:path');

const RUTA_ENV = path.join(__dirname, '..', '.env');

function leerEnv() {
  if (!fs.existsSync(RUTA_ENV)) {
    throw new Error(`falta ${RUTA_ENV} — copiar .env.example y completarlo`);
  }

  const env = {};

  // El archivo puede venir con BOM y con CRLF: los dos rompen el parseo ingenuo.
  const contenido = fs.readFileSync(RUTA_ENV, 'utf8').replace(/^﻿/, '');

  for (const linea of contenido.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (limpia === '' || limpia.startsWith('#')) continue;

    const corte = limpia.indexOf('=');
    if (corte === -1) continue;

    const clave = limpia.slice(0, corte).trim();
    const valor = limpia.slice(corte + 1).trim().replace(/^["']|["']$/g, '');
    if (valor !== '') env[clave] = valor;
  }

  return env;
}

/** Falla temprano y con un mensaje accionable si falta algo. */
function exigir(env, claves) {
  const faltantes = claves.filter((c) => !env[c]);

  if (faltantes.length > 0) {
    throw new Error(
      `faltan variables en .env: ${faltantes.join(', ')}`
    );
  }

  return Object.fromEntries(claves.map((c) => [c, env[c]]));
}

module.exports = { leerEnv, exigir, RUTA_ENV };
