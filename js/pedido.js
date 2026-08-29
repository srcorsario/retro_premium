// js/pedido.js
// NUEVO: Generador de pedido — selecciona kits + cantidades, suma componentes necesarios,
// y para cada uno permite elegir de qué proveedor pedirlo (deshabilitado si no tiene stock),
// fusionando componente original + sustituto (hoja "Sustituciones") en una sola necesidad.
// Para cada proveedor, usa TODOS los tramos de pack reales (Variantes_LCSC/AliExpress/TME) y
// elige automáticamente la combinación más barata que cubra la cantidad necesaria (no hace
// falta que sea exacta: si un tramo mayor sale más barato en total, se prioriza ese salto).
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

    // NUEVO: en vez de quedarnos con un único tramo de pack (el que guarda Componentes),
    // guardamos TODOS los tramos reales de cada proveedor -> ID_Componente, tal cual están
    // en sus hojas de Variantes (cada fila = un tamaño de pack distinto con su propio stock).
    function tiersPorId(datos) {
        const mapa = {};
        datos.forEach(row => {
            const id = (row['ID_Componente'] || '').trim();
            if (!id) return;
            const udsPack = parseFloat(row['Variacion_Pack']) || 0;
            const precioPack = parseFloat(row['Precio_Pack']) || 0;
            const stockPacks = parseFloat(row['Stock_Packs']) || 0;
            if (udsPack <= 0) return;
            if (!mapa[id]) mapa[id] = [];
            mapa[id].push({ udsPack, precioPack, stockPacks });
        });
        return mapa;
    }

    const tiersPorProveedor = {
        LCSC: tiersPorId(variantesLCSC),
        ALIEXPRESS: tiersPorId(variantesAli),
        TME: tiersPorId(variantesTME)
    };

    // Agrupamos las filas de Componentes por "grupo" (el ID_Original si es un sustituto, o su
    // propio ID si no), igual que hace Apps Script para las columnas L/M de Kits_Consolas.
    // Solo necesitamos saber qué combinaciones (proveedor, literalId, marca) existen -- los
    // precios/packs reales se sacan de tiersPorProveedor, no de Componentes.
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
            marca: row['Marca_Top'] || ''
        });
    });

    cacheDatosPedido = { kits, sustitucionesMap, filasPorGrupo, tiersPorProveedor };
    return cacheDatosPedido;
}

// NUEVO: dado el conjunto de tramos de pack reales de UN proveedor para UN componente, calcula
// la combinación más barata que cubra "cantidadNecesaria". No exige un ajuste exacto: si comprar
// un tramo mayor sale más barato en total que ajustarse al mínimo, se prioriza el más barato.
// 1) Si algún tramo por sí solo cubre toda la cantidad (con stock suficiente), nos quedamos con
//    el más barato de esos.
// 2) Si ninguno solo llega, combinamos tramos empezando por el más barato por unidad hasta cubrir
//    lo posible (o agotar el stock disponible).
function calcularMejorCompra(tiers, cantidadNecesaria) {
    const validos = (tiers || []).filter(t => t.udsPack > 0 && t.stockPacks > 0 && t.precioPack > 0);
    if (validos.length === 0 || cantidadNecesaria <= 0) {
        return { logrado: false, desglose: [], totalUnidades: 0, totalPrecio: 0 };
    }

    // NOTA IMPORTANTE: "stockPacks" (columna Stock_Packs) guarda unidades individuales en stock
    // (p.ej. viene directo del "inventoryLevel" de LCSC o del "stock" de TME), NO el número de
    // packs disponibles. Así que primero hay que convertirlo a "packs completos disponibles".
    validos.forEach(t => { t.packsDisponibles = Math.floor(t.stockPacks / t.udsPack); });
    const conPacksDisponibles = validos.filter(t => t.packsDisponibles > 0);

    if (conPacksDisponibles.length === 0) {
        return { logrado: false, desglose: [], totalUnidades: 0, totalPrecio: 0 };
    }

    let mejorSolo = null;
    conPacksDisponibles.forEach(t => {
        const maxUnidadesComprables = t.packsDisponibles * t.udsPack;
        if (maxUnidadesComprables < cantidadNecesaria) return;
        const packs = Math.ceil(cantidadNecesaria / t.udsPack);
        if (packs > t.packsDisponibles) return;
        const precio = packs * t.precioPack;
        const mejorActual = mejorSolo ? mejorSolo.packs * mejorSolo.udsPack : Infinity;
        if (!mejorSolo || precio < mejorSolo.precio || (precio === mejorSolo.precio && (packs * t.udsPack) < mejorActual)) {
            mejorSolo = { udsPack: t.udsPack, precioPack: t.precioPack, packs, precio };
        }
    });

    if (mejorSolo) {
        return {
            logrado: true,
            desglose: [{ udsPack: mejorSolo.udsPack, packs: mejorSolo.packs, precioPack: mejorSolo.precioPack }],
            totalUnidades: mejorSolo.packs * mejorSolo.udsPack,
            totalPrecio: mejorSolo.precio
        };
    }

    // Ningún tramo cubre él solo la cantidad -> combinamos, priorizando el más barato por unidad
    const ordenados = conPacksDisponibles.slice().sort((a, b) => (a.precioPack / a.udsPack) - (b.precioPack / b.udsPack));
    let restante = cantidadNecesaria;
    let totalUnidades = 0;
    let totalPrecio = 0;
    const desglose = [];

    ordenados.forEach(t => {
        if (restante <= 0) return;
        const packsNecesariosAqui = Math.min(t.packsDisponibles, Math.ceil(restante / t.udsPack));
        if (packsNecesariosAqui <= 0) return;
        desglose.push({ udsPack: t.udsPack, packs: packsNecesariosAqui, precioPack: t.precioPack });
        totalUnidades += packsNecesariosAqui * t.udsPack;
        totalPrecio += packsNecesariosAqui * t.precioPack;
        restante -= packsNecesariosAqui * t.udsPack;
    });

    return { logrado: restante <= 0, desglose, totalUnidades, totalPrecio };
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

    const { kits, sustitucionesMap, filasPorGrupo, tiersPorProveedor } = await cargarDatosPedido();

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

    renderTablaPedido(resultadoDiv, idsNecesarios, necesidades, sustitucionesMap, filasPorGrupo, tiersPorProveedor);
}

