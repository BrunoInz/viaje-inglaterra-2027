'use strict';

/**
 * Cliente minimo de la API publica de n8n.
 *
 * Solo lo que necesita el deploy. Ningun valor de credencial se escribe al
 * log: los errores muestran el status y el mensaje de n8n, nunca el body que
 * se envio.
 */

class ErrorN8n extends Error {
  constructor(metodo, ruta, status, detalle) {
    super(`${metodo} ${ruta} -> HTTP ${status}${detalle ? `: ${detalle}` : ''}`);
    this.name = 'ErrorN8n';
    this.status = status;
  }
}

function crearCliente({ baseUrl, apiKey }) {
  const raiz = `${String(baseUrl).replace(/\/+$/, '')}/api/v1`;

  async function pedir(metodo, ruta, cuerpo) {
    let respuesta;

    try {
      respuesta = await fetch(`${raiz}${ruta}`, {
        method: metodo,
        headers: {
          'X-N8N-API-KEY': apiKey,
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      });
    } catch (error) {
      throw new Error(`no se pudo conectar a ${baseUrl}: ${error.message}`);
    }

    const texto = await respuesta.text();
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = null;
    }

    if (!respuesta.ok) {
      const detalle = datos && datos.message ? datos.message : texto.slice(0, 200);
      throw new ErrorN8n(metodo, ruta, respuesta.status, detalle);
    }

    return datos;
  }

  return {
    listarWorkflows: async () => {
      const todos = [];
      let cursor = null;

      // La API pagina de a 100 aunque se pida mas: sin el cursor, una
      // instancia con cientos de workflows haria creer que el del tracker
      // no existe y el deploy crearia duplicados en cada corrida.
      do {
        const query = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const pagina = await pedir('GET', `/workflows${query}`);
        todos.push(...(pagina.data || []));
        cursor = pagina.nextCursor || null;
      } while (cursor);

      return todos;
    },
    crearWorkflow: (wf) => pedir('POST', '/workflows', wf),
    actualizarWorkflow: (id, wf) => pedir('PUT', `/workflows/${id}`, wf),
    activarWorkflow: (id) => pedir('POST', `/workflows/${id}/activate`),
    desactivarWorkflow: (id) => pedir('POST', `/workflows/${id}/deactivate`),
    crearCredencial: (cred) => pedir('POST', '/credentials', cred),
    borrarCredencial: (id) => pedir('DELETE', `/credentials/${id}`),
  };
}

module.exports = { crearCliente, ErrorN8n };
