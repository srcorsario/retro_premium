// js/pedido.js
// NUEVO: Generador de pedido — selecciona kits + cantidades, suma componentes necesarios,
// y para cada uno permite elegir de qué proveedor pedirlo (deshabilitado si no tiene stock),
// fusionando componente original + sustituto (hoja "Sustituciones") en una sola necesidad.
import ENV from './config.js';
import { obtenerDatos } from './api.js';

let pedidoInicializado = false;
let cacheDatosPedido = null; // se recalcula solo una vez por carga de página

const ORDEN_PROVEEDORES = ['LCSC', 'ALIEXPRESS', 'TME'];
const ETIQUETA_PROVEEDOR = { LCSC: 'LCSC', ALIEXPRESS: 'AliExpress', TME: 'TME' };

export async function inicializarModuloPedido() {
    if (pedidoInicializado) return;

    const contenedorKits = document.getElementById('pedido-lista-kits');
    const btnCalcular = document.getElementById('btn-calcular-pedido');
    if (!contenedorKits || !btnCalcular) return;

    const datosKits = await obtenerDatos('Kits_Consolas');
    const kitsUnicos = [...new Set(datosKits.map(k => k['ID_Kit']).filter(k => k))];

    if (kitsUnicos.length === 0) {
        contenedorKits.innerHTML = '<p style="color:var(--text-secondary); font-size:13px;">No hay kits definidos en Kits_Consolas.</p>';
    } else {
        contenedorKits.innerHTML = kitsUnicos.map(idKit => `
            <label class="col-toggle-item" style="justify-content: space-between; width: 100%; box-sizing: border-box;">
                <span style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" class="pedido-check-kit" data-kit="${idKit}">
                    ${idKit}
                </span>
                <input type="number" class="pedido-cantidad-kit" data-kit="${idKit}" value="1" min="1"
                    style="width:70px; padding:4px 6px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
            </label>
        `).join('');
    }

    btnCalcular.addEventListener('click', calcularPedido);

    pedidoInicializado = true;
}

// Carga (una vez) y estructura todos los datos necesarios para calcular pedidos
async function cargarDatosPedido() {
    if (cacheDatosPedido) return cacheDatosPedido;

    const [componentes, kits, variantesLCSC, variantesAli, variantesTME] = await Promise.all([
        obtenerDatos('Componentes'),
        obtenerDatos('Kits_Consolas'),
        obtenerDatos('Variantes_LCSC'),
        obtenerDatos('Variantes_AliExpress'),
        obtenerDatos('Variantes_TME')
    ]);

    // NUEVO: la hoja "Sustituciones" es opcional -- si todavía no está en config.js (SHEETS),
    // seguimos funcionando sin fusionar componente original + sustituto.
    let sustituciones = [];
    if (ENV.SHEETS['Sustituciones']) {
        sustituciones = await obtenerDatos('Sustituciones');
    }

    const sustitucionesMap = {}; // { ID_Nuevo: ID_Original }
    sustituciones.forEach(row => {
        const idNuevo = (row['ID_Nuevo'] || '').trim();
        const idOriginal = (row['ID_Original'] || '').trim();
        if (idNuevo && idOriginal) sustitucionesMap[idNuevo] = idOriginal;
    });

    function mapaStockDesde(datos) {
        const mapa = {};
        datos.forEach(row => {
            const id = (row['ID_Componente'] || '').trim();
            if (!id) return;
            const stock = parseFloat(row['Stock_Packs']) || 0;
            mapa[id] = (mapa[id] || 0) + stock;
        });
        return mapa;
    }

    const stockPorProveedor = {
        LCSC: mapaStockDesde(variantesLCSC),
        ALIEXPRESS: mapaStockDesde(variantesAli),
        TME: mapaStockDesde(variantesTME)
    };

    // Agrupamos las filas de Componentes por "grupo" (el ID_Original si es un sustituto, o su
    // propio ID si no), igual que hace Apps Script para las columnas L/M de Kits_Consolas.
    const filasPorGrupo = {};
    componentes.forEach(row => {
        const literalId = (row['ID_Componente'] || '').trim();
        const proveedor = (row['Proveedor_Preferido'] || '').trim().toUpperCase();
        if (!literalId || !proveedor) return;
        const grupo = sustitucionesMap[literalId] || literalId;
        if (!filasPorGrupo[grupo]) filasPorGrupo[grupo] = [];
        filasPorGrupo[grupo].push({
            literalId,
            proveedor,
            marca: row['Marca_Top'] || '',
            udsPack: parseFloat(row['Uds_Pack']) || 0,
            precioPack: parseFloat(row['Precio_Pack']) || 0
        });
    });

    cacheDatosPedido = { kits, sustitucionesMap, filasPorGrupo, stockPorProveedor };
    return cacheDatosPedido;
}

