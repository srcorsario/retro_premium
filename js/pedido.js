// js/pedido.js
// NUEVO: Generador de pedido — selecciona kits + cantidades, suma componentes necesarios,
// y para cada uno permite elegir de qué proveedor pedirlo (deshabilitado si no tiene stock),
// fusionando componente original + sustituto (hoja "Sustituciones") en una sola necesidad.
// Para cada proveedor, usa TODOS los tramos de precio reales (Variantes_LCSC/AliExpress/TME).
// MODIFICADO (fix): los tramos NO son un tamaño de pack que haya que comprar en múltiplos
// exactos -- son umbrales de precio por unidad (como en cualquier tienda de componentes tipo
// LCSC/TME/Mouser). En cuanto la cantidad pedida alcanza el umbral de un tramo, TODA esa
// cantidad se cobra al precio por unidad de ese tramo (no solo lo que pase del umbral), hasta
// llegar al siguiente. Antes el código trataba cada tramo como un pack fijo a comprar en packs
// enteros (ej. para 70 uds con tramos de 5/50/150 calculaba "14 packs de 5"), lo cual no refleja
// cómo se compra realmente -- ver calcularMejorCompra().
import ENV from './config.js';
import { obtenerDatos } from './api.js';

let pedidoInicializado = false;
let cacheDatosPedido = null; // se recalcula solo una vez por carga de página

const ORDEN_PROVEEDORES = ['LCSC', 'ALIEXPRESS', 'TME'];
const ETIQUETA_PROVEEDOR = { LCSC: 'LCSC', ALIEXPRESS: 'AliExpress', TME: 'TME' };

// NUEVO: Gastos de envío fijos por tienda (de momento a mano; el día que se quiera afinar por
// pedido real se pueden leer de la hoja "Gastos_Extra" en vez de estos valores fijos).
const GASTOS_ENVIO = { LCSC: 20, ALIEXPRESS: 0, TME: 14 };

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
            const udsPack = parseNumeroES(row['Variacion_Pack']);
            // OJO: la columna real en Variantes_LCSC/AliExpress/TME se llama "Precio_Pack_EUR"
            // (no "Precio_Pack", ese nombre es de la hoja Componentes) -- si se lee mal, el precio
            // sale siempre 0 y el generador de pedido descarta todos los tramos como si no existieran.
            const precioPack = parseNumeroES(row['Precio_Pack_EUR']);
            const stockPacks = parseNumeroES(row['Stock_Packs']);
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

