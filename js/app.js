// js/app.js
import ENV from './config.js';
import { obtenerDatos } from './api.js';
import { renderTabla, mostrarMensaje } from './ui.js';

// Variable para saber qué pestaña estamos viendo
let vistaActual = 'Componentes';

// NUEVO: Función genérica para cruzar datos de cualquier tabla con Kits y calcular dónde se usa cada componente
function calcularKitsPorComponente(datos, kits) {
    if (!datos || !kits) return datos;

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

    // Inyectamos la información en el array de datos (ya sean Componentes o Variantes)
    // MODIFICADO: Añadido .sort() para ordenar por uso de kits (GameCube, SNES, etc.)
    return datos.map(item => {
        const idComp = item['ID_Componente'];
        if (!idComp) return item; // Si la fila no tiene ID_Componente, la devolvemos tal cual
        
        const kitsUsados = mapaKits[idComp] ? Array.from(mapaKits[idComp]).join(', ') : 'Ninguno';
        item['Kits_que_lo_usan'] = kitsUsados;
        return item;
    }).sort((a, b) => {
        const kitA = a['Kits_que_lo_usan'] || 'Ninguno';
        const kitB = b['Kits_que_lo_usan'] || 'Ninguno';
        // Los que no tienen kit ("Ninguno") se van al final
        if (kitA === 'Ninguno' && kitB !== 'Ninguno') return 1;
        if (kitA !== 'Ninguno' && kitB === 'Ninguno') return -1;
        // Orden alfabético por el nombre de los kits
        return kitA.localeCompare(kitB);
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
    
    // MODIFICADO: Aplicar cruce de datos a Componentes y pestañas de Variantes
    if (nombrePestana === 'Componentes' || nombrePestana === 'Variantes_LCSC' || nombrePestana === 'Variantes_AliExpress') {
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
