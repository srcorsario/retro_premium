// js/pedidos.js
import ENV from './config.js';
import { obtenerDatos, actualizarDatos } from './api.js';
import { mostrarMensaje } from './ui.js';

let pedidosInicializado = false;

export async function inicializarModuloPedidos() {
    if (pedidosInicializado) return;
    
    const select = document.getElementById('select-kit');
    const btnVerificar = document.getElementById('btn-verificar-stock');
    // MODIFICADO: los botones sueltos de sincronización (LCSC, TME auto, Col Kits, Proveedores,
    // Pack/Precio) se sustituyen por uno solo que encadena las 5 sincronizaciones en Apps Script.
    const btnSyncTodo = document.getElementById('btn-sync-todo');
    const btnSyncAli = document.getElementById('btn-sync-aliexpress');
    const btnCancelAli = document.getElementById('btn-cancel-aliexpress');
    const btnSubmitAli = document.getElementById('btn-submit-aliexpress');
    const btnSyncTme = document.getElementById('btn-sync-tme'); // asistente manual TME (respaldo)
    const btnCancelTme = document.getElementById('btn-cancel-tme');
    const btnSubmitTme = document.getElementById('btn-submit-tme');
    // NUEVO: modal "➕ Añadir Stock" (pestaña Stock Físico) -- el botón que lo abre (#btn-add-stock)
    // NO está aquí: se inyecta dinámicamente en ui.js cada vez que se carga esa pestaña, así que se
    // engancha por delegación de eventos más abajo en vez de un addEventListener directo.
    const btnCancelStock = document.getElementById('btn-cancel-stock');
    const btnSubmitStock = document.getElementById('btn-submit-stock');

    if (!select || !btnVerificar || !btnSyncTodo || !btnSyncAli || !btnCancelAli || !btnSubmitAli || !btnSyncTme || !btnCancelTme || !btnSubmitTme || !btnCancelStock || !btnSubmitStock) return;

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
    btnSyncTodo.addEventListener('click', sincronizarTodo); // NUEVO: botón único
    btnSyncAli.addEventListener('click', abrirModalAliExpress);
    btnCancelAli.addEventListener('click', cerrarModalAliExpress);
    btnSubmitAli.addEventListener('click', enviarDatosAliExpress);
    btnSyncTme.addEventListener('click', abrirModalTME);
    btnCancelTme.addEventListener('click', cerrarModalTME);
    btnSubmitTme.addEventListener('click', enviarDatosTME);
    btnCancelStock.addEventListener('click', cerrarModalStock);
    btnSubmitStock.addEventListener('click', enviarDatosStock);

    // NUEVO: #btn-add-stock se regenera cada vez que ui.js vuelve a pintar la pestaña Stock Físico
    // (renderTabla reemplaza el contenedor entero), así que un addEventListener normal se perdería
    // en cuanto se cambiara de pestaña y se volviera. Delegando el click en document (que sí es
    // estable) el botón funciona sin importar cuántas veces se haya regenerado.
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-add-stock')) abrirModalStock();
    });

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

// NUEVO: Sustituye a sincronizarLCSC + sincronizarTME + sincronizarKitsUsados +
// sincronizarProveedoresKits + sincronizarPackPrecioKits -- un único botón que en Apps Script
// (acción 'sync_todo', ver Codigo.gs -> ejecutarSincronizacionCompleta) encadena las 5
// sincronizaciones seguidas: LCSC, TME, y las 3 columnas derivadas de Kits_Consolas.
// MODIFICADO: la petición se manda con fetch(mode:'no-cors'), que SÍ espera a que Apps Script
// termine de verdad antes de resolver (aunque no podamos leer su respuesta) -- así que mientras
// tanto no pasaba nada en pantalla y parecía colgado. Ahora se ve un contador en marcha. Se usa
// un contador que SUMA segundos (no una cuenta atrás fija a 60) porque la duración real depende
// de cuántos componentes tengas -- con muchos puede pasar de 60s, y una cuenta atrás llegando a
// 0 antes de tiempo daría la falsa impresión de que ya terminó cuando sigue trabajando.
async function sincronizarTodo() {
    let segundos = 0;
    const actualizarContador = () => {
        mostrarMensaje('msg-pedidos', `🔄 Sincronizando LCSC + TME + columnas de Kits... (${segundos}s transcurridos, normalmente 1-2 min)`, false);
    };
    actualizarContador();
    const intervalo = setInterval(() => {
        segundos++;
        actualizarContador();
    }, 1000);

    const exito = await actualizarDatos({ action: 'sync_todo' });
    clearInterval(intervalo);

    if (exito) {
        if (confirm(`✅ ¡Sincronización completa! (tardó ${segundos}s)\n\nGoogle ha terminado de sincronizar LCSC, TME y las columnas de Kits.\n\nPulsa Aceptar para refrescar la web y ver los cambios.`)) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', `✅ Sincronización completa (${segundos}s). Refresca la web cuando quieras.`, false);
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

// --- NUEVO: MÓDULO STOCK FÍSICO (mismo patrón que AliExpress/TME, pero con un desplegable
// de componentes ÚNICOS -- aquí no importa el proveedor, solo qué componente es) ---
async function abrirModalStock() {
    const modal = document.getElementById('modal-stock');
    const selectComp = document.getElementById('stock-id-componente');
    if (modal && selectComp) {
        if (selectComp.options.length === 0) {
            const datosComp = await obtenerDatos('Componentes');
            // MODIFICADO: Componentes tiene una fila por (componente, proveedor), así que un mismo
            // ID_Componente puede repetirse hasta 3 veces -- aquí se quiere "cada TIPO de
            // componente" una sola vez en el desplegable, ordenado alfabéticamente para encontrarlo
            // rápido entre decenas de piezas.
            const idsUnicos = [...new Set(datosComp.map(c => c['ID_Componente']).filter(id => id))]
                .sort((a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }));
            idsUnicos.forEach(id => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                selectComp.appendChild(opt);
            });
        }
        modal.style.display = 'flex';
    }
}

function cerrarModalStock() {
    const modal = document.getElementById('modal-stock');
    if (modal) modal.style.display = 'none';
}

async function enviarDatosStock() {
    const idComp = document.getElementById('stock-id-componente').value;
    const cantidad = document.getElementById('stock-cantidad').value;

    if (!idComp || !cantidad || cantidad <= 0) {
        mostrarMensaje('msg-pedidos', '❌ Selecciona un componente e indica una cantidad válida.', true);
        return;
    }

    cerrarModalStock();
    mostrarMensaje('msg-pedidos', '🔄 Añadiendo stock en Google Sheets...', false);

    // NUEVO: action 'update_stock_manual' (Codigo.gs -> guardarStockManual) SUMA esta cantidad al
    // stock ya existente de ese componente, o crea la fila si todavía no tenía ninguna.
    const exito = await actualizarDatos({
        action: 'update_stock_manual',
        idComponente: idComp,
        cantidad: cantidad
    });

    if (exito) {
        if (confirm("✅ ¡Stock actualizado correctamente!\n\nPulsa Aceptar para refrescar la web y ver los cambios.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '✅ Stock actualizado. Refresca la web cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al procesar los datos en Google Sheets.', true);
    }
}

