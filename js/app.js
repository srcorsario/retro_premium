// js/app.js
import ENV from './config.js';
import { obtenerDatos } from './api.js';
import { renderTabla, mostrarMensaje } from './ui.js';
import { inicializarModuloPedidos } from './pedidos.js'; 

// Variable para saber qué pestaña estamos viendo
let vistaActual = 'Componentes';

// Función genérica para cruzar datos de cualquier tabla con Kits y calcular dónde se usa cada componente
function calcularKitsPorComponente(datos, kits) {
    if (!datos || !kits) return datos;

    const mapaKits = {};
    
    kits.forEach(kit => {
        const idComp = kit['ID_Componente'];
        const idKit = kit['ID_Kit'];
        if (idComp && idKit) {
            if (!mapaKits[idComp]) mapaKits[idComp] = new Set();
            mapaKits[idComp].add(idKit);
        }
    });

    return datos.map(item => {
        const idComp = item['ID_Componente'];
        if (!idComp) return item;
        
        const kitsUsados = mapaKits[idComp] ? Array.from(mapaKits[idComp]).join(', ') : 'Ninguno';
        item['Kits_que_lo_usan'] = kitsUsados;
        return item;
    }).sort((a, b) => {
        const kitA = a['Kits_que_lo_usan'] || 'Ninguno';
        const kitB = b['Kits_que_lo_usan'] || 'Ninguno';
        if (kitA === 'Ninguno' && kitB !== 'Ninguno') return 1;
        if (kitA !== 'Ninguno' && kitB === 'Ninguno') return -1;
        return kitA.localeCompare(kitB);
    });
}

// Función principal que carga los datos
async function cargarVista(nombrePestana) {
    vistaActual = nombrePestana;
    
    const tituloVista = document.getElementById('titulo-vista');
    
    if (tituloVista) tituloVista.innerText = `Cargando ${nombrePestana}...`;
    
    let datos = await obtenerDatos(nombrePestana);
    
    if (nombrePestana === 'Componentes' || nombrePestana === 'Variantes_LCSC' || nombrePestana === 'Variantes_AliExpress' || nombrePestana === 'Variantes_TME') {
        const datosKits = await obtenerDatos('Kits_Consolas');
        datos = calcularKitsPorComponente(datos, datosKits);
    }
    
    renderTabla('contenedor-tabla', datos, nombrePestana);
    
    if (tituloVista) tituloVista.innerText = `${nombrePestana} (${datos.length} registros)`;
}

// Cuando la web esté lista
document.addEventListener('DOMContentLoaded', () => {
    console.log(`${ENV.APP_NAME} iniciado`);
    
    // Cargar la pestaña por defecto
    cargarVista(vistaActual);
    
    // Inicializar el módulo de pedidos para el selector de kits y botones
    inicializarModuloPedidos();
    
    // Poner a escuchar los botones de las pestañas
    const botones = document.querySelectorAll('.tab-btn');
    if (botones && botones.length > 0) {
        botones.forEach(boton => {
            boton.addEventListener('click', (e) => {
                botones.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                const pestana = e.target.getAttribute('data-sheet');
                if (pestana) cargarVista(pestana);
            });
        });
    }
});
