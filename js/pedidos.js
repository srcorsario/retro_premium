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
    // NUEVO (2026-09-09): modal "🚚 Añadir Stock en Camino" y modal "✅ Recibir" (traspaso parcial)
    // -- mismo patrón que el resto: botones que abren estos modales se inyectan dinámicamente en
    // ui.js (#btn-add-stock-camino en la barra de herramientas, .btn-recibir-stock por fila), así
    // que se enganchan por delegación de eventos más abajo.
    const btnCancelStockCamino = document.getElementById('btn-cancel-stock-camino');
    const btnSubmitStockCamino = document.getElementById('btn-submit-stock-camino');
    const btnCancelRecibir = document.getElementById('btn-cancel-recibir');
    const btnSubmitRecibir = document.getElementById('btn-submit-recibir');
    // NUEVO (2026-09-10): modal "📦 Nuevo Pedido" -- mismo patrón, el botón que lo abre
    // (#btn-nuevo-pedido) se inyecta dinámicamente en ui.js junto a #btn-add-stock, así que se
    // engancha por delegación más abajo; el resto de controles sí son fijos (viven en el modal
    // estático de index.html, que no se regenera al cambiar de pestaña).
    const btnCancelPedido = document.getElementById('btn-cancel-pedido');
    const btnSubmitPedido = document.getElementById('btn-submit-pedido');
    const btnAddLineaPedido = document.getElementById('btn-add-linea-pedido');
    const selectProveedorPedido = document.getElementById('pedido-proveedor');
    const checkAduanaPedido = document.getElementById('pedido-aplica-aduana');

    if (!select || !btnVerificar || !btnSyncTodo || !btnSyncAli || !btnCancelAli || !btnSubmitAli || !btnSyncTme || !btnCancelTme || !btnSubmitTme || !btnCancelStock || !btnSubmitStock || !btnCancelStockCamino || !btnSubmitStockCamino || !btnCancelRecibir || !btnSubmitRecibir || !btnCancelPedido || !btnSubmitPedido || !btnAddLineaPedido || !selectProveedorPedido || !checkAduanaPedido) return;

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
    btnCancelStockCamino.addEventListener('click', cerrarModalStockCamino);
    btnSubmitStockCamino.addEventListener('click', enviarDatosStockCamino);
    btnCancelRecibir.addEventListener('click', cerrarModalRecibir);
    btnSubmitRecibir.addEventListener('click', enviarDatosRecibir);
    // NUEVO (2026-09-10): modal "📦 Nuevo Pedido".
    btnCancelPedido.addEventListener('click', cerrarModalPedido);
    btnSubmitPedido.addEventListener('click', enviarDatosPedido);
    btnAddLineaPedido.addEventListener('click', agregarLineaPedido);
    selectProveedorPedido.addEventListener('change', () => {
        const otro = document.getElementById('pedido-proveedor-otro');
        if (otro) otro.style.display = selectProveedorPedido.value === 'OTRO' ? 'block' : 'none';
    });
    checkAduanaPedido.addEventListener('change', () => {
        const wrap = document.getElementById('pedido-aduana-wrap');
        if (wrap) wrap.style.display = checkAduanaPedido.checked ? 'block' : 'none';
    });

    // NUEVO: #btn-add-stock (y ahora también #btn-add-stock-camino y .btn-recibir-stock) se
    // regeneran cada vez que ui.js vuelve a pintar la pestaña Stock Físico (renderTabla reemplaza
    // el contenedor entero), así que un addEventListener normal se perdería en cuanto se cambiara
    // de pestaña y se volviera. Delegando el click en document (que sí es estable) los botones
    // funcionan sin importar cuántas veces se hayan regenerado.
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-add-stock')) abrirModalStock();

        if (e.target.closest('#btn-add-stock-camino')) abrirModalStockCamino();

        if (e.target.closest('#btn-nuevo-pedido')) abrirModalPedido();

        const btnRecibir = e.target.closest('.btn-recibir-stock');
        if (btnRecibir) {
            const idComp = btnRecibir.getAttribute('data-id');
            const maxEnCamino = parseFloat(btnRecibir.getAttribute('data-max')) || 0;
            abrirModalRecibir(idComp, maxEnCamino);
        }
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
        // NUEVO (2026-09-09): el "stock disponible" para verificar un kit ya cuenta también lo que
        // está "en camino" (pedido pero todavía sin llegar), no solo lo físico en almacén -- a
        // petición del usuario, para planificar con lo que va a estar disponible pronto. Se guarda
        // por separado (uds/enCamino) para poder detallarlo en el log de abajo.
        const stockMapa = {};
        datosStock.forEach(s => {
            const idComp = s['ID_Componente'];
            if (!stockMapa[idComp]) stockMapa[idComp] = { uds: 0, enCamino: 0 };
            stockMapa[idComp].uds += parseFloat(s['Uds_Disponibles']) || 0;
            stockMapa[idComp].enCamino += parseFloat(s['Stock_En_Camino']) || 0;
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
            const stockComp = stockMapa[idComp] || { uds: 0, enCamino: 0 };
            const disponible = stockComp.uds + stockComp.enCamino;
            // NUEVO: si hay algo "en camino" contando para el total, se detalla el desglose para
            // que quede claro cuánto es físico ahora mismo y cuánto todavía no ha llegado.
            const detalleCamino = stockComp.enCamino > 0
                ? ` (${stockComp.uds} en almacén + ${stockComp.enCamino} en camino)`
                : '';
            let estado, icono;
            if (disponible < cantidadNecesaria) {
                todoOk = false;
                estado = `Faltan ${cantidadNecesaria - disponible} uds (disponibles: ${disponible}${detalleCamino})`;
                icono = '🔴';
            } else {
                estado = `OK (Disponibles: ${disponible}${detalleCamino})`;
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

// --- NUEVO (2026-09-09): MÓDULO STOCK EN CAMINO (mismo patrón que "➕ Añadir Stock", pero
// escribe en la columna Stock_En_Camino en vez de Uds_Disponibles -- ver guardarStockEnCamino en
// Codigo.gs) ---
async function abrirModalStockCamino() {
    const modal = document.getElementById('modal-stock-camino');
    const selectComp = document.getElementById('stock-camino-id-componente');
    if (modal && selectComp) {
        if (selectComp.options.length === 0) {
            const datosComp = await obtenerDatos('Componentes');
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

function cerrarModalStockCamino() {
    const modal = document.getElementById('modal-stock-camino');
    if (modal) modal.style.display = 'none';
}

async function enviarDatosStockCamino() {
    const idComp = document.getElementById('stock-camino-id-componente').value;
    const cantidad = document.getElementById('stock-camino-cantidad').value;

    if (!idComp || !cantidad || cantidad <= 0) {
        mostrarMensaje('msg-pedidos', '❌ Selecciona un componente e indica una cantidad válida.', true);
        return;
    }

    cerrarModalStockCamino();
    mostrarMensaje('msg-pedidos', '🔄 Registrando stock en camino en Google Sheets...', false);

    const exito = await actualizarDatos({
        action: 'update_stock_en_camino',
        idComponente: idComp,
        cantidad: cantidad
    });

    if (exito) {
        if (confirm("✅ ¡Stock en camino registrado!\n\nPulsa Aceptar para refrescar la web y ver los cambios.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '✅ Stock en camino registrado. Refresca la web cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al procesar los datos en Google Sheets.', true);
    }
}

// --- NUEVO (2026-09-09): MÓDULO RECIBIR STOCK EN CAMINO (traspaso PARCIAL editable a
// Uds_Disponibles -- ver recibirStockEnCamino en Codigo.gs). Se abre desde el botón "✅ Recibir"
// de cada fila de la pestaña Stock Físico (ver .btn-recibir-stock en ui.js/pedidos.js), que ya
// trae el ID de componente y el máximo que hay en camino (no se puede recibir más de eso). ---
let recibirIdComponenteActual = null;
let recibirMaxActual = 0;

function abrirModalRecibir(idComponente, maxEnCamino) {
    const modal = document.getElementById('modal-recibir');
    const info = document.getElementById('recibir-info');
    const input = document.getElementById('recibir-cantidad');
    if (!modal || !info || !input) return;

    recibirIdComponenteActual = idComponente;
    recibirMaxActual = maxEnCamino;

    info.textContent = `${idComponente}: hay ${maxEnCamino} uds en camino.`;
    input.value = maxEnCamino; // por defecto, recibir todo -- editable si solo llegó parte del pedido
    input.max = maxEnCamino;
    modal.style.display = 'flex';
}

function cerrarModalRecibir() {
    const modal = document.getElementById('modal-recibir');
    if (modal) modal.style.display = 'none';
    recibirIdComponenteActual = null;
    recibirMaxActual = 0;
}

async function enviarDatosRecibir() {
    const cantidad = parseFloat(document.getElementById('recibir-cantidad').value);
    const idComp = recibirIdComponenteActual;

    if (!idComp || !cantidad || cantidad <= 0) {
        mostrarMensaje('msg-pedidos', '❌ Indica una cantidad recibida válida.', true);
        return;
    }
    if (cantidad > recibirMaxActual) {
        mostrarMensaje('msg-pedidos', `❌ Solo hay ${recibirMaxActual} uds en camino de ${idComp}, no se pueden recibir ${cantidad}.`, true);
        return;
    }

    cerrarModalRecibir();
    mostrarMensaje('msg-pedidos', '🔄 Traspasando a almacén en Google Sheets...', false);

    const exito = await actualizarDatos({
        action: 'recibir_stock_en_camino',
        idComponente: idComp,
        cantidad: cantidad
    });

    if (exito) {
        if (confirm("✅ ¡Stock recibido y traspasado a almacén!\n\nPulsa Aceptar para refrescar la web y ver los cambios.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '✅ Stock recibido. Refresca la web cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al procesar los datos en Google Sheets.', true);
    }
}

// --- NUEVO (2026-09-10): MÓDULO NUEVO PEDIDO (pestaña Stock Físico) -- registra un pedido
// completo (proveedor, gastos de envío/aduana y N líneas de artículos) para que Codigo.gs
// (acción 'guardar_pedido_completo') reparta el gasto extra proporcionalmente al valor de cada
// línea, guarde el desglose en las hojas "Pedidos"/"Pedidos_Detalle", y sume la cantidad al stock
// físico de cada componente actualizando su coste medio ponderado ("Precio_Real_Medio" en
// Stock_Almacen). Mismo patrón general que el resto de modales, pero con líneas dinámicas: cada
// "+ Añadir línea" crea una fila con su propio <select> de componente (compartiendo la misma
// lista de IDs únicos que ya usa el modal "➕ Añadir Stock").
let idsComponentesPedidoCache = null;

async function obtenerIdsComponentesPedido() {
    if (!idsComponentesPedidoCache) {
        const datosComp = await obtenerDatos('Componentes');
        idsComponentesPedidoCache = [...new Set(datosComp.map(c => c['ID_Componente']).filter(id => id))]
            .sort((a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }));
    }
    return idsComponentesPedidoCache;
}

// Crea una fila de línea de pedido (select de componente + cantidad + precio unitario + botón de
// quitar). El botón de quitar se engancha aquí mismo al crear la fila (no por delegación) porque
// el modal en sí es estático -- no se regenera al cambiar de pestaña, así que no hay riesgo de
// perder el listener.
function crearFilaLineaPedido(idsComponentes) {
    const fila = document.createElement('div');
    fila.className = 'pedido-linea-row';
    fila.style.cssText = 'display:flex; gap:8px; align-items:center;';

    const selectComp = document.createElement('select');
    selectComp.className = 'pedido-linea-componente';
    selectComp.style.cssText = 'flex:2; padding:6px; background:var(--bg-color); color:var(--text-main); border:1px solid var(--border-color); border-radius:4px; box-sizing:border-box;';
    const optVacia = document.createElement('option');
    optVacia.value = '';
    optVacia.textContent = '-- Componente --';
    selectComp.appendChild(optVacia);
    idsComponentes.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        selectComp.appendChild(opt);
    });

    const inputCantidad = document.createElement('input');
    inputCantidad.type = 'number';
    inputCantidad.className = 'pedido-linea-cantidad';
    inputCantidad.placeholder = 'Cantidad';
    inputCantidad.min = '1';
    inputCantidad.step = '1';
    inputCantidad.style.cssText = 'flex:1; padding:6px; background:var(--bg-color); color:var(--text-main); border:1px solid var(--border-color); border-radius:4px; box-sizing:border-box;';

    const inputPrecio = document.createElement('input');
    inputPrecio.type = 'number';
    inputPrecio.className = 'pedido-linea-precio';
    inputPrecio.placeholder = 'Precio ud (€)';
    inputPrecio.min = '0';
    inputPrecio.step = '0.0001';
    inputPrecio.style.cssText = 'flex:1; padding:6px; background:var(--bg-color); color:var(--text-main); border:1px solid var(--border-color); border-radius:4px; box-sizing:border-box;';

    // MODIFICADO (2026-09-10): flex:'0 0 auto' para que este botón nunca se encoja ni desaparezca
    // si la fila queda apretada (select+cantidad+precio en poco ancho) -- y title/aria-label para
    // que se entienda que sirve para quitar la línea, no solo un icono suelto.
    const btnQuitar = document.createElement('button');
    btnQuitar.type = 'button';
    btnQuitar.className = 'btn-small btn-quitar-linea-pedido';
    btnQuitar.style.cssText = 'background:var(--danger); flex:0 0 auto; padding:6px 12px;';
    btnQuitar.textContent = '✕';
    btnQuitar.title = 'Quitar esta línea';
    btnQuitar.setAttribute('aria-label', 'Quitar esta línea');
    btnQuitar.addEventListener('click', () => fila.remove());

    fila.appendChild(selectComp);
    fila.appendChild(inputCantidad);
    fila.appendChild(inputPrecio);
    fila.appendChild(btnQuitar);
    return fila;
}

async function agregarLineaPedido() {
    const container = document.getElementById('pedido-lineas-container');
    if (!container) return;
    const ids = await obtenerIdsComponentesPedido();
    container.appendChild(crearFilaLineaPedido(ids));
}

async function abrirModalPedido() {
    const modal = document.getElementById('modal-pedido');
    if (!modal) return;

    // Reinicia el formulario cada vez que se abre (por si se dejó a medias la vez anterior).
    document.getElementById('pedido-proveedor').value = 'LCSC';
    document.getElementById('pedido-proveedor-otro').value = '';
    document.getElementById('pedido-proveedor-otro').style.display = 'none';
    document.getElementById('pedido-fecha').value = new Date().toISOString().slice(0, 10);
    document.getElementById('pedido-gastos-envio').value = '0';
    document.getElementById('pedido-gastos-manipulacion').value = '0';
    document.getElementById('pedido-descuento').value = '0';
    document.getElementById('pedido-aplica-aduana').checked = false;
    document.getElementById('pedido-gastos-aduana').value = '0';
    document.getElementById('pedido-aduana-wrap').style.display = 'none';
    document.getElementById('msg-pedido-modal').innerHTML = '';

    const container = document.getElementById('pedido-lineas-container');
    container.innerHTML = '';
    await agregarLineaPedido(); // arranca con una línea vacía

    modal.style.display = 'flex';
}

function cerrarModalPedido() {
    const modal = document.getElementById('modal-pedido');
    if (modal) modal.style.display = 'none';
}

async function enviarDatosPedido() {
    const msgId = 'msg-pedido-modal';
    const mostrarError = (texto) => mostrarMensaje(msgId, `❌ ${texto}`, true);

    const proveedorSel = document.getElementById('pedido-proveedor').value;
    const proveedor = proveedorSel === 'OTRO'
        ? document.getElementById('pedido-proveedor-otro').value.trim()
        : proveedorSel;
    if (!proveedor) { mostrarError('Indica el nombre del proveedor.'); return; }

    const fecha = document.getElementById('pedido-fecha').value || null;
    const gastosEnvio = parseFloat(document.getElementById('pedido-gastos-envio').value) || 0;
    const gastosManipulacion = parseFloat(document.getElementById('pedido-gastos-manipulacion').value) || 0;
    const descuento = parseFloat(document.getElementById('pedido-descuento').value) || 0;
    const aplicaAduana = document.getElementById('pedido-aplica-aduana').checked;
    const gastosAduana = aplicaAduana ? (parseFloat(document.getElementById('pedido-gastos-aduana').value) || 0) : 0;

    const filas = document.querySelectorAll('#pedido-lineas-container .pedido-linea-row');
    if (filas.length === 0) { mostrarError('Añade al menos un artículo al pedido.'); return; }

    const lineas = [];
    for (const fila of filas) {
        const idComponente = fila.querySelector('.pedido-linea-componente').value;
        const cantidadStr = fila.querySelector('.pedido-linea-cantidad').value;
        const precioStr = fila.querySelector('.pedido-linea-precio').value;

        // NUEVO (2026-09-10): una línea añadida por error (p.ej. dos clics seguidos en "+ Añadir
        // línea") y dejada TOTALMENTE en blanco se ignora sola al guardar -- no hace falta que el
        // usuario la borre a mano con el botón "✕" (que sigue ahí, por si prefiere quitarla del
        // todo en vez de dejarla vacía). Si está solo A MEDIAS rellena, sí se avisa: eso suele ser
        // un descuido real (p.ej. eligió el componente pero se le olvidó el precio).
        if (!idComponente && !cantidadStr && !precioStr) continue;

        const cantidad = parseFloat(cantidadStr);
        const precioUnitario = parseFloat(precioStr);
        if (!idComponente || !(cantidad > 0) || !(precioUnitario > 0)) {
            mostrarError('Revisa las líneas: cada una necesita componente, cantidad y precio unitario válidos (o déjala totalmente en blanco para que se ignore, o quítala con el botón ✕).');
            return;
        }
        lineas.push({ idComponente, cantidad, precioUnitario });
    }

    if (lineas.length === 0) { mostrarError('Añade al menos un artículo al pedido.'); return; }

    cerrarModalPedido();
    mostrarMensaje('msg-pedidos', '🔄 Guardando pedido en Google Sheets...', false);

    const exito = await actualizarDatos({
        action: 'guardar_pedido_completo',
        pedido: { proveedor, fecha, gastosEnvio, gastosManipulacion, descuento, aplicaAduana, gastosAduana, lineas }
    });

    if (exito) {
        if (confirm("✅ ¡Pedido guardado correctamente!\n\nPulsa Aceptar para refrescar la web y ver los cambios.")) {
            location.reload();
        } else {
            mostrarMensaje('msg-pedidos', '✅ Pedido guardado. Refresca la web cuando quieras.', false);
        }
    } else {
        mostrarMensaje('msg-pedidos', '❌ Error al procesar el pedido en Google Sheets.', true);
    }
}

