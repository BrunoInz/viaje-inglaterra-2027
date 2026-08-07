'use strict';

/**
 * Mock minimo de la API de Google Apps Script, para poder ejercitar
 * scripts/setup-sheet.gs en Node.
 *
 * Solo implementa lo que el script usa. Reproduce dos comportamientos reales
 * que son los que rompieron en produccion:
 *
 *  - `getActiveSpreadsheet()` devuelve **null** (no lanza) cuando el proyecto
 *    de Apps Script no esta vinculado a un documento.
 *  - `getUi()` **lanza** en ese mismo caso, en vez de devolver null.
 */

class HojaMock {
  constructor(nombre) {
    this.nombre = nombre;
    this.celdas = [];        // matriz [fila][columna], 0-indexada
    this.filasCongeladas = 0;
    this.negritas = [];
  }

  getName() {
    return this.nombre;
  }

  getLastRow() {
    for (let i = this.celdas.length - 1; i >= 0; i -= 1) {
      const fila = this.celdas[i] || [];
      if (fila.some((c) => c !== '' && c !== null && c !== undefined)) return i + 1;
    }
    return 0;
  }

  getRange(fila, columna, nFilas = 1, nColumnas = 1) {
    const hoja = this;

    return {
      setValues(matriz) {
        if (matriz.length !== nFilas) {
          throw new Error(`setValues: se esperaban ${nFilas} filas, llegaron ${matriz.length}`);
        }
        matriz.forEach((valores, i) => {
          if (valores.length !== nColumnas) {
            throw new Error(
              `setValues: fila ${i} con ${valores.length} columnas, se esperaban ${nColumnas}`
            );
          }
          const f = fila - 1 + i;
          hoja.celdas[f] = hoja.celdas[f] || [];
          valores.forEach((v, j) => { hoja.celdas[f][columna - 1 + j] = v; });
        });
        return this;
      },
      getValues() {
        const salida = [];
        for (let i = 0; i < nFilas; i += 1) {
          const f = hoja.celdas[fila - 1 + i] || [];
          const linea = [];
          for (let j = 0; j < nColumnas; j += 1) {
            const v = f[columna - 1 + j];
            linea.push(v === undefined ? '' : v);
          }
          salida.push(linea);
        }
        return salida;
      },
      clearContent() {
        for (let i = 0; i < nFilas; i += 1) {
          const f = fila - 1 + i;
          if (!hoja.celdas[f]) continue;
          for (let j = 0; j < nColumnas; j += 1) hoja.celdas[f][columna - 1 + j] = '';
        }
        return this;
      },
      setFontWeight(peso) {
        hoja.negritas.push({ fila, columna, nFilas, nColumnas, peso });
        return this;
      },
    };
  }

  setFrozenRows(n) {
    this.filasCongeladas = n;
  }

  autoResizeColumns() {}
}

class LibroMock {
  constructor(nombre, { conHojaPorDefecto = false } = {}) {
    this.nombre = nombre;
    this.id = `id-${nombre}`;
    this.hojas = conHojaPorDefecto ? [new HojaMock('Hoja 1')] : [];
  }

  getName() { return this.nombre; }

  getId() { return this.id; }

  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }

  getSheetByName(nombre) {
    return this.hojas.find((h) => h.nombre === nombre) || null;
  }

  insertSheet(nombre) {
    const hoja = new HojaMock(nombre);
    this.hojas.push(hoja);
    return hoja;
  }

  getSheets() { return this.hojas; }

  deleteSheet(hoja) {
    this.hojas = this.hojas.filter((h) => h !== hoja);
  }
}

/**
 * @param {object} opciones
 * @param {LibroMock|null} opciones.activa   planilla activa (null = script suelto)
 * @param {boolean} opciones.conUi           si getUi() funciona
 * @param {string}  opciones.respuestaPrompt texto que "escribe" el usuario
 */
function crearEntorno({ activa = null, conUi = false, respuestaPrompt = '' } = {}) {
  const log = [];
  const alertas = [];
  const creadas = [];

  const ui = {
    ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
    Button: { OK: 'OK', CANCEL: 'CANCEL' },
    alert: (mensaje) => alertas.push(mensaje),
    prompt: () => ({
      getSelectedButton: () => (respuestaPrompt ? 'OK' : 'CANCEL'),
      getResponseText: () => respuestaPrompt,
    }),
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => activa,
    openById: (id) => {
      const libro = new LibroMock(`abierta-${id}`);
      libro.id = id;
      return libro;
    },
    create: (nombre) => {
      const libro = new LibroMock(nombre, { conHojaPorDefecto: true });
      creadas.push(libro);
      return libro;
    },
    getUi: () => {
      if (!conUi) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
      return ui;
    },
  };

  return {
    contexto: { SpreadsheetApp, Logger: { log: (m) => log.push(String(m)) } },
    log,
    alertas,
    creadas,
  };
}

module.exports = { crearEntorno, LibroMock, HojaMock };
