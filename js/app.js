// js/app.js
import ENV from './config.js';
import { obtenerDatos } from './api.js';
import { renderTabla, mostrarMensaje } from './ui.js';

// Variable para saber qué pestaña estamos viendo
let vistaActual = 'Componentes';

// NUEVO: Función para cruzar datos de Componentes con Kits y calcular dónde se usa cada uno
function calcularKitsPorComponente(componentes, kits) {
    if (!componentes || !kits) return componentes;

    const mapaKits = {};
    
    // Recorremos los kits y agrupamos por ID_Componente
    kits.forEach(kit => {
        const idComp = kit['ID_Componente'];
        const idKit = kit['ID_Kit'];
        if (idComp && idKit) {
            if (!mapaKits[idComp]) mapaKits[idComp] = new Set();
            mapaKits[idComp].add(idKit);
        }
    });

    // Inyectamos la información en el array de componentes
    return componentes.map(comp => {
        const idComp = comp['ID_Componente'];
        // Si el componente está en algún kit, lo unimos con comas. Si no, "Ninguno".
        const kitsUsados = mapaKits[idComp] ? Array.from(mapaKits[idComp]).join(', ') : 'Ninguno';
        
        // Rellenamos la columna 'Kits_que_lo_usan' que ya existe en tu Google Sheet pero está vacía
        comp['Kits_que_lo_usan'] = kitsUsados;
        return comp;
    });
}

// Función principal que carga los datos
async function cargarVista(nombrePestana) {
    vistaActual = nombrePestana;
    
    // MODIFICADO: Manejo defensivo del DOM
    const tituloVista = document.getElementById('titulo-vista');
    
    // Actualizar título
    if (tituloVista) tituloVista.innerText = `Cargando ${nombrePestana}...`;
    
    // Obtener datos de nuestra API (CSV)
    let datos = await obtenerDatos(nombrePestana);
    
    // NUEVO: Si es la pestaña de Componentes, enriquecemos los datos cruzándolos con Kits_Consolas
    if (nombrePestana === 'Componentes') {
        const datosKits = await obtenerDatos('Kits_Consolas');
        datos = calcularKitsPorComponente(datos, datosKits);
    }
    
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
