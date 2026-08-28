// js/pedidos.js
import ENV from './config.js';
import { obtenerDatos, actualizarDatos } from './api.js';
import { mostrarMensaje } from './ui.js';

let pedidosInicializado = false;

export async function inicializarModuloPedidos() {
    if (pedidosInicializado) return;
    
    const select = document.getElementById('select-kit');
    const btnVerificar = document.getElementById('btn-verificar-stock');
    const btnSyncLCSC = document.getElementById('btn-sync-lcsc');
    const btnSyncAli = document.getElementById('btn-sync-aliexpress');
    const btnCancelAli = document.getElementById('btn-cancel-aliexpress');
    const btnSubmitAli = document.getElementById('btn-submit-aliexpress');
    const btnSyncKitsCol = document.getElementById('btn-sync-kits-col'); // NUEVO
    const btnSyncTme = document.getElementById('btn-sync-tme'); // NUEVO
    const btnCancelTme = document.getElementById('btn-cancel-tme'); // NUEVO
    const btnSubmitTme = document.getElementById('btn-submit-tme'); // NUEVO
    const btnSyncTmeAuto = document.getElementById('btn-sync-tme-auto'); // NUEVO

    if (!select || !btnVerificar || !btnSyncLCSC || !btnSyncAli || !btnCancelAli || !btnSubmitAli || !btnSyncKitsCol || !btnSyncTme || !btnCancelTme || !btnSubmitTme || !btnSyncTmeAuto) return;

    const datosKits = await obtenerDatos('Kits_Consolas');
    const kitsUnicos = [...new Set(datosKits.map(k => k['ID_Kit']).filter(k => k))];
    
    select.innerHTML = '<option value="">Selecciona un Kit...</option>';
    kitsUnicos.forEach(kit => {
        const option = document.createElement('option');
        option.value = kit;
        option.textContent = kit;
        select.appendChild(option);
    });

    btnVerificar.addEventListener('click', verificarStock);
    btnSyncLCSC.addEventListener('click', sincronizarLCSC);
    btnSyncAli.addEventListener('click', abrirModalAliExpress);
    btnCancelAli.addEventListener('click', cerrarModalAliExpress);
    btnSubmitAli.addEventListener('click', enviarDatosAliExpress);
    btnSyncKitsCol.addEventListener('click', sincronizarKitsUsados); // NUEVO
    btnSyncTme.addEventListener('click', abrirModalTME); // NUEVO
    btnCancelTme.addEventListener('click', cerrarModalTME); // NUEVO
    btnSubmitTme.addEventListener('click', enviarDatosTME); // NUEVO
    btnSyncTmeAuto.addEventListener('click', sincronizarTME); // NUEVO

    pedidosInicializado = true;
}

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
            stockMapa[idComp] = (stockMapa[idComp] || 0) + uds;
        });

        let todoOk = true;
        let requisitosSumados = {};
        let logDetallado = [];

        requisitosKit.forEach(req => {
            const idComp = req['ID_Componente'];
            const cantidad = parseFloat(req['Cantidad']) || 0;
            requisitosSumados[idComp] = (requisitosSumados[idComp] || 0) + cantidad;
        });

        for (const [idComp, cantidadNecesaria] of Object.entries(requisitosSumados)) {
            const disponible = stockMapa[idComp] || 0;
            let estado, icono;
            if (disponible < cantidadNecesaria) {
                todoOk = false;
                estado = `Faltan ${cantidadNecesaria - disponible} uds`;
                icono = '🔴';
            } else {
                estado = `OK (Disponibles: ${disponible})`;
                icono = '🟢';
            }
            logDetallado.push(`${icono} <strong>${idComp}</strong>: Necesita ${cantidadNecesaria} - ${estado}`);
        }

        let mensajeFinal = todoOk 
            ? `✅ <strong>Stock suficiente</strong> para preparar el kit: ${kitSeleccionado}.<br>` 
            : `❌ <strong>Faltan componentes</strong> para ${kitSeleccionado}.<br>`;
        mensajeFinal += `<div style="margin-top:10px; font-size:12px; color:var(--text-secondary); border-top:1px solid var(--border-color); padding-top:8px;"><em>Log de verificación:</em><br>${logDetallado.join('<br>')}</div>`;

        mostrarMensaje('msg-pedidos', mensajeFinal, !todoOk);
    } catch (error) {
        mostrarMensaje('msg-pedidos', 'Error al verificar el stock.', true);
    }
}

