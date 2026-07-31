// js/app.js
import ENV from './config.js';
import { obtenerDatos } from './api.js';
import { renderTabla, mostrarMensaje } from './ui.js';

// Variable para saber qué pestaña estamos viendo
let vistaActual = 'Componentes';

// Función principal que carga los datos
async function cargarVista(nombrePestana) {
    vistaActual = nombrePestana;
    
    // MODIFICADO: Manejo defensivo del DOM
    const tituloVista = document.getElementById('titulo-vista');
    
    // Actualizar título
    if (tituloVista) tituloVista.innerText = `Cargando ${nombrePestana}...`;
    
    // Obtener datos de nuestra API (CSV)
    const datos = await obtenerDatos(nombrePestana);
    
    // Pintar en la pantalla
    renderTabla('contenedor-tabla', datos, nombrePestana);
    
    // Cambiar título
    if (tituloVista) tituloVista.innerText = `${nombrePestana} (${datos.length} registros)`;
}

// Cuando la web esté lista
document.addEventListener('DOMContentLoaded', () => {
    console.log(`${ENV.APP_NAME} iniciado`);
    
    // Cargar la pestaña por defecto
    cargarVista(vistaActual);
    
    // Poner a escuchar los botones de las pestañas
    const botones = document.querySelectorAll('.tab-btn');
    // MODIFICADO: Manejo defensivo del DOM
    if (botones && botones.length > 0) {
        botones.forEach(boton => {
            boton.addEventListener('click', (e) => {
                // Quitar clase active a todos
                botones.forEach(b => b.classList.remove('active'));
                // Poner clase active al clicado
                e.target.classList.add('active');
                
                // Cargar la pestaña correspondiente
                const pestana = e.target.getAttribute('data-sheet');
                if (pestana) cargarVista(pestana);
            });
        });
    }
});