async function calcularPedido() {
    const resultadoDiv = document.getElementById('pedido-resultado');
    if (!resultadoDiv) return;

    const checks = document.querySelectorAll('.pedido-check-kit:checked');
    if (checks.length === 0) {
        resultadoDiv.innerHTML = '<p style="color:var(--danger);">Selecciona al menos un kit.</p>';
        return;
    }

    const seleccion = Array.from(checks).map(chk => {
        const idKit = chk.getAttribute('data-kit');
        const inputCantidad = document.querySelector(`.pedido-cantidad-kit[data-kit="${CSS.escape(idKit)}"]`);
        const cantidad = inputCantidad ? (parseInt(inputCantidad.value, 10) || 0) : 0;
        return { idKit, cantidad };
    }).filter(s => s.cantidad > 0);

    if (seleccion.length === 0) {
        resultadoDiv.innerHTML = '<p style="color:var(--danger);">Indica una cantidad mayor que 0 para al menos un kit seleccionado.</p>';
        return;
    }

    resultadoDiv.innerHTML = '<p style="color:var(--text-secondary);">Calculando...</p>';

    const { kits, sustitucionesMap, filasPorGrupo, stockPorProveedor } = await cargarDatosPedido();

    // Sumamos las necesidades por ID_Componente literal (tal cual aparece en Kits_Consolas)
    const necesidades = {};
    seleccion.forEach(({ idKit, cantidad }) => {
        kits
            .filter(row => row['ID_Kit'] === idKit)
            .forEach(row => {
                const idComp = (row['ID_Componente'] || '').trim();
                const cantidadPorKit = parseFloat(row['Cantidad']) || 0;
                if (!idComp || cantidadPorKit <= 0) return;
                necesidades[idComp] = (necesidades[idComp] || 0) + (cantidadPorKit * cantidad);
            });
    });

    const idsNecesarios = Object.keys(necesidades);
    if (idsNecesarios.length === 0) {
        resultadoDiv.innerHTML = '<p style="color:var(--danger);">Los kits seleccionados no tienen componentes definidos en Kits_Consolas.</p>';
        return;
    }

    renderTablaPedido(resultadoDiv, idsNecesarios, necesidades, sustitucionesMap, filasPorGrupo, stockPorProveedor);
}

