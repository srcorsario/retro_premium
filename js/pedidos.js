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
    const btnVerificar = document.getElementById('btn-verificar-stock');
    const btnSyncLCSC = document.getElementById('btn-sync-lcsc');
    const btnSyncAli = document.getElementById('btn-sync-aliexpress');
    const btnCancelAli = document.getElementById('btn-cancel-aliexpress');
    const btnSubmitAli = document.getElementById('btn-submit-aliexpress');
    
    // Manejo defensivo del DOM
    if (!select || !btnVerificar || !btnSyncLCSC || !btnSyncAli || !btnCancelAli || !btnSubmitAli) return;

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

    // Asignar listeners
    btnVerificar.addEventListener('click', verificarStock);
    btnSyncLCSC.addEventListener('click', sincronizarLCSC);
    btnSyncAli.addEventListener('click', abrirModalAliExpress);
    btnCancelAli.addEventListener('click', cerrarModalAliExpress);
    btnSubmitAli.addEventListener('click', enviarDatosAliExpress);
    
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

// NUEVO: Solicita al backend que actualice el stock de LCSC automáticamente
async function sincronizarLCSC() {
    mostrarMensaje('msg-pedidos', '🔄 Sincronizando LCSC en Google Sheets...', false);
    
    const exito = await actualizarDatos({ action: 'sync_lcsc' });
    
    if (exito) {
        mostrarMensaje('msg-pedidos', '✅ Sincronización LCSC completada. Actualizando vista...', false);
        setTimeout(() => location.reload(), 2000);
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al sincronizar LCSC. Verifica el backend de Apps Script.', true);
    }
}

// NUEVO: Muestra el pop-up para pegar los datos de AliExpress
function abrirModalAliExpress() {
    const modal = document.getElementById('modal-aliexpress');
    const textarea = document.getElementById('aliexpress-raw-data');
    if (modal && textarea) {
        textarea.value = ''; // Limpiar por si se quedó texto viejo
        modal.style.display = 'flex';
    }
}

// NUEVO: Oculta el pop-up
function cerrarModalAliExpress() {
    const modal = document.getElementById('modal-aliexpress');
    if (modal) {
        modal.style.display = 'none';
    }
}

// NUEVO: Envía el texto pegado en el modal al backend de Google Apps Script
async function enviarDatosAliExpress() {
    const textarea = document.getElementById('aliexpress-raw-data');
    if (!textarea) return;
    
    const rawData = textarea.value.trim();
    if (!rawData) {
        mostrarMensaje('msg-pedidos', '❌ El cuadro de texto está vacío.', true);
        return;
    }

    cerrarModalAliExpress();
    mostrarMensaje('msg-pedidos', '🔄 Enviando datos de AliExpress a Google Sheets...', false);

    // Enviamos el texto plano al backend para que lo procese
    const exito = await actualizarDatos({ action: 'update_aliexpress_manual', raw_data: rawData });
    
    if (exito) {
        mostrarMensaje('msg-pedidos', '✅ Datos de AliExpress actualizados. Recargando vista...', false);
        setTimeout(() => location.reload(), 2000);
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al procesar los datos en Google Sheets.', true);
    }
}

// Mantenemos la función original por compatibilidad hacia atrás
export async function simularPreparacionKit() {
    verificarStock();
}
