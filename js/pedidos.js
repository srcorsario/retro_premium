// js/pedidos.js
import ENV from './config.js';
import { obtenerDatos, actualizarDatos } from './api.js';
import { mostrarMensaje } from './ui.js';

// Bandera para evitar registrar listeners duplicados
let pedidosInicializado = false;

// Inicializa el módulo cargando los kits en el selector
export async function inicializarModuloPedidos() {
    if (pedidosInicializado) return;
    
    const select = document.getElementById('select-kit');
    const btn = document.getElementById('btn-verificar-stock');
    const btnSync = document.getElementById('btn-sync-proveedores'); // NUEVO
    
    // Manejo defensivo del DOM
    if (!select || !btn) return;

    // Cargar kits en el select
    const datosKits = await obtenerDatos('Kits_Consolas');
    const kitsUnicos = [...new Set(datosKits.map(k => k['ID_Kit']).filter(k => k))]; // Evitar vacíos
    
    select.innerHTML = '<option value="">Selecciona un Kit...</option>';
    kitsUnicos.forEach(kit => {
        const option = document.createElement('option');
        option.value = kit;
        option.textContent = kit;
        select.appendChild(option);
    });

    btn.addEventListener('click', verificarStock);
    
    // NUEVO: Listener para sincronización de proveedores
    if (btnSync) {
        btnSync.addEventListener('click', sincronizarStockProveedores);
    }
    
    pedidosInicializado = true;
}

// Verifica si hay stock suficiente para el kit seleccionado
async function verificarStock() {
    const select = document.getElementById('select-kit');
    if (!select) return;
    
    const kitSeleccionado = select.value;
    
    if (!kitSeleccionado) {
        mostrarMensaje('msg-pedidos', 'Por favor, selecciona un kit primero.', true);
        return;
    }

    mostrarMensaje('msg-pedidos', 'Verificando stock...', false);

    try {
        const [datosKits, datosStock] = await Promise.all([
            obtenerDatos('Kits_Consolas'),
            obtenerDatos('Stock_Almacen')
        ]);

        const requisitosKit = datosKits.filter(k => k['ID_Kit'] === kitSeleccionado);
        const stockMapa = {};
        
        datosStock.forEach(s => {
            const idComp = s['ID_Componente'];
            const uds = parseFloat(s['Uds_Disponibles']) || 0;
            if (stockMapa[idComp]) {
                stockMapa[idComp] += uds;
            } else {
                stockMapa[idComp] = uds;
            }
        });

        let faltantes = [];
        let todoOk = true;
        let requisitosSumados = {};

        requisitosKit.forEach(req => {
            const idComp = req['ID_Componente'];
            const cantidad = parseFloat(req['Cantidad']) || 0;
            if (!requisitosSumados[idComp]) requisitosSumados[idComp] = 0;
            requisitosSumados[idComp] += cantidad;
        });

        for (const [idComp, cantidadNecesaria] of Object.entries(requisitosSumados)) {
            const disponible = stockMapa[idComp] || 0;
            if (disponible < cantidadNecesaria) {
                todoOk = false;
                faltantes.push(`🔴 <strong>${idComp}</strong> (Faltan ${cantidadNecesaria - disponible} uds)`);
            }
        }

        if (todoOk) {
            mostrarMensaje('msg-pedidos', `✅ <strong>Stock suficiente</strong> para preparar el kit: ${kitSeleccionado}.`, false);
        } else {
            mostrarMensaje('msg-pedidos', `❌ <strong>Faltan componentes</strong> para ${kitSeleccionado}:<br>${faltantes.join('<br>')}`, true);
        }
    } catch (error) {
        mostrarMensaje('msg-pedidos', 'Error al verificar el stock.', true);
        console.error(error);
    }
}

// NUEVO: Solicita al backend de Google Apps Script que actualice el stock de LCSC y AliExpress
export async function sincronizarStockProveedores() {
    mostrarMensaje('msg-pedidos', '🔄 Solicitando actualización a Google Sheets (LCSC/AliExpress)...', false);
    
    // Usamos actualizarDatos para enviar una acción específica al backend
    // El backend deberá interpretar esta acción, hacer las peticiones HTTP a los proveedores y actualizar la hoja
    const exito = await actualizarDatos({ action: 'sync_stock_proveedores' });
    
    if (exito) {
        mostrarMensaje('msg-pedidos', '✅ Sincronización completada. Actualizando vista...', false);
        // Recargar la página después de 2 segundos para que obtenerDatos traiga el CSV actualizado
        setTimeout(() => location.reload(), 2000);
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al sincronizar. Asegúrate de que el Google Apps Script soporta la acción "sync_stock_proveedores".', true);
    }
}

// Mantenemos la función original por compatibilidad hacia atrás
export async function simularPreparacionKit() {
    verificarStock();
}