// NUEVO (fix): dado el conjunto de tramos de precio reales de UN proveedor para UN componente,
// calcula el coste de cubrir "cantidadNecesaria" tal como funciona realmente la compra por
// tramos (LCSC/TME/Mouser...): cada tramo define un UMBRAL de cantidad, no un tamaño de pack.
// Se localiza el tramo aplicable -- el de mayor umbral (Variacion_Pack) que sea <= la cantidad
// necesaria -- y se compra EXACTAMENTE la cantidad necesaria al precio por unidad de ese tramo
// (precioPack / udsPack), sin redondear a múltiplos de pack. Si la cantidad necesaria es menor
// que el tramo más bajo, no se puede pedir menos que ese mínimo: se compra el mínimo del tramo
// más bajo (confirmado con el usuario).
// El stock ("Stock_Packs") es SIEMPRE el mismo valor en todas las filas de tramo de un mismo
// componente+proveedor (es el stock físico real, no "packs" -- ver comentario en tiersPorId),
// así que basta comprobar que cubre la cantidad a comprar; si no llega, se cubre lo máximo
// posible con el tramo de precio que corresponda a esa cantidad menor realmente disponible.
function calcularMejorCompra(tiers, cantidadNecesaria) {
    const validos = (tiers || []).filter(t => t.udsPack > 0 && t.precioPack > 0);
    if (validos.length === 0 || cantidadNecesaria <= 0) {
        return { logrado: false, desglose: [], totalUnidades: 0, totalPrecio: 0 };
    }

    const ordenados = validos.slice().sort((a, b) => a.udsPack - b.udsPack);
    const stockReal = Math.max(...ordenados.map(t => t.stockPacks || 0));

    if (stockReal <= 0) {
        return { logrado: false, desglose: [], totalUnidades: 0, totalPrecio: 0 };
    }

    // Tramo aplicable a una cantidad dada: el de mayor umbral <= esa cantidad (o el más bajo si
    // la cantidad no llega ni a ese umbral -- no se puede comprar menos que el mínimo del tramo).
    function tramoParaCantidad(cantidad) {
        let tramo = ordenados[0];
        for (const t of ordenados) {
            if (t.udsPack <= cantidad) tramo = t;
            else break;
        }
        return tramo;
    }

    const tramoAplicable = tramoParaCantidad(cantidadNecesaria);
    const cantidadAComprar = Math.max(cantidadNecesaria, tramoAplicable.udsPack);

    if (stockReal >= cantidadAComprar) {
        const precioUnitario = tramoAplicable.precioPack / tramoAplicable.udsPack;
        return {
            logrado: true,
            desglose: [{ udsPack: tramoAplicable.udsPack, unidades: cantidadAComprar, precioUnitario }],
            totalUnidades: cantidadAComprar,
            totalPrecio: cantidadAComprar * precioUnitario
        };
    }

    // No hay stock suficiente para la cantidad completa -- cubrimos lo máximo posible con el
    // stock real disponible, recalculando qué tramo de precio corresponde a ESA cantidad menor.
    const tramoParaStock = tramoParaCantidad(stockReal);
    if (stockReal < tramoParaStock.udsPack) {
        // Ni siquiera hay stock para el mínimo del tramo más bajo.
        return { logrado: false, desglose: [], totalUnidades: 0, totalPrecio: 0 };
    }
    const precioUnitarioParcial = tramoParaStock.precioPack / tramoParaStock.udsPack;
    return {
        logrado: false,
        desglose: [{ udsPack: tramoParaStock.udsPack, unidades: stockReal, precioUnitario: precioUnitarioParcial }],
        totalUnidades: stockReal,
        totalPrecio: stockReal * precioUnitarioParcial
    };
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

    let datosPedido;
    try {
        datosPedido = await cargarDatosPedido();
    } catch (err) {
        // NUEVO (fix): red de seguridad -- obtenerDatos() ya no debería lanzar (ver api.js), pero
        // si algo inesperado falla no queremos dejar "Calculando..." colgado sin explicación.
        resultadoDiv.innerHTML = `<p style="color:var(--danger);">Error al calcular el pedido: ${err.message}. Prueba a recargar la página.</p>`;
        return;
    }
    const { kits, sustitucionesMap, filasPorGrupo, tiersPorProveedor } = datosPedido;

    // NUEVO (fix): si "Kits_Consolas" o "Componentes" vinieron vacíos (p.ej. porque su petición
    // se quedó sin respuesta -- ver fetchConTimeout en api.js -- y se agotaron los reintentos),
    // seguir adelante solo produce una tabla rota y confusa ("Componente no encontrado" en todo).
    // Mejor avisar claramente y dejar que se reintente, que es lo que normalmente hace falta.
    if (kits.length === 0 || Object.keys(filasPorGrupo).length === 0) {
        cacheDatosPedido = null; // para que el próximo intento vuelva a pedir los datos, no reuse el vacío
        resultadoDiv.innerHTML = '<p style="color:var(--danger);">No se han podido cargar todos los datos de la hoja (puede que Google haya tardado demasiado en responder). Pulsa "Calcular Pedido" otra vez.</p>';
        return;
    }

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

// NUEVO: el "grupo" de un ID_Componente literal es el ID original si tiene un sustituto
// registrado en la hoja Sustituciones, o su propio ID si no -- misma fórmula que ya usaba
// cargarDatosPedido() para agrupar filasPorGrupo, ahora reutilizada aquí para detectar parejas.
function grupoDe(idComp, sustitucionesMap) {
    return sustitucionesMap[idComp] || idComp;
}

// NUEVO: escapa texto para usarlo dentro de atributos HTML (name, data-grupo, title...) -- los
// IDs de componentes vienen de la hoja de cálculo y en teoría podrían llevar comillas u otros
// caracteres que rompan el HTML generado.
function escapeAttr(texto) {
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderTablaPedido(contenedor, idsNecesarios, necesidades, sustitucionesMap, filasPorGrupo, tiersPorProveedor) {
    // MODIFICADO: antes se ordenaba solo alfabéticamente por ID. Ahora se ordena primero por
    // "grupo" (el ID original si el componente tiene un sustituto en Sustituciones, o su propio
    // ID si no) para que un componente y su sustituto queden SIEMPRE en filas consecutivas, y en
    // segundo lugar alfabéticamente por su propio ID para que el resto del orden sea estable.
    idsNecesarios.sort((a, b) => {
        const grupoA = grupoDe(a, sustitucionesMap);
        const grupoB = grupoDe(b, sustitucionesMap);
        if (grupoA !== grupoB) return grupoA.localeCompare(grupoB, 'es', { sensitivity: 'base' });
        return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });

    // NUEVO: cuántas filas literales (ID_Componente distintos de Kits_Consolas) caen en cada
    // grupo -- si hay más de una, son "pareja" (componente + su sustituto) y hay que marcarlas.
    const conteoPorGrupo = {};
    idsNecesarios.forEach(id => {
        const g = grupoDe(id, sustitucionesMap);
        conteoPorGrupo[g] = (conteoPorGrupo[g] || 0) + 1;
    });

    let filasHtml = '';
    // NUEVO: la preselección automática de la opción más barata ahora se hace a nivel de GRUPO,
    // no de fila individual -- si dos filas son pareja, solo se marca una opción en todo el
    // grupo, porque evidentemente solo hace falta comprar uno de los dos componentes.
    const preseleccionadoPorGrupo = {};

    idsNecesarios.forEach((idComp, indiceFila) => {
        const cantidadNecesaria = necesidades[idComp];
        const grupo = grupoDe(idComp, sustitucionesMap);
        const opciones = filasPorGrupo[grupo] || [];

        // MODIFICADO: el "name" del grupo de radios ahora es por GRUPO (no por fila) -- así, si
        // el componente y su sustituto ocupan dos <tr> distintas, sus radios comparten el mismo
        // atributo "name" HTML y el navegador aplica exclusión mutua nativa ENTRE las dos filas
        // (igual que si fueran opciones de una sola fila): marcar una opción en una fila
        // desmarca automáticamente cualquier opción marcada en su fila pareja.
        const nombreGrupo = `pedido-opcion-grupo-${escapeAttr(grupo)}`;

        const opcionesConDatos = opciones
            .map(opt => {
                const tiers = (tiersPorProveedor[opt.proveedor] && tiersPorProveedor[opt.proveedor][opt.literalId]) || [];
                const compra = calcularMejorCompra(tiers, cantidadNecesaria);
                const hayStock = tiers.some(t => t.stockPacks > 0);
                return Object.assign({}, opt, { compra, hayStock });
            })
            .sort((a, b) => ORDEN_PROVEEDORES.indexOf(a.proveedor) - ORDEN_PROVEEDORES.indexOf(b.proveedor));

        const opcionesHtml = opcionesConDatos.length === 0
            ? '<span style="color:var(--danger); font-size:12px;">Componente no encontrado en Componentes</span>'
            : opcionesConDatos.map(opt => {
                const usable = opt.hayStock && opt.compra.desglose.length > 0;
                const disabled = !usable ? 'disabled' : '';
                let checked = '';
                if (usable && opt.compra.logrado && !preseleccionadoPorGrupo[grupo]) {
                    checked = 'checked';
                    preseleccionadoPorGrupo[grupo] = true;
                }
                const etiquetaProveedor = ETIQUETA_PROVEEDOR[opt.proveedor] || opt.proveedor;
                const etiquetaMarca = opt.marca ? ` — ${opt.marca}` : '';

                let textoCompra;
                let colorTexto = '';
                // MODIFICADO (fix): el desglose ahora es "cantidad a precio/ud (tramo desde X uds)"
                // en vez de "packs×tamaño" -- ya no se compra en packs enteros, se compra la
                // cantidad exacta al precio por unidad del tramo aplicable (ver calcularMejorCompra).
                // MODIFICADO (fix): el PRECIO POR UNIDAD se muestra con 4 decimales (como LCSC/TME
                // en sus propias fichas de producto, ej. "€ 0.0759"), no con 2 -- redondear un
                // precio/unidad tan pequeño a 2 decimales (0,09€/ud) hacía que multiplicarlo a mano
                // por la cantidad no cuadrase con el total real (70×0,09=6,30 vs el total correcto
                // de 5,96€), pareciendo un error de cálculo cuando el cálculo interno sí era exacto
                // -- solo la cifra mostrada del precio/unidad estaba de más redondeada. El TOTAL en
                // € sí se sigue mostrando a 2 decimales (formatearPrecioLocal), como cualquier importe.
                const desgloseTexto = opt.compra.desglose
                    .map(d => `${d.unidades} uds a ${formatearPrecioUnitarioLocal(d.precioUnitario)}€/ud (tramo ≥${d.udsPack}u)`)
                    .join(' + ');
                if (!opt.hayStock || opt.compra.desglose.length === 0) {
                    textoCompra = 'Sin stock disponible';
                    colorTexto = 'style="color:var(--danger);"';
                } else {
                    textoCompra = `${desgloseTexto} = ${formatearPrecioLocal(opt.compra.totalPrecio)}€`;
                    if (!opt.compra.logrado) {
                        textoCompra += ' ⚠️ no cubre toda la cantidad (stock insuficiente)';
                        colorTexto = 'style="color:#eab308;"';
                    }
                }

                return `
                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; padding:3px 0; ${!usable ? 'opacity:0.55;' : ''}">
                        <input type="radio" name="${nombreGrupo}"
                            data-total-unidades="${opt.compra.totalUnidades}"
                            data-total-precio="${opt.compra.totalPrecio}"
                            data-desglose="${desgloseTexto}"
                            data-logrado="${opt.compra.logrado}"
                            data-proveedor="${opt.proveedor}"
                            ${checked} ${disabled}
                            class="pedido-radio-opcion">
                        <span ${colorTexto}>${etiquetaProveedor}${etiquetaMarca} — ${textoCompra}</span>
                    </label>`;
            }).join('');

        // NUEVO: si este componente tiene "pareja" (su grupo agrupa más de una fila -- p.ej.
        // FUSE-PICO-1.5A-AXIAL / 025101.5MXL, sustituto en la hoja Sustituciones), se añade un
        // icono 💬 junto al nombre con un tooltip señalando cuál es el otro, para reconocer la
        // relación de un vistazo.
        const tienePareja = conteoPorGrupo[grupo] > 1;
        let iconoPareja = '';
        if (tienePareja) {
            const parejas = idsNecesarios.filter(id => id !== idComp && grupoDe(id, sustitucionesMap) === grupo);
            iconoPareja = ` <span title="💬 Equivale a: ${escapeAttr(parejas.join(', '))} (hoja Sustituciones) — evidentemente, solo hace falta comprar uno de los dos" style="cursor:help;">💬</span>`;
        }

        filasHtml += `
            <tr data-fila-pedido="${indiceFila}" data-cantidad-necesaria="${cantidadNecesaria}"
                data-grupo="${escapeAttr(grupo)}" data-id-componente="${escapeAttr(idComp)}"
                class="${tienePareja ? 'fila-con-pareja' : ''}">
                <td>${idComp}${iconoPareja}</td>
                <td>${cantidadNecesaria}</td>
                <td>${opcionesHtml}</td>
                <td class="pedido-celda-packs">-</td>
                <td class="pedido-celda-precio">-</td>
            </tr>`;
    });

    contenedor.innerHTML = `
        <p style="color:var(--text-secondary); font-size:12px; margin-top:0;">Cada opción calcula el precio por tramos: se aplica el precio por unidad del tramo cuyo umbral alcanza la cantidad necesaria a esa cantidad exacta (si necesitas menos que el tramo más bajo, se compra su mínimo). El icono 💬 marca componentes con un sustituto equivalente (hoja Sustituciones): evidentemente, solo hace falta comprar uno de los dos.</p>
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>Componente</th>
                        <th>Cantidad necesaria</th>
                        <th>Proveedor a pedir</th>
                        <th>Cantidad a pedir</th>
                        <th>Precio estimado</th>
                    </tr>
                </thead>
                <tbody id="pedido-tbody">${filasHtml}</tbody>
            </table>
        </div>
        <div id="pedido-resumen" style="margin-top:15px; font-size:14px; font-weight:bold; text-align:right;"></div>
        <div id="pedido-desglose-tiendas" style="margin-top:25px;"></div>
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

    // NUEVO: agrupamos también por tienda para pintar el desglose final del pedido
    const porTienda = {};
    ORDEN_PROVEEDORES.forEach(p => { porTienda[p] = { items: [], subtotal: 0 }; });

    const filas = Array.from(tbody.querySelectorAll('tr'));

    // NUEVO: como una pareja de filas (componente + su sustituto) ahora comparte el mismo
    // "name" de radio-group (misma "data-grupo"), primero miramos qué grupos ya tienen una
    // opción marcada en CUALQUIERA de sus filas. Así la fila "hermana" que se queda sin radio
    // marcado (porque la elección se hizo en la otra) no se pinta como un error sin cubrir,
    // sino como "cubierta por su pareja" -- evidentemente, o se compra una o la otra.
    const gruposConSeleccion = new Set();
    filas.forEach(tr => {
        if (tr.querySelector('.pedido-radio-opcion:checked')) {
            gruposConSeleccion.add(tr.getAttribute('data-grupo'));
        }
    });

    filas.forEach(tr => {
        const radioSeleccionado = tr.querySelector('.pedido-radio-opcion:checked');
        const celdaPacks = tr.querySelector('.pedido-celda-packs');
        const celdaPrecio = tr.querySelector('.pedido-celda-precio');
        const grupo = tr.getAttribute('data-grupo');

        if (!radioSeleccionado) {
            tr.classList.remove('row-danger', 'row-warning', 'row-cubierta-pareja');
            if (grupo && gruposConSeleccion.has(grupo)) {
                // NUEVO: no es un error de verdad -- su pareja ya cubre esta necesidad, así que
                // esta fila no suma como un componente aparte en el recuento total (evidentemente
                // es la MISMA necesidad que su pareja, no una necesidad extra).
                if (celdaPacks) celdaPacks.textContent = '💬 cubierto por su pareja';
                if (celdaPrecio) celdaPrecio.textContent = '—';
                tr.classList.add('row-cubierta-pareja');
                return;
            }
            totalComponentes++;
            if (celdaPacks) celdaPacks.textContent = '—';
            if (celdaPrecio) celdaPrecio.textContent = '—';
            tr.classList.add('row-danger');
            componentesSinCubrir++;
            return;
        }

        totalComponentes++;
        const logrado = radioSeleccionado.getAttribute('data-logrado') === 'true';
        tr.classList.remove('row-danger', 'row-cubierta-pareja');
        tr.classList.toggle('row-warning', !logrado);
        if (!logrado) componentesParciales++;

        const desglose = radioSeleccionado.getAttribute('data-desglose') || '';
        const totalUnidades = parseFloat(radioSeleccionado.getAttribute('data-total-unidades')) || 0;
        const precioEstimado = parseFloat(radioSeleccionado.getAttribute('data-total-precio')) || 0;
        const proveedor = radioSeleccionado.getAttribute('data-proveedor') || '';

        // MODIFICADO: el texto de "desglose" ya incluye la cantidad y el precio/unidad
        // (ver renderTablaPedido), así que ya no hace falta repetir "(N uds)" aparte.
        if (celdaPacks) celdaPacks.textContent = desglose;
        if (celdaPrecio) celdaPrecio.textContent = `${formatearPrecioLocal(precioEstimado)}€`;

        totalPrecio += precioEstimado;

        if (porTienda[proveedor]) {
            // MODIFICADO: se usa el atributo data-id-componente (id "limpio") en vez del texto de
            // la celda, que ahora puede incluir el icono 💬 de pareja.
            const nombreComponente = tr.getAttribute('data-id-componente') || '';
            porTienda[proveedor].items.push({ componente: nombreComponente, desglose, unidades: totalUnidades, precio: precioEstimado });
            porTienda[proveedor].subtotal += precioEstimado;
        }
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

    renderDesglosePorTienda(porTienda);
}

// NUEVO: pinta, al final de la tabla, un bloque por cada tienda con los artículos que se
// comprarían en ella (cantidad + precio), su subtotal, los gastos de envío fijos de esa tienda,
// el total de esa tienda, y finalmente la suma completa del pedido (artículos + envíos).
function renderDesglosePorTienda(porTienda) {
    const desgloseDiv = document.getElementById('pedido-desglose-tiendas');
    if (!desgloseDiv) return;

    let totalGeneral = 0;
    let huboAlgunaTienda = false;
    let html = '<h3 style="margin-bottom:10px;">🏪 Desglose por tienda</h3>';

    ORDEN_PROVEEDORES.forEach(proveedor => {
        const datos = porTienda[proveedor];
        if (!datos || datos.items.length === 0) return;

        huboAlgunaTienda = true;
        const envio = GASTOS_ENVIO[proveedor] || 0;
        const totalTienda = datos.subtotal + envio;
        totalGeneral += totalTienda;

        const filasHtml = datos.items.map(item => `
            <tr>
                <td>${item.componente}</td>
                <td>${item.desglose}</td>
                <td>${formatearPrecioLocal(item.precio)}€</td>
            </tr>`).join('');

        html += `
            <div style="margin-bottom:18px; border:1px solid var(--border-color); border-radius:6px; padding:12px 15px;">
                <h4 style="margin:0 0 10px 0; color:var(--primary);">${ETIQUETA_PROVEEDOR[proveedor] || proveedor}</h4>
                <div style="overflow-x:auto;">
                    <table>
                        <thead><tr><th>Componente</th><th>Cantidad</th><th>Precio</th></tr></thead>
                        <tbody>${filasHtml}</tbody>
                    </table>
                </div>
                <div style="text-align:right; font-size:13px; color:var(--text-secondary); margin-top:8px;">
                    Subtotal artículos: ${formatearPrecioLocal(datos.subtotal)}€ &nbsp;+&nbsp; Gastos de envío: ${formatearPrecioLocal(envio)}€
                </div>
                <div style="text-align:right; font-size:15px; font-weight:bold; margin-top:4px;">
                    Total ${ETIQUETA_PROVEEDOR[proveedor] || proveedor}: ${formatearPrecioLocal(totalTienda)}€
                </div>
            </div>`;
    });

    if (!huboAlgunaTienda) {
        desgloseDiv.innerHTML = '';
        return;
    }

    html += `
        <div style="text-align:right; font-size:17px; font-weight:bold; border-top:2px solid var(--border-color); padding-top:12px;">
            Total del pedido (artículos + envíos): ${formatearPrecioLocal(totalGeneral)}€
        </div>`;

    desgloseDiv.innerHTML = html;
}

function formatearPrecioLocal(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

// NUEVO (fix): para precios POR UNIDAD (no importes totales) se usan 4 decimales, igual que
// LCSC/TME en sus fichas de producto -- con solo 2 decimales, un precio/ud pequeño como
// 0,0852€ se veía redondeado a "0,09€/ud", y multiplicarlo a mano por la cantidad no cuadraba
// con el total real mostrado al lado (parecía un descuadre, aunque el total sí era exacto).
function formatearPrecioUnitarioLocal(n) {
    return (Math.round(n * 10000) / 10000).toFixed(4).replace('.', ',');
}

// NUEVO: Las hojas Variantes_* guardan los números en formato español (coma decimal), a veces
// con el símbolo € pegado o con espacio, p.ej. "0,7027" / "3,69€" / "0,37 €". parseFloat normal
// se detiene en la coma y devuelve 0 o un valor truncado -- de ahí que antes saliera todo a 0,00€.
function parseNumeroES(valor) {
    if (valor === null || valor === undefined) return 0;
    let texto = String(valor).trim();
    if (!texto) return 0;
    texto = texto.replace(/[€$\s]/g, '').replace(',', '.');
    const numero = parseFloat(texto);
    return isNaN(numero) ? 0 : numero;
}
