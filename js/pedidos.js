// js/pedidos.js
// MODIFICADO: Corregido import - config.js exporta ENV como default, no CONFIG como named export
import ENV from './config.js';
import { obtenerDatos, actualizarDatos } from './api.js';
import { mostrarMensaje } from './ui.js';

// Función de prueba que crearemos bien en el siguiente paso
export async function simularPreparacionKit() {
    mostrarMensaje('msg-pedidos', 'Calculando pedido...', false);
    
    // 1. Obtener componentes del kit
    // 2. Obtener stock actual
    // 3. Restar stock
    // 4. Enviar actualización a Sheets
    
    mostrarMensaje('msg-pedidos', 'Lógica pendiente de desarrollar.', true);
}