function renderTablaPedido(contenedor, idsNecesarios, necesidades, sustitucionesMap, filasPorGrupo, tiersPorProveedor) {
    idsNecesarios.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    let filasHtml = '';

    idsNecesarios.forEach((idComp, indiceFila) => {
        const cantidadNecesaria = necesidades[idComp];
        const grupo = sustitucionesMap[idComp] || idComp;
        const opciones = filasPorGrupo[grupo] || [];

        const nombreGrupo = `pedido-opcion-${indiceFila}`;

        const opcionesConDatos = opciones
            .map(opt => {
                const tiers = (tiersPorProveedor[opt.proveedor] && tiersPorProveedor[opt.proveedor][opt.literalId]) || [];
                const compra = calcularMejorCompra(tiers, cantidadNecesaria);
                const hayStock = tiers.some(t => t.stockPacks > 0);
                return Object.assign({}, opt, { compra, hayStock });
            })
            .sort((a, b) => ORDEN_PROVEEDORES.indexOf(a.proveedor) - ORDEN_PROVEEDORES.indexOf(b.proveedor));

        let yaPreseleccionado = false;
        const opcionesHtml = opcionesConDatos.length === 0
            ? '<span style="color:var(--danger); font-size:12px;">Componente no encontrado en Componentes</span>'
            : opcionesConDatos.map(opt => {
                const usable = opt.hayStock && opt.compra.desglose.length > 0;
                const disabled = !usable ? 'disabled' : '';
                let checked = '';
                if (usable && opt.compra.logrado && !yaPreseleccionado) {
                    checked = 'checked';
                    yaPreseleccionado = true;
                }
                const etiquetaProveedor = ETIQUETA_PROVEEDOR[opt.proveedor] || opt.proveedor;
                const etiquetaMarca = opt.marca ? ` — ${opt.marca}` : '';

                let textoCompra;
                let colorTexto = '';
                if (!opt.hayStock || opt.compra.desglose.length === 0) {
                    textoCompra = 'Sin stock suficiente (ningún tramo con packs completos disponibles)';
                    colorTexto = 'style="color:var(--danger);"';
                } else {
                    const desgloseTexto = opt.compra.desglose.map(d => `${d.packs}×${d.udsPack}u`).join(' + ');
                    textoCompra = `${desgloseTexto} = ${opt.compra.totalUnidades} uds — ${formatearPrecioLocal(opt.compra.totalPrecio)}€`;
                    if (!opt.compra.logrado) {
                        textoCompra += ' ⚠️ no cubre toda la cantidad';
                        colorTexto = 'style="color:#eab308;"';
                    }
                }

                return `
                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; padding:3px 0; ${!usable ? 'opacity:0.55;' : ''}">
                        <input type="radio" name="${nombreGrupo}"
                            data-total-unidades="${opt.compra.totalUnidades}"
                            data-total-precio="${opt.compra.totalPrecio}"
                            data-desglose="${opt.compra.desglose.map(d => `${d.packs}×${d.udsPack}u`).join(' + ')}"
                            data-logrado="${opt.compra.logrado}"
                            ${checked} ${disabled}
                            class="pedido-radio-opcion">
                        <span ${colorTexto}>${etiquetaProveedor}${etiquetaMarca} — ${textoCompra}</span>
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
        <p style="color:var(--text-secondary); font-size:12px; margin-top:0;">Cada opción ya calcula la combinación de packs más barata que cubre la cantidad necesaria (puede comprar algo de más si sale más rentable que ajustarse al mínimo).</p>
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
    let componentesParciales = 0;
    let totalComponentes = 0;

    tbody.querySelectorAll('tr').forEach(tr => {
        totalComponentes++;
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

        const logrado = radioSeleccionado.getAttribute('data-logrado') === 'true';
        tr.classList.remove('row-danger');
        tr.classList.toggle('row-warning', !logrado);
        if (!logrado) componentesParciales++;

        const desglose = radioSeleccionado.getAttribute('data-desglose') || '';
        const totalUnidades = parseFloat(radioSeleccionado.getAttribute('data-total-unidades')) || 0;
        const precioEstimado = parseFloat(radioSeleccionado.getAttribute('data-total-precio')) || 0;

        if (celdaPacks) celdaPacks.textContent = `${desglose} (${totalUnidades} uds)`;
        if (celdaPrecio) celdaPrecio.textContent = `${formatearPrecioLocal(precioEstimado)}€`;

        totalPrecio += precioEstimado;
    });

    if (resumenDiv) {
        let texto = `Total: ${totalComponentes} componentes — Precio estimado: ${formatearPrecioLocal(totalPrecio)}€`;
        if (componentesSinCubrir > 0) {
            texto += ` <span style="color:var(--danger);">(${componentesSinCubrir} sin proveedor con stock seleccionado)</span>`;
        }
        if (componentesParciales > 0) {
            texto += ` <span style="color:#eab308;">(${componentesParciales} no cubren toda la cantidad necesaria)</span>`;
        }
        resumenDiv.innerHTML = texto;
    }
}

function formatearPrecioLocal(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}