function renderTablaPedido(contenedor, idsNecesarios, necesidades, sustitucionesMap, filasPorGrupo, stockPorProveedor) {
    idsNecesarios.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    let filasHtml = '';

    idsNecesarios.forEach((idComp, indiceFila) => {
        const cantidadNecesaria = necesidades[idComp];
        const grupo = sustitucionesMap[idComp] || idComp;
        const opciones = filasPorGrupo[grupo] || [];

        const nombreGrupo = `pedido-opcion-${indiceFila}`;

        const opcionesConDatos = opciones
            .map(opt => {
                const stock = (stockPorProveedor[opt.proveedor] && stockPorProveedor[opt.proveedor][opt.literalId]) || 0;
                return Object.assign({}, opt, { stock, conStock: stock > 0 });
            })
            .sort((a, b) => ORDEN_PROVEEDORES.indexOf(a.proveedor) - ORDEN_PROVEEDORES.indexOf(b.proveedor));

        let yaPreseleccionado = false;
        const opcionesHtml = opcionesConDatos.length === 0
            ? '<span style="color:var(--danger); font-size:12px;">Componente no encontrado en Componentes</span>'
            : opcionesConDatos.map(opt => {
                const disabled = !opt.conStock ? 'disabled' : '';
                let checked = '';
                if (opt.conStock && !yaPreseleccionado) {
                    checked = 'checked';
                    yaPreseleccionado = true;
                }
                const etiquetaProveedor = ETIQUETA_PROVEEDOR[opt.proveedor] || opt.proveedor;
                const etiquetaMarca = opt.marca ? ` — ${opt.marca}` : '';
                const textoStock = opt.conStock ? `${opt.stock} uds en stock` : 'Sin stock';
                const colorTexto = opt.conStock ? '' : 'style="color:var(--danger);"';
                return `
                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; padding:3px 0; ${!opt.conStock ? 'opacity:0.55;' : ''}">
                        <input type="radio" name="${nombreGrupo}"
                            data-uds-pack="${opt.udsPack}"
                            data-precio-pack="${opt.precioPack}"
                            ${checked} ${disabled}
                            class="pedido-radio-opcion">
                        <span ${colorTexto}>${etiquetaProveedor}${etiquetaMarca} — pack de ${opt.udsPack} a ${formatearPrecioLocal(opt.precioPack)}€ (${textoStock})</span>
                    </label>`;
            }).join('');

        filasHtml += `
            <tr data-fila-pedido="${indiceFila}" data-cantidad-necesaria="${cantidadNecesaria}">
                <td>${idComp}</td>
                <td>${cantidadNecesaria}</td>
                <td>${opcionesHtml}</td>
                <td class="pedido-celda-packs">-</td>
                <td class="pedido-celda-precio">-</td>
            </tr>`;
    });

    contenedor.innerHTML = `
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>Componente</th>
                        <th>Cantidad necesaria</th>
                        <th>Proveedor a pedir</th>
                        <th>Packs a pedir</th>
                        <th>Precio estimado</th>
                    </tr>
                </thead>
                <tbody id="pedido-tbody">${filasHtml}</tbody>
            </table>
        </div>
        <div id="pedido-resumen" style="margin-top:15px; font-size:14px; font-weight:bold; text-align:right;"></div>
    `;

    contenedor.querySelectorAll('.pedido-radio-opcion').forEach(radio => {
        radio.addEventListener('change', recalcularPedido);
    });

    recalcularPedido();
}

function recalcularPedido() {
    const tbody = document.getElementById('pedido-tbody');
    const resumenDiv = document.getElementById('pedido-resumen');
    if (!tbody) return;

    let totalPrecio = 0;
    let componentesSinCubrir = 0;
    let totalComponentes = 0;

    tbody.querySelectorAll('tr').forEach(tr => {
        totalComponentes++;
        const cantidadNecesaria = parseFloat(tr.getAttribute('data-cantidad-necesaria')) || 0;
        const radioSeleccionado = tr.querySelector('.pedido-radio-opcion:checked');
        const celdaPacks = tr.querySelector('.pedido-celda-packs');
        const celdaPrecio = tr.querySelector('.pedido-celda-precio');

        if (!radioSeleccionado) {
            if (celdaPacks) celdaPacks.textContent = '—';
            if (celdaPrecio) celdaPrecio.textContent = '—';
            tr.classList.add('row-danger');
            componentesSinCubrir++;
            return;
        }

        tr.classList.remove('row-danger');

        const udsPack = parseFloat(radioSeleccionado.getAttribute('data-uds-pack')) || 0;
        const precioPack = parseFloat(radioSeleccionado.getAttribute('data-precio-pack')) || 0;
        const packsNecesarios = udsPack > 0 ? Math.ceil(cantidadNecesaria / udsPack) : 0;
        const precioEstimado = packsNecesarios * precioPack;

        if (celdaPacks) celdaPacks.textContent = udsPack > 0 ? `${packsNecesarios} pack(s)` : 'N/D';
        if (celdaPrecio) celdaPrecio.textContent = `${formatearPrecioLocal(precioEstimado)}€`;

        totalPrecio += precioEstimado;
    });

    if (resumenDiv) {
        let texto = `Total: ${totalComponentes} componentes — Precio estimado: ${formatearPrecioLocal(totalPrecio)}€`;
        if (componentesSinCubrir > 0) {
            texto += ` <span style="color:var(--danger);">(${componentesSinCubrir} sin proveedor con stock seleccionado)</span>`;
        }
        resumenDiv.innerHTML = texto;
    }
}

function formatearPrecioLocal(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}