async function sincronizarLCSC() {
    mostrarMensaje('msg-pedidos', '🔄 Enviando orden de sincronización a Google Sheets...', false);
    const exito = await actualizarDatos({ action: 'sync_lcsc' });
    if (exito) {
        if (confirm("✅ ¡Orden recibida!\n\nGoogle está actualizando la hoja en segundo plano.\n\nPulsa Aceptar para refrescar la web cuando veas que ha terminado en tu Google Sheet.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '⏳ Sincronización en proceso. Refresca la web manualmente cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al enviar la orden de sincronización.', true);
    }
}

async function abrirModalAliExpress() {
    const modal = document.getElementById('modal-aliexpress');
    const selectComp = document.getElementById('ali-id-componente');
    if (modal && selectComp) {
        if (selectComp.options.length === 0) {
            const datosComp = await obtenerDatos('Componentes');
            datosComp.forEach(c => {
                if (c['ID_Componente']) {
                    const opt = document.createElement('option');
                    opt.value = c['ID_Componente'];
                    opt.textContent = c['ID_Componente'];
                    selectComp.appendChild(opt);
                }
            });
        }
        modal.style.display = 'flex';
    }
}

function cerrarModalAliExpress() {
    const modal = document.getElementById('modal-aliexpress');
    if (modal) modal.style.display = 'none';
}

async function enviarDatosAliExpress() {
    const idComp = document.getElementById('ali-id-componente').value;
    const uds = document.getElementById('ali-uds-pack').value;
    const precio = document.getElementById('ali-precio-pack').value;
    const stock = document.getElementById('ali-stock-packs').value;

    if (!idComp || !precio || precio <= 0) {
        mostrarMensaje('msg-pedidos', '❌ Faltan datos o el precio no es válido.', true);
        return;
    }

    cerrarModalAliExpress();
    mostrarMensaje('msg-pedidos', '🔄 Enviando variante a Google Sheets...', false);

    const exito = await actualizarDatos({ 
        action: 'update_aliexpress_manual', 
        idComponente: idComp,
        udsPack: uds,
        precioPack: precio,
        stockPacks: stock
    });
    
    if (exito) {
        if (confirm("✅ ¡Variante guardada correctamente!\n\nPulsa Aceptar para refrescar la web y ver los cambios.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '✅ Variante guardada. Refresca la web cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al procesar los datos en Google Sheets.', true);
    }
}

// --- NUEVO: MÓDULO TME (mismo patrón que AliExpress) ---
// NUEVO: Sincronización automática de TME (equivalente a sincronizarLCSC)
async function sincronizarTME() {
    mostrarMensaje('msg-pedidos', '🔄 Enviando orden de sincronización TME a Google Sheets...', false);
    const exito = await actualizarDatos({ action: 'sync_tme' });
    if (exito) {
        if (confirm("✅ ¡Orden recibida!\n\nGoogle está consultando la API de TME en segundo plano.\n\nPulsa Aceptar para refrescar la web cuando veas que ha terminado en tu Google Sheet.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '⏳ Sincronización TME en proceso. Refresca la web manualmente cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al enviar la orden de sincronización TME.', true);
    }
}

async function abrirModalTME() {
    const modal = document.getElementById('modal-tme');
    const selectComp = document.getElementById('tme-id-componente');
    if (modal && selectComp) {
        if (selectComp.options.length === 0) {
            const datosComp = await obtenerDatos('Componentes');
            datosComp.forEach(c => {
                if (c['ID_Componente']) {
                    const opt = document.createElement('option');
                    opt.value = c['ID_Componente'];
                    opt.textContent = c['ID_Componente'];
                    selectComp.appendChild(opt);
                }
            });
        }
        modal.style.display = 'flex';
    }
}

function cerrarModalTME() {
    const modal = document.getElementById('modal-tme');
    if (modal) modal.style.display = 'none';
}

async function enviarDatosTME() {
    const idComp = document.getElementById('tme-id-componente').value;
    const uds = document.getElementById('tme-uds-pack').value;
    const precio = document.getElementById('tme-precio-pack').value;
    const stock = document.getElementById('tme-stock-packs').value;

    if (!idComp || !precio || precio <= 0) {
        mostrarMensaje('msg-pedidos', '❌ Faltan datos o el precio no es válido.', true);
        return;
    }

    cerrarModalTME();
    mostrarMensaje('msg-pedidos', '🔄 Enviando variante TME a Google Sheets...', false);

    const exito = await actualizarDatos({
        action: 'update_tme_manual',
        idComponente: idComp,
        udsPack: uds,
        precioPack: precio,
        stockPacks: stock
    });

    if (exito) {
        if (confirm("✅ ¡Variante TME guardada correctamente!\n\nPulsa Aceptar para refrescar la web y ver los cambios.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '✅ Variante TME guardada. Refresca la web cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al procesar los datos en Google Sheets.', true);
    }
}

// NUEVA FUNCIÓN: Envía la orden a Google Sheets para rellenar la columna R
async function sincronizarKitsUsados() {
    mostrarMensaje('msg-pedidos', '🔄 Actualizando columna "Kits_que_lo_usan" en Google Sheets...', false);
    const exito = await actualizarDatos({ action: 'sync_kits_usados' });
    if (exito) {
        if (confirm("✅ ¡Columna de Kits actualizada en Google Sheets!\n\nPulsa Aceptar para refrescar la web.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '✅ Columna actualizada. Refresca la web cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al actualizar la columna en Google Sheets.', true);
    }
}
