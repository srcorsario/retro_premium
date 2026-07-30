// js/app.js
import { CONFIG } from './config.js';
import { obtenerDatos } from './api.js';
import { renderTabla } from './ui.js';
import { simularPreparacionKit } from './pedidos.js';

// Función que se ejecuta al pulsar una pestaña
async function cargarVista(nombreHoja, contenedorID) {
    const datos = await obtenerDatos(nombreHoja);
    renderTabla(contenedorID, datos);
}

// Cuando el HTML esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
    console.log('Aplicación Retro Components iniciada');
    
    // Cargamos la vista principal por defecto (Ej. Componentes)
    cargarVista(CONFIG.SHEETS.COMPONENTES, 'tbody-principal');
    
    // Event listeners (Ejemplo de cómo conectar un botón a la lógica de pedidos)
    const btnPedido = document.getElementById('btn-simular-pedido');
    if(btnPedido) {
        btnPedido.addEventListener('click', simularPreparacionKit);
    }
});