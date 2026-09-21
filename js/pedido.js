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

// NUEVO (2026-09-21): clave de localStorage para recordar el último presupuesto usado en
// "🎯 Ajustar automáticamente al presupuesto" -- mismo patrón que retro_premium_kits_tamano_lote.
const LS_PRESUPUESTO = 'retro_premium_presupuesto_pedido';

const ORDEN_PROVEEDORES = ['LCSC', 'ALIEXPRESS', 'TME'];
const ETIQUETA_PROVEEDOR = { LCSC: 'LCSC', ALIEXPRESS: 'AliExpress', TME: 'TME' };

// NUEVO: orden de PRESELECCIÓN (no de visualización -- eso lo sigue marcando ORDEN_PROVEEDORES).
// A partir de ahora se intenta marcar TME por defecto aunque el artículo en sí salga más caro,
// porque entre no pasar por aduanas y evitar los gastos de gestión de envío de otros couriers
// (ver [[retro-componentes-web]] sobre FedEx/DHL/UPS) suele salir más económico en conjunto.
// Si TME no tiene stock suficiente para cubrir la cantidad pedida, se cae al resto en el orden
// habitual (LCSC, luego AliExpress).
// NUEVO: exportado -- app.js lo reutiliza para el precio estimado de Kits (misma preselección
// que en el generador de pedido, en vez de reinventar el orden ahí).
export const ORDEN_PRESELECCION = ['TME', 'LCSC', 'ALIEXPRESS'];

// NUEVO: Gastos de envío fijos por tienda (de momento a mano; el día que se quiera afinar por
// pedido real se pueden leer de la hoja "Gastos_Extra" en vez de estos valores fijos).
// MODIFICADO 2026-09: LCSC se guarda desglosado en dos partes -- "envio" (el flete/courier que se
// paga al hacer el pedido) y "aduanas" (la cuota de gestión/desembolso que cobra el transportista
// al llegar a España -- ver [[retro-componentes-web]] sobre la queja confirmada de FedEx), porque
// son dos cargos de origen distinto aunque ambos formen parte del coste real de comprar en LCSC.
// AliExpress también aplica aduanas (8€), aunque su envío en sí siga siendo gratis.
// NUEVO 2026-09-11: Mouser (mouser.es/eu.mouser.com) añadido como proveedor -- envío DDP a la UE
// (aranceles/aduanas ya incluidos en el precio mostrado, sin sorpresas al llegar) y gratis a partir
// de 75€ de pedido, que es el importe habitual de un pedido de restock -- de ahí 0€ en ambos campos
// como aproximación razonable (igual de simplificado que el resto de esta tabla, que ya asume un
// coste fijo por pedido en vez de calcularlo por importe real). De momento NO se ha añadido a
// ORDEN_PRESELECCION: esa preselección depende de tener datos de stock/precio por componente (como
// las hojas Variantes_LCSC/AliExpress/TME), y todavía no existe una "Variantes_Mouser" -- se hará
// cuando se resuelva cómo obtener ese stock (API de Mouser), ver [[retro-componentes-web]].
const GASTOS_ENVIO = {
    LCSC: { envio: 40, aduanas: 30 },
    ALIEXPRESS: { envio: 0, aduanas: 8 },
    TME: { envio: 14, aduanas: 0 },
    MOUSER: { envio: 0, aduanas: 0 }
};

// NUEVO: total de gastos (envío + aduanas) de un proveedor, para no repetir la suma en cada sitio
// que lo necesite. Exportado -- también lo usa app.js para prorratear el envío en el precio
// estimado de Kits.
export function totalGastosEnvio(proveedor) {
    const g = GASTOS_ENVIO[proveedor];
    if (!g) return 0;
    return (g.envio || 0) + (g.aduanas || 0);
}

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

    // NUEVO (2026-09-21): "🎯 Ajustar automáticamente al presupuesto" -- lee/guarda el importe en
    // localStorage (para no tener que reescribirlo cada vez) y lanza ajustarAPresupuesto().
    const inputPresupuesto = document.getElementById('pedido-presupuesto');
    const btnAjustar = document.getElementById('btn-ajustar-presupuesto');
    if (inputPresupuesto) {
        try {
            const guardado = localStorage.getItem(LS_PRESUPUESTO);
            if (guardado) inputPresupuesto.value = guardado;
        } catch (e) { /* localStorage puede fallar (modo privado, cuota) -- no es crítico */ }
    }
    if (btnAjustar) btnAjustar.addEventListener('click', ajustarAPresupuesto);

    pedidoInicializado = true;
}

// Carga (una vez) y estructura todos los datos necesarios para calcular pedidos
async function cargarDatosPedido() {
    if (cacheDatosPedido) return cacheDatosPedido;

    const [componentes, kits, variantesLCSC, variantesAli, variantesTME, datosStock] = await Promise.all([
        obtenerDatos('Componentes'),
        obtenerDatos('Kits_Consolas'),
        obtenerDatos('Variantes_LCSC'),
        obtenerDatos('Variantes_AliExpress'),
        obtenerDatos('Variantes_TME'),
        obtenerDatos('Stock_Almacen')
    ]);

    // NUEVO: stock físico ya disponible por ID_Componente (mismo cálculo que verificarStock() en
    // pedidos.js -- se suman todas las filas de Stock_Almacen de un mismo ID_Componente, por si
    // hay stock repartido en varias entradas). Se usa para restar del pedido lo que ya se tiene.
    // MODIFICADO (2026-09-09): también se suma "Stock_En_Camino" (pedido ya hecho, todavía sin
    // llegar) -- a petición del usuario, cuenta igual que el stock físico para no pedir de más lo
    // que ya está en camino.
    const stockPorId = {};
    datosStock.forEach(row => {
        const id = (row['ID_Componente'] || '').trim();
        if (!id) return;
        stockPorId[id] = (stockPorId[id] || 0) + parseNumeroES(row['Uds_Disponibles']) + parseNumeroES(row['Stock_En_Camino']);
    });

    // NUEVO (2026-09-20): precio real (Stock_Almacen) por GRUPO -- el usuario detectó que un
    // componente comprado suelto y dado de alta a mano en Stock_Almacen (sin ningún proveedor
    // sincronizado en Componentes/Variantes_*) no tenía NINGÚN precio de referencia aquí, aunque
    // sí lo tiene en Stock_Almacen columna H (Precio_Real_Medio) -- se usa como última opción de
    // precio cuando ningún proveedor real cubre la cantidad, para no dejar la fila sin ningún
    // precio con el que "probar costes". Se toma el MÁS ALTO entre Precio_Real_Medio (lo ya
    // recibido) y Precio_Real_En_Camino (lo pedido pero aún sin llegar) -- mismo criterio que ya
    // usa app.js para el precio estimado de la pestaña Kits. Se agrupa por "grupo" (no por ID
    // literal) porque el precio real puede estar registrado bajo el ID del SUSTITUTO aunque
    // Kits_Consolas siga listando el original (hoja Sustituciones) -- así una fila encuentra el
    // precio real sea cual sea de los dos IDs el que lo tenga.
    const precioRealPorId = {};
    datosStock.forEach(row => {
        const id = (row['ID_Componente'] || '').trim();
        if (!id) return;
        const precio = Math.max(parseNumeroES(row['Precio_Real_Medio']), parseNumeroES(row['Precio_Real_En_Camino']));
        if (precio > (precioRealPorId[id] || 0)) precioRealPorId[id] = precio;
    });

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

    // NUEVO (2026-09-21, fix): para cada "grupo" (el ID_Original), la lista de TODOS los IDs
    // literales conocidos que son ese mismo componente físico (el original + su/sus sustituto(s)
    // -- puede haber más de uno si se ha sustituido más de una vez). Hace falta para juntar el
    // STOCK de un componente y su sustituto: Stock_Almacen puede tener las unidades guardadas bajo
    // cualquiera de los dos IDs (el que se compró la última vez), y sin esto la web podía contar
    // el mismo componente dos veces -- ver comentario en calcularNecesidadYStockPorGrupo().
    const idsPorGrupo = {};
    Object.keys(sustitucionesMap).forEach(idNuevo => {
        const idOriginal = sustitucionesMap[idNuevo];
        if (!idsPorGrupo[idOriginal]) idsPorGrupo[idOriginal] = [idOriginal];
        idsPorGrupo[idOriginal].push(idNuevo);
    });

    // Ahora que ya tenemos sustitucionesMap, agrupamos precioRealPorId (calculado arriba) por
    // "grupo" -- ver comentario de más arriba sobre por qué hace falta.
    const precioRealPorGrupo = {};
    Object.keys(precioRealPorId).forEach(id => {
        const grupo = sustitucionesMap[id] || id;
        if (precioRealPorId[id] > (precioRealPorGrupo[grupo] || 0)) precioRealPorGrupo[grupo] = precioRealPorId[id];
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
    // Solo necesitamos saber qué combinaciones (proveedor, literalId, marca, link) existen -- los
    // precios/packs reales se sacan de tiersPorProveedor, no de Componentes.
    // NUEVO: "Link_AliExpress" es el nombre histórico de la columna K de Componentes, pero Apps
    // Script ya la reutiliza como el enlace de producto de CUALQUIER proveedor (ver comentario de
    // abrirAsistenteTME en Codigo.gs, "columna K compartida") -- cada fila de Componentes es un
    // (literalId, proveedor) concreto con su propio enlace ahí, así que se puede leer igual aquí.
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
            link: (row['Link_AliExpress'] || '').trim()
        });
    });

    cacheDatosPedido = { kits, sustitucionesMap, idsPorGrupo, filasPorGrupo, tiersPorProveedor, stockPorId, precioRealPorGrupo };
    return cacheDatosPedido;
}

// NUEVO (2026-09-20): "compra" sintética para la opción de precio real de Stock_Almacen -- a
// diferencia de un proveedor de verdad, no tiene tramos por tamaño de pack, es un precio fijo por
// unidad (el coste medio real ya pagado). Devuelve la MISMA FORMA de objeto que calcularMejorCompra
// para que el resto del código (textoYColorOpcion, recalcularPedido...) no tenga que distinguir
// entre ambos casos.
function compraConPrecioReal(precioReal, cantidad) {
    if (!(precioReal > 0) || cantidad <= 0) {
        return { logrado: false, desglose: [], totalUnidades: 0, totalPrecio: 0 };
    }
    return {
        logrado: true,
        desglose: [{ udsPack: 1, unidades: cantidad, precioUnitario: precioReal, esPrecioReal: true }],
        totalUnidades: cantidad,
        totalPrecio: cantidad * precioReal
    };
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
    const { kits, sustitucionesMap, idsPorGrupo, filasPorGrupo, tiersPorProveedor, stockPorId, precioRealPorGrupo } = datosPedido;

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

    // NUEVO (2026-09-21): qué kits (de los seleccionados) usan cada componente y cuánto por kit --
    // a petición del usuario, para que se vea de un vistazo si reducir/quitar la cantidad de un
    // componente concreto afecta solo a un kit o a varios (componente compartido). Se muestra en
    // la propia fila de la tabla (ver renderTablaPedido) y también es la base del ajuste automático
    // de presupuesto (ver buscarAjustePresupuesto), que por eso solo quita KITS ENTEROS y nunca deja
    // un componente compartido a media asta sin que se sepa a qué kits perjudica.
    const usoPorComponente = {};
    seleccion.forEach(({ idKit }) => {
        kits
            .filter(row => row['ID_Kit'] === idKit)
            .forEach(row => {
                const idComp = (row['ID_Componente'] || '').trim();
                const cantidadPorKit = parseFloat(row['Cantidad']) || 0;
                if (!idComp || cantidadPorKit <= 0) return;
                if (!usoPorComponente[idComp]) usoPorComponente[idComp] = [];
                usoPorComponente[idComp].push({ idKit, cantidadPorKit });
            });
    });

    renderTablaPedido(resultadoDiv, idsNecesarios, necesidades, sustitucionesMap, idsPorGrupo, filasPorGrupo, tiersPorProveedor, stockPorId, precioRealPorGrupo, usoPorComponente, seleccion);
}

// NUEVO: el "grupo" de un ID_Componente literal es el ID original si tiene un sustituto
// registrado en la hoja Sustituciones, o su propio ID si no -- misma fórmula que ya usaba
// cargarDatosPedido() para agrupar filasPorGrupo, ahora reutilizada aquí para detectar parejas.
function grupoDe(idComp, sustitucionesMap) {
    return sustitucionesMap[idComp] || idComp;
}

// NUEVO (2026-09-21, fix): el usuario detectó que un componente con pareja (hoja Sustituciones)
// se contaba dos veces -- p.ej. EEUFS0J221 (0 uds en stock) pedía comprar 20 uds más aunque su
// sustituto 6.3ZLH220MEFC5X11 (el mismo componente físico) tuviera 108 uds de stock de sobra. La
// causa: "Stock disponible" y "Cantidad a pedir" se calculaban por ID LITERAL, cada fila con su
// propio stock por separado, en vez de por GRUPO (componente + su sustituto) como ya hacía
// correctamente precioRealPorGrupo -- si el stock físico está guardado bajo el ID del sustituto
// (o al revés), la fila del otro ID no lo veía y pedía de más sin falta real.
// Esta función agrupa, para los componentes necesarios en ESTE pedido: la necesidad total por
// grupo (suma de las necesidades de todos sus IDs presentes en el pedido), el stock total por
// grupo (suma del stock de TODOS los IDs conocidos de ese grupo -- aunque alguno no aparezca en
// este pedido en concreto, por si el stock está ahí) y la cantidad a pedir resultante (necesidad
// menos stock, nunca negativa). Se usa tanto en la tabla real (renderTablaPedido) como en el
// simulador del ajuste de presupuesto (simularCoste), para que ambos den siempre el mismo
// resultado.
function calcularNecesidadYStockPorGrupo(idsNecesarios, necesidades, sustitucionesMap, stockPorId, idsPorGrupo) {
    const necesidadPorGrupo = {};
    idsNecesarios.forEach(id => {
        const grupo = grupoDe(id, sustitucionesMap);
        necesidadPorGrupo[grupo] = (necesidadPorGrupo[grupo] || 0) + (necesidades[id] || 0);
    });

    const stockPorGrupo = {};
    const cantidadAPedirPorGrupo = {};
    Object.keys(necesidadPorGrupo).forEach(grupo => {
        const idsDelGrupo = (idsPorGrupo && idsPorGrupo[grupo]) || [grupo];
        const stockTotal = idsDelGrupo.reduce((suma, id) => suma + (stockPorId[id] || 0), 0);
        stockPorGrupo[grupo] = stockTotal;
        cantidadAPedirPorGrupo[grupo] = Math.max(0, necesidadPorGrupo[grupo] - stockTotal);
    });

    return { necesidadPorGrupo, stockPorGrupo, cantidadAPedirPorGrupo };
}

// ============================================================================================
// NUEVO (2026-09-21): "🎯 Ajustar automáticamente al presupuesto".
//
// El usuario probó a pedir un poco de cada kit y el total se disparó muy por encima de lo que
// quiere gastar. Pidió una forma de fijar un presupuesto máximo y que la web le sugiera cómo
// bajar a ese importe, bajando cantidades o quitando algún kit del pedido -- avisando de que como
// muchos componentes se COMPARTEN entre kits, no pedir uno afecta a ese kit o a varios a la vez.
//
// DECISIÓN DE DISEÑO: el ajuste automático solo reduce/quita KITS ENTEROS (unidad a unidad), nunca
// recorta la cantidad de un componente por su cuenta. Motivo: la única cantidad de un componente
// que tiene sentido pedir es la que hace falta para completar los kits que se van a montar -- pedir
// menos que eso dentro de un mismo componente no ahorra nada útil si igualmente hay que comprar el
// resto de piezas de esos kits (te quedarías con kits a medias, no con menos gasto real por kit
// completo). Reduciendo unidad a unidad de kit sí es una decisión coherente: cada unidad que se
// quita dejará de pedirse en TODOS los componentes que necesitaba, incluidos los compartidos con
// otros kits (el ahorro real de esa unidad, una vez recalculados los tramos de precio), y nunca dos
// versiones del optimizador quedan inconsistentes con la tabla real porque usa el mismo
// calcularMejorCompra/ORDEN_PRESELECCION que la tabla. Si el usuario prefiere en cambio recortar la
// cantidad de un componente concreto (asumiendo que un kit se complete más adelante con otro
// pedido), puede seguir haciéndolo a mano en "Cantidad a pedir" -- para eso está la columna "Usado
// en" de cada fila (ver renderTablaPedido), que avisa de a qué kits afecta.
// ============================================================================================

// Simula el precio total de un pedido para un vector de cantidades por kit (sin tocar el DOM ni
// depender de lo que haya seleccionado el usuario en la tabla) -- misma lógica de agrupación,
// preselección de proveedor (ORDEN_PRESELECCION) y cálculo por tramos (calcularMejorCompra) que usa
// la tabla real, para que el resultado del optimizador sea coherente con lo que luego se vería al
// pulsar "Calcular Pedido" con ese mismo vector de cantidades.
function simularCoste(seleccionKits, datosPedido) {
    const { kits, sustitucionesMap, idsPorGrupo, filasPorGrupo, tiersPorProveedor, stockPorId, precioRealPorGrupo } = datosPedido;

    const necesidades = {};
    seleccionKits.forEach(({ idKit, cantidad }) => {
        if (cantidad <= 0) return;
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
    if (idsNecesarios.length === 0) return { total: 0, porTienda: {} };

    // Mismo orden que renderTablaPedido -- no afecta al total, pero sí a qué fila de una pareja
    // (componente + sustituto) se marca primero como "la comprada" (ver preseleccionadoPorGrupo).
    idsNecesarios.sort((a, b) => {
        const grupoA = grupoDe(a, sustitucionesMap);
        const grupoB = grupoDe(b, sustitucionesMap);
        if (grupoA !== grupoB) return grupoA.localeCompare(grupoB, 'es', { sensitivity: 'base' });
        return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });

    // NUEVO (2026-09-21, fix): necesidad y stock agrupados por GRUPO (no por ID literal) -- ver
    // calcularNecesidadYStockPorGrupo(). Sin esto, el optimizador de presupuesto podía dar un total
    // distinto (más caro) del que luego se vería en la tabla real, porque contaba dos veces el
    // stock de un componente y su sustituto.
    const { cantidadAPedirPorGrupo } = calcularNecesidadYStockPorGrupo(idsNecesarios, necesidades, sustitucionesMap, stockPorId, idsPorGrupo);

    const preseleccionadoPorGrupo = {};
    const porTienda = {}; // proveedor -> subtotal artículos (sin envío todavía)
    let subtotalStockReal = 0;

    idsNecesarios.forEach(idComp => {
        const grupo = grupoDe(idComp, sustitucionesMap);
        if (preseleccionadoPorGrupo[grupo]) return; // ya cubierto por su pareja en este grupo

        const cantidadPedida = cantidadAPedirPorGrupo[grupo] || 0;

        if (cantidadPedida <= 0) {
            preseleccionadoPorGrupo[grupo] = true; // cubierto con stock (propio o de su pareja), no hace falta pedir nada
            return;
        }

        const opciones = filasPorGrupo[grupo] || [];
        const opcionesConDatos = opciones.map(opt => {
            const tiers = (tiersPorProveedor[opt.proveedor] && tiersPorProveedor[opt.proveedor][opt.literalId]) || [];
            const compra = calcularMejorCompra(tiers, cantidadPedida);
            const hayStock = tiers.some(t => t.stockPacks > 0);
            return Object.assign({}, opt, { compra, hayStock });
        });
        const precioReal = (precioRealPorGrupo || {})[grupo] || 0;
        if (precioReal > 0) {
            opcionesConDatos.push({
                literalId: idComp, proveedor: 'STOCK_REAL',
                compra: compraConPrecioReal(precioReal, cantidadPedida), hayStock: true
            });
        }

        // Misma preselección que la tabla real: TME primero si cubre, si no cae a LCSC/AliExpress.
        let elegido = null;
        for (const proveedorPref of ORDEN_PRESELECCION) {
            const candidata = opcionesConDatos.find(o => o.proveedor === proveedorPref);
            if (candidata && candidata.hayStock && candidata.compra.desglose.length > 0 && candidata.compra.logrado) {
                elegido = candidata;
                break;
            }
        }
        if (!elegido) {
            // Ningún proveedor preferente cubre la cantidad completa -- como en la tabla real, el
            // usuario tendría que elegir a mano entre lo que sí hay; para la simulación se toma la
            // opción real más barata que sí logre cubrirla, o si ninguna cubre del todo, el precio
            // real de stock si existe (igual que hace la tabla al preseleccionar).
            const logrados = opcionesConDatos.filter(o => o.proveedor !== 'STOCK_REAL' && o.hayStock && o.compra.desglose.length > 0 && o.compra.logrado);
            if (logrados.length > 0) {
                elegido = logrados.sort((a, b) => a.compra.totalPrecio - b.compra.totalPrecio)[0];
            } else {
                const candidataReal = opcionesConDatos.find(o => o.proveedor === 'STOCK_REAL');
                if (candidataReal && candidataReal.compra.totalUnidades > 0 && candidataReal.compra.logrado) {
                    elegido = candidataReal;
                }
            }
        }

        preseleccionadoPorGrupo[grupo] = true;
        if (!elegido) return; // sin ninguna opción viable -- no aporta coste (ni se puede comprar)

        if (elegido.proveedor === 'STOCK_REAL') {
            subtotalStockReal += elegido.compra.totalPrecio;
        } else {
            porTienda[elegido.proveedor] = (porTienda[elegido.proveedor] || 0) + elegido.compra.totalPrecio;
        }
    });

    let total = subtotalStockReal;
    Object.keys(porTienda).forEach(proveedor => {
        total += porTienda[proveedor] + totalGastosEnvio(proveedor);
    });

    return { total, porTienda };
}

// Busca, mediante un algoritmo voraz (greedy), cuántas unidades de cada kit mantener para que el
// total quede por debajo (o igual) del presupuesto: en cada paso prueba a quitar 1 unidad de cada
// kit que todavía tenga alguna, recalcula el total resultante con simularCoste() y se queda con la
// que más ahorre en términos reales (no un cálculo aproximado -- la simulación completa, con sus
// tramos de precio y gastos de envío por tienda). Repite hasta entrar en presupuesto o quedarse sin
// kits que quitar. En empates (ahorro igual, con un margen de 1 céntimo), prefiere quitar del kit
// que todavía tenga MÁS unidades pedidas -- así, si hay que elegir, reparte el recorte en vez de
// dejar a cero un kit del que solo se pedía 1 unidad mientras otro con 5 se queda intacto.
function buscarAjustePresupuesto(seleccionOriginal, presupuesto, datosPedido) {
    const actual = seleccionOriginal.map(k => Object.assign({}, k));
    const pasos = [];

    let resultado = simularCoste(actual, datosPedido);
    if (resultado.total <= presupuesto) {
        return { logrado: true, seleccionFinal: actual, totalFinal: resultado.total, pasos };
    }

    let unidadesRestantes = actual.reduce((suma, k) => suma + k.cantidad, 0);
    let iteraciones = 0;
    const LIMITE_ITERACIONES = 2000; // red de seguridad -- de sobra para cualquier pedido real

    while (resultado.total > presupuesto && unidadesRestantes > 0 && iteraciones < LIMITE_ITERACIONES) {
        iteraciones++;

        let mejorIndice = -1;
        let mejorAhorro = -Infinity;
        let mejorResultado = null;

        for (let i = 0; i < actual.length; i++) {
            if (actual[i].cantidad <= 0) continue;
            const candidata = actual.map((k, j) => (j === i ? Object.assign({}, k, { cantidad: k.cantidad - 1 }) : k));
            const r = simularCoste(candidata, datosPedido);
            const ahorro = resultado.total - r.total;

            const mejora = ahorro > mejorAhorro + 0.005;
            const empate = Math.abs(ahorro - mejorAhorro) <= 0.005;
            if (mejora || (empate && mejorIndice !== -1 && actual[i].cantidad > actual[mejorIndice].cantidad)) {
                mejorIndice = i;
                mejorAhorro = ahorro;
                mejorResultado = r;
            }
        }

        if (mejorIndice === -1) break; // no debería pasar si unidadesRestantes > 0, pero por si acaso

        actual[mejorIndice].cantidad -= 1;
        unidadesRestantes--;
        pasos.push({
            idKit: actual[mejorIndice].idKit,
            cantidadRestante: actual[mejorIndice].cantidad,
            ahorro: mejorAhorro,
            totalTrasPaso: mejorResultado.total
        });
        resultado = mejorResultado;
    }

    return { logrado: resultado.total <= presupuesto, seleccionFinal: actual, totalFinal: resultado.total, pasos };
}

// Lee la selección actual de kits (checkboxes + cantidades, igual que calcularPedido) y el
// presupuesto indicado, lanza buscarAjustePresupuesto() y pinta el resultado con la opción de
// aplicarlo directamente (lo que actualiza los checkboxes/cantidades y genera el pedido normal).
async function ajustarAPresupuesto() {
    const resultadoDiv = document.getElementById('pedido-resultado');
    const inputPresupuesto = document.getElementById('pedido-presupuesto');
    if (!resultadoDiv || !inputPresupuesto) return;

    const presupuesto = parseNumeroES(inputPresupuesto.value);
    if (!(presupuesto > 0)) {
        resultadoDiv.innerHTML = '<p style="color:var(--danger);">Indica un presupuesto máximo mayor que 0.</p>';
        return;
    }
    try {
        localStorage.setItem(LS_PRESUPUESTO, String(presupuesto));
    } catch (e) { /* localStorage puede fallar (modo privado, cuota) -- no es crítico */ }

    const checks = document.querySelectorAll('.pedido-check-kit:checked');
    if (checks.length === 0) {
        resultadoDiv.innerHTML = '<p style="color:var(--danger);">Selecciona al menos un kit.</p>';
        return;
    }
    const seleccionOriginal = Array.from(checks).map(chk => {
        const idKit = chk.getAttribute('data-kit');
        const inputCantidad = document.querySelector(`.pedido-cantidad-kit[data-kit="${CSS.escape(idKit)}"]`);
        const cantidad = inputCantidad ? (parseInt(inputCantidad.value, 10) || 0) : 0;
        return { idKit, cantidad };
    }).filter(s => s.cantidad > 0);

    if (seleccionOriginal.length === 0) {
        resultadoDiv.innerHTML = '<p style="color:var(--danger);">Indica una cantidad mayor que 0 para al menos un kit seleccionado.</p>';
        return;
    }

    resultadoDiv.innerHTML = '<p style="color:var(--text-secondary);">Buscando el mejor ajuste para ese presupuesto...</p>';

    let datosPedido;
    try {
        datosPedido = await cargarDatosPedido();
    } catch (err) {
        resultadoDiv.innerHTML = `<p style="color:var(--danger);">Error al calcular el ajuste: ${err.message}. Prueba a recargar la página.</p>`;
        return;
    }
    if (datosPedido.kits.length === 0 || Object.keys(datosPedido.filasPorGrupo).length === 0) {
        cacheDatosPedido = null;
        resultadoDiv.innerHTML = '<p style="color:var(--danger);">No se han podido cargar todos los datos de la hoja (puede que Google haya tardado demasiado en responder). Pulsa el botón otra vez.</p>';
        return;
    }

    const totalOriginal = simularCoste(seleccionOriginal, datosPedido).total;

    if (totalOriginal <= presupuesto) {
        resultadoDiv.innerHTML = `<p style="color:var(--success);">✅ Este pedido ya está dentro de presupuesto: ${formatearPrecioLocal(totalOriginal)}€ (≤ ${formatearPrecioLocal(presupuesto)}€). No hace falta ajustar nada -- generando el pedido tal cual.</p>`;
        calcularPedido();
        return;
    }

    const ajuste = buscarAjustePresupuesto(seleccionOriginal, presupuesto, datosPedido);
    renderResultadoAjuste(resultadoDiv, seleccionOriginal, ajuste, presupuesto, totalOriginal);
}

// Pinta el resultado del ajuste: tabla kit-a-kit (cantidad original vs sugerida), ahorro logrado,
// el detalle paso a paso (colapsado) y botones para aplicarlo o descartarlo.
function renderResultadoAjuste(contenedor, seleccionOriginal, ajuste, presupuesto, totalOriginal) {
    const filasCambios = ajuste.seleccionFinal.map((kitFinal, i) => {
        const original = seleccionOriginal[i].cantidad;
        const nueva = kitFinal.cantidad;
        let celdaNueva;
        if (nueva === original) {
            celdaNueva = `${nueva} <span style="color:var(--text-secondary); font-size:12px;">(sin cambios)</span>`;
        } else if (nueva === 0) {
            celdaNueva = '<span style="color:var(--danger); font-weight:bold;">❌ 0 — eliminado de este pedido</span>';
        } else {
            celdaNueva = `<span style="color:#eab308; font-weight:bold;">${nueva}</span> <span style="color:var(--text-secondary); font-size:12px;">(antes ${original})</span>`;
        }
        return `<tr><td>${escapeAttr(kitFinal.idKit)}</td><td>${original}</td><td>${celdaNueva}</td></tr>`;
    }).join('');

    const ahorro = totalOriginal - ajuste.totalFinal;

    const pasosHtml = ajuste.pasos.length > 0 ? `
        <details style="margin-top:10px;">
            <summary style="cursor:pointer; color:var(--text-secondary); font-size:12px;">Ver el detalle de los ${ajuste.pasos.length} recorte(s) aplicados, uno a uno</summary>
            <ul style="font-size:12px; color:var(--text-secondary); margin:8px 0 0 18px; padding:0;">
                ${ajuste.pasos.map(p => `<li>Quitada 1 unidad de <strong>${escapeAttr(p.idKit)}</strong> (quedan ${p.cantidadRestante}) — ahorro ${formatearPrecioLocal(p.ahorro)}€ → total tras este paso: ${formatearPrecioLocal(p.totalTrasPaso)}€</li>`).join('')}
            </ul>
        </details>` : '';

    const avisoNoLogrado = !ajuste.logrado
        ? `<p style="color:var(--danger); font-size:13px;">⚠️ No se ha podido bajar hasta ${formatearPrecioLocal(presupuesto)}€ ni quitando todos los kits posibles del pedido -- puede que haga falta revisar precios/proveedores a mano.</p>`
        : '';

    contenedor.innerHTML = `
        <div class="card" style="border: 1px solid var(--primary); margin-top:0; margin-bottom:0;">
            <h3 style="margin-top:0;">🎯 Ajuste sugerido para no pasar de ${formatearPrecioLocal(presupuesto)}€</h3>
            <p style="color:var(--text-secondary); font-size:13px;">
                Pedido completo (todos los kits marcados, cantidades tal cual las pusiste): <strong>${formatearPrecioLocal(totalOriginal)}€</strong><br>
                Pedido ajustado: <strong style="color:var(--success);">${formatearPrecioLocal(ajuste.totalFinal)}€</strong>
                &nbsp;(ahorro de ${formatearPrecioLocal(ahorro)}€)
            </p>
            ${avisoNoLogrado}
            <div style="overflow-x:auto;">
                <table>
                    <thead><tr><th>Kit</th><th>Cantidad original</th><th>Cantidad sugerida</th></tr></thead>
                    <tbody>${filasCambios}</tbody>
                </table>
            </div>
            ${pasosHtml}
            <p style="color:var(--text-secondary); font-size:12px; margin-top:12px;">
                Este ajuste solo quita <strong>unidades de kit completas</strong> (nunca deja un componente a medias con la cantidad justa que falte), porque muchos componentes se comparten entre varios kits -- en cada paso ha quitado la unidad que menos ahorro real aportaba. Si prefieres tú mismo decidir qué componente concreto pedir de menos (por ejemplo si vas a completar ese kit más adelante con otro pedido), pulsa "Calcular Pedido" con tus cantidades originales y edita a mano la columna "Cantidad a pedir" -- cada fila indica en qué kit(s) se usa ese componente.
            </p>
            <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                <button id="btn-aplicar-ajuste" class="btn" style="background: var(--success);">✅ Aplicar esta sugerencia y generar el pedido</button>
                <button id="btn-cancelar-ajuste" class="btn" style="background: var(--danger);">Descartar</button>
            </div>
        </div>
    `;

    const btnAplicar = document.getElementById('btn-aplicar-ajuste');
    const btnCancelar = document.getElementById('btn-cancelar-ajuste');
    if (btnAplicar) btnAplicar.addEventListener('click', () => aplicarAjuste(ajuste.seleccionFinal));
    if (btnCancelar) btnCancelar.addEventListener('click', () => { contenedor.innerHTML = ''; });
}

// Traslada el resultado del ajuste a los checkboxes/cantidades de la lista de kits de arriba
// (desmarca los que se quedan a 0, actualiza la cantidad de los recortados) y genera el pedido
// normal con esa selección -- así la tabla final es exactamente la misma que si el usuario hubiera
// marcado esas cantidades a mano y pulsado "Calcular Pedido".
function aplicarAjuste(seleccionFinal) {
    seleccionFinal.forEach(({ idKit, cantidad }) => {
        const chk = document.querySelector(`.pedido-check-kit[data-kit="${CSS.escape(idKit)}"]`);
        const inputCantidad = document.querySelector(`.pedido-cantidad-kit[data-kit="${CSS.escape(idKit)}"]`);
        if (!chk) return;
        if (cantidad <= 0) {
            chk.checked = false;
        } else {
            chk.checked = true;
            if (inputCantidad) inputCantidad.value = cantidad;
        }
    });
    calcularPedido();
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

function renderTablaPedido(contenedor, idsNecesarios, necesidades, sustitucionesMap, idsPorGrupo, filasPorGrupo, tiersPorProveedor, stockPorId, precioRealPorGrupo, usoPorComponente, seleccion) {
    precioRealPorGrupo = precioRealPorGrupo || {};
    usoPorComponente = usoPorComponente || {};
    seleccion = seleccion || [];
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
    // NUEVO: la preselección automática de la opción ahora se hace a nivel de GRUPO, no de fila
    // individual -- si dos filas son pareja, solo se marca una opción en todo el grupo, porque
    // evidentemente solo hace falta comprar uno de los dos componentes.
    const preseleccionadoPorGrupo = {};

    // NUEVO (2026-09-21, fix): stock y cantidad a pedir agrupados por GRUPO (componente + su
    // sustituto), no por ID literal -- ver calcularNecesidadYStockPorGrupo(). Antes, si el stock
    // físico de un componente estaba guardado bajo el ID de su sustituto (o al revés), la fila de
    // ese componente no lo veía y la web recomendaba comprar de más sin que hiciera falta.
    const { stockPorGrupo, cantidadAPedirPorGrupo } = calcularNecesidadYStockPorGrupo(idsNecesarios, necesidades, sustitucionesMap, stockPorId, idsPorGrupo);
    // De las dos (o más) filas de un mismo grupo, solo la PRIMERA que se pinta se lleva la
    // cantidad a pedir combinada del grupo entero -- las siguientes se muestran como cubiertas
    // (igual que ya pasaba con la elección de proveedor), para no pedir el mismo componente dos
    // veces por partida doble.
    const cantidadYaAsignadaPorGrupo = {};

    idsNecesarios.forEach((idComp, indiceFila) => {
        const cantidadNecesaria = necesidades[idComp];
        const grupo = grupoDe(idComp, sustitucionesMap);
        const opciones = filasPorGrupo[grupo] || [];

        // NUEVO: "Stock disponible" es el stock COMBINADO del grupo (este componente + su
        // sustituto conocido, si lo tiene) -- ver comentario más arriba. "Cantidad a pedir"
        // arranca en la cantidad que le falta a ese grupo entero (nunca por debajo de 0), pero
        // solo en la PRIMERA fila del grupo; el resto arranca en 0 porque esa primera fila ya
        // incluye toda la necesidad conjunta. Sigue siendo editable como antes por si el usuario
        // quiere pedir otra cantidad (p.ej. para llegar a un tramo de precio mejor).
        const stockDisponible = stockPorGrupo[grupo] || 0;
        let cantidadPedidaInicial;
        if (!cantidadYaAsignadaPorGrupo[grupo]) {
            cantidadPedidaInicial = cantidadAPedirPorGrupo[grupo] || 0;
            cantidadYaAsignadaPorGrupo[grupo] = true;
        } else {
            cantidadPedidaInicial = 0;
        }

        // MODIFICADO: el "name" del grupo de radios ahora es por GRUPO (no por fila) -- así, si
        // el componente y su sustituto ocupan dos <tr> distintas, sus radios comparten el mismo
        // atributo "name" HTML y el navegador aplica exclusión mutua nativa ENTRE las dos filas
        // (igual que si fueran opciones de una sola fila): marcar una opción en una fila
        // desmarca automáticamente cualquier opción marcada en su fila pareja.
        const nombreGrupo = `pedido-opcion-grupo-${escapeAttr(grupo)}`;

        // NUEVO: el precio de cada opción se calcula SIEMPRE con "Cantidad a pedir" (editable,
        // arranca en necesaria-menos-stock), no con la cantidad necesaria bruta, para que los
        // datos salgan más aproximados a lo que realmente se va a pagar.
        const opcionesConDatos = opciones
            .map(opt => {
                const tiers = (tiersPorProveedor[opt.proveedor] && tiersPorProveedor[opt.proveedor][opt.literalId]) || [];
                const compra = calcularMejorCompra(tiers, cantidadPedidaInicial);
                const hayStock = tiers.some(t => t.stockPacks > 0);
                return Object.assign({}, opt, { compra, hayStock });
            });

        // NUEVO (2026-09-20): si este hueco tiene un precio real registrado en Stock_Almacen
        // (precioRealPorGrupo -- p.ej. un componente comprado suelto y dado de alta a mano, sin
        // ningún proveedor sincronizado en Componentes/Variantes_*), se añade como una opción MÁS,
        // no como sustituto de las reales -- así sigue habiendo con qué "probar costes" aunque
        // ningún proveedor tenga hoy stock/tramo para este componente. Va SIEMPRE al final de la
        // lista (ver el sort de abajo) porque no es un proveedor al que hacerle un pedido nuevo,
        // es solo la referencia de lo que ya costó la última vez.
        const precioReal = precioRealPorGrupo[grupo] || 0;
        if (precioReal > 0) {
            opcionesConDatos.push({
                literalId: idComp,
                proveedor: 'STOCK_REAL',
                marca: '',
                link: '',
                compra: compraConPrecioReal(precioReal, cantidadPedidaInicial),
                hayStock: true,
                precioReal
            });
        }

        opcionesConDatos.sort((a, b) => {
            const ia = a.proveedor === 'STOCK_REAL' ? 999 : ORDEN_PROVEEDORES.indexOf(a.proveedor);
            const ib = b.proveedor === 'STOCK_REAL' ? 999 : ORDEN_PROVEEDORES.indexOf(b.proveedor);
            return ia - ib;
        });

        // NUEVO: la opción marcada por defecto ya NO es "la primera con stock suficiente en el
        // orden de visualización" -- ahora se prioriza TME aunque el artículo salga más caro,
        // para evitar aduanas y gastos de gestión de otros couriers (ver ORDEN_PRESELECCION).
        // Solo si TME no cubre la cantidad completa se cae al resto en su orden habitual.
        let proveedorPreseleccionado = null;
        if (!preseleccionadoPorGrupo[grupo]) {
            for (const proveedorPref of ORDEN_PRESELECCION) {
                const candidata = opcionesConDatos.find(o => o.proveedor === proveedorPref);
                if (candidata && candidata.hayStock && candidata.compra.desglose.length > 0 && candidata.compra.logrado) {
                    proveedorPreseleccionado = proveedorPref;
                    break;
                }
            }
            // NUEVO: si ningún proveedor real cubre la cantidad, pero hay precio real de
            // Stock_Almacen disponible, se preselecciona como última opción -- mejor una
            // referencia de coste real que dejar la fila sin nada marcado.
            if (!proveedorPreseleccionado) {
                const candidataReal = opcionesConDatos.find(o => o.proveedor === 'STOCK_REAL');
                if (candidataReal && candidataReal.compra.totalUnidades > 0 && candidataReal.compra.logrado) {
                    proveedorPreseleccionado = 'STOCK_REAL';
                }
            }
        }

        const opcionesHtml = opcionesConDatos.length === 0
            ? '<span style="color:var(--danger); font-size:12px;">Componente no encontrado en Componentes</span>'
            : opcionesConDatos.map(opt => {
                const usable = cantidadPedidaInicial > 0 && opt.hayStock && opt.compra.desglose.length > 0;
                const disabled = !usable ? 'disabled' : '';
                let checked = '';
                if (usable && opt.proveedor === proveedorPreseleccionado && !preseleccionadoPorGrupo[grupo]) {
                    checked = 'checked';
                    preseleccionadoPorGrupo[grupo] = true;
                }
                // MODIFICADO: el texto/color de cada opción (desglose, "sin stock", "cubierto con
                // stock"...) ahora sale de textoYColorOpcion() -- misma función que usa
                // actualizarFilaPorCantidad() al editar "Cantidad a pedir", para que el resultado
                // sea idéntico se calcule cuando se calcule.
                const { desgloseTexto, texto: textoCompra, color: colorTexto } =
                    textoYColorOpcion(opt.compra, opt.hayStock, cantidadPedidaInicial);
                // NUEVO: la etiqueta del proveedor (+marca) ahora es un link a la ficha real del
                // producto cuando esa fila de Componentes tiene uno guardado -- ver
                // etiquetaProveedorHtml().
                const etiquetaHtml = etiquetaProveedorHtml(opt.proveedor, opt.marca, opt.link);

                // NUEVO: data-literal-id, data-marca y data-link permiten recalcular esta misma
                // opción más tarde (cuando el usuario edite "Cantidad a pedir") sin tener que
                // regenerar todo el HTML de la fila -- ver actualizarFilaPorCantidad(). El texto
                // visible ahora vive en un <span class="pedido-texto-opcion"> aparte para poder
                // actualizarlo solo a él, conservando el estado "checked" del radio tal cual lo
                // dejó el usuario.
                return `
                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; padding:3px 0; ${!usable ? 'opacity:0.55;' : ''}">
                        <input type="radio" name="${nombreGrupo}"
                            data-total-unidades="${opt.compra.totalUnidades}"
                            data-total-precio="${opt.compra.totalPrecio}"
                            data-desglose="${escapeAttr(desgloseTexto)}"
                            data-logrado="${opt.compra.logrado}"
                            data-proveedor="${opt.proveedor}"
                            data-literal-id="${escapeAttr(opt.literalId)}"
                            data-marca="${escapeAttr(opt.marca || '')}"
                            data-link="${escapeAttr(opt.link || '')}"
                            data-precio-real="${opt.precioReal || ''}"
                            ${checked} ${disabled}
                            class="pedido-radio-opcion">
                        <span class="pedido-texto-opcion" style="${colorTexto}">${etiquetaHtml} — ${textoCompra}</span>
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

        // NUEVO (2026-09-21): en qué kits (de los seleccionados para este pedido) se usa este
        // componente y cuántas unidades por kit -- así, si te planteas pedir menos de lo necesario
        // o no pedirlo, ves de un vistazo si eso afecta solo a un kit o a varios (compartido).
        const usos = usoPorComponente[idComp] || [];
        let usoHtml = '';
        if (usos.length > 0) {
            const partes = usos
                .map(u => `${escapeAttr(u.idKit)} (${formatearCantidadLocal(u.cantidadPorKit)}/kit)`)
                .join(', ');
            const iconoCompartido = usos.length > 1 ? '🔗 ' : '';
            usoHtml = `<div style="font-size:11px; color:var(--text-secondary); white-space:normal; overflow:visible; margin-top:2px;"
                title="Si pides menos cantidad de la necesaria (o ninguna), estos son los kits que se quedarían sin poder completarse del todo con este pedido.">
                ${iconoCompartido}Usado en: ${partes}
            </div>`;
        }

        filasHtml += `
            <tr data-fila-pedido="${indiceFila}" data-cantidad-necesaria="${cantidadNecesaria}"
                data-cantidad-pedida="${cantidadPedidaInicial}"
                data-grupo="${escapeAttr(grupo)}" data-id-componente="${escapeAttr(idComp)}"
                class="${tienePareja ? 'fila-con-pareja' : ''}">
                <td style="white-space:normal;">${idComp}${iconoPareja}${usoHtml}</td>
                <td>${cantidadNecesaria}</td>
                <td>${formatearCantidadLocal(stockDisponible)}</td>
                <td>
                    <input type="number" class="pedido-input-cantidad-pedida" value="${cantidadPedidaInicial}" min="0" step="any"
                        title="Por defecto es la cantidad necesaria menos el stock que ya tienes -- edítala si quieres pedir otra cantidad (p.ej. para llegar al mínimo de un tramo de precio, o comprar de más)."
                        style="width:80px; padding:4px 6px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
                </td>
                <td>${opcionesHtml}</td>
                <td class="pedido-celda-packs">-</td>
                <td class="pedido-celda-precio">-</td>
            </tr>`;
    });

    // NUEVO (2026-09-21): resumen de para qué kits (y cuántas unidades de cada uno) se ha generado
    // ESTE pedido -- a petición del usuario, para que quede a la vista de un vistazo (sobre todo
    // tras aplicar el ajuste de presupuesto, donde algunas cantidades pueden haber cambiado o algún
    // kit haber quedado eliminado) sin tener que subir a revisar los checkboxes de la lista de kits.
    const resumenSeleccionHtml = seleccion.length > 0
        ? `<div style="margin-bottom:14px; padding:10px 14px; background: rgba(59, 130, 246, 0.1); border: 1px solid var(--primary); border-radius:6px; font-size:13px;">
            📋 Este pedido es para: ${seleccion.map(s => `<strong>${escapeAttr(s.idKit)}</strong> ×${formatearCantidadLocal(s.cantidad)}`).join(', ')}
          </div>`
        : '';

    contenedor.innerHTML = `
        ${resumenSeleccionHtml}
        <p style="color:var(--text-secondary); font-size:12px; margin-top:0;">"Stock disponible" es lo que ya tienes en Stock_Almacen MÁS lo que está "en camino" (pedido a un proveedor pero todavía sin llegar). "Cantidad a pedir" empieza en "Cantidad necesaria" menos ese stock (nunca en negativo) pero puedes editarla libremente -- el precio se recalcula al momento con lo que pongas ahí, no con la cantidad necesaria bruta. Cada opción calcula el precio por tramos: se aplica el precio por unidad del tramo cuyo umbral alcanza la "Cantidad a pedir" a esa cantidad exacta (si pides menos que el tramo más bajo, se compra su mínimo). Por defecto se preselecciona TME cuando tiene stock suficiente (para evitar aduanas y gastos de gestión de otros couriers), aunque el artículo en sí salga algo más caro; si no cubre la cantidad, cae a LCSC o AliExpress. Si ningún proveedor tiene hoy stock/tramo de precio para un componente pero ya lo has comprado antes (tiene precio real en Stock_Almacen), aparece como última opción "💰 Precio real (ya en stock)" -- no es un sitio donde pedirlo, es solo el coste medio real ya pagado, para poder seguir estimando el total aunque no haya proveedor sincronizado para ese componente. El icono 💬 marca componentes con un sustituto equivalente (hoja Sustituciones): evidentemente, solo hace falta comprar uno de los dos, y por eso su "Stock disponible" ya sale sumado entre ambos (el stock físico puede estar guardado bajo cualquiera de los dos IDs) -- la "Cantidad a pedir" combinada de los dos aparece en una sola de las dos filas, la otra sale como cubierta. Bajo cada componente, "Usado en" indica en qué kit(s) de este pedido hace falta y cuántas unidades por kit -- si pides menos cantidad de la que corresponde (o ninguna), esos son los kits que se quedarían incompletos con este pedido; el icono 🔗 marca los que comparten componente con otro kit.</p>
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>Componente</th>
                        <th>Cantidad necesaria</th>
                        <th>Stock disponible</th>
                        <th>Cantidad a pedir</th>
                        <th>Proveedor a pedir</th>
                        <th>Desglose de compra</th>
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

    // NUEVO: al editar "Cantidad a pedir" se recalculan al vuelo las opciones de ESA fila (precio,
    // tramo aplicable, stock suficiente o no) sin tocar las demás filas ni perder la selección de
    // proveedor ya hecha por el usuario, y luego se refresca el resumen/desglose general.
    contenedor.querySelectorAll('.pedido-input-cantidad-pedida').forEach(input => {
        input.addEventListener('input', (ev) => actualizarFilaPorCantidad(ev.target.closest('tr')));
    });

    recalcularPedido();
}

// NUEVO: construye el HTML de la etiqueta de una opción de proveedor ("TME — Nichicon", etc.) --
// si esa fila de Componentes tiene un enlace de producto (columna "Link_AliExpress", reutilizada
// como enlace genérico -- ver comentario en cargarDatosPedido), la etiqueta entera se convierte en
// un link que abre la ficha real del producto en una pestaña nueva. Así se puede hacer el pedido
// pinchando directamente ahí, sin tener que ir a buscarlo a mano en Google Sheets. Se valida que
// el link empiece por http(s):// antes de convertirlo en <a> -- si viene vacío o con otra cosa, se
// deja como texto plano (evita esquemas raros tipo "javascript:" colándose desde la hoja).
function etiquetaProveedorHtml(proveedor, marca, link) {
    // NUEVO (2026-09-20): opción de precio real de Stock_Almacen (ver compraConPrecioReal) -- se
    // marca claramente como algo distinto de un proveedor real, para que no se confunda con un
    // sitio donde hacer un pedido nuevo.
    if (proveedor === 'STOCK_REAL') {
        return `<span style="color:var(--success);" title="Precio medio real de lo que ya has comprado de este componente (Stock_Almacen, columna Precio_Real_Medio/Precio_Real_En_Camino) -- no es un proveedor al que hacerle un pedido nuevo, es solo una referencia de coste por si necesitas más de lo que ya tienes en stock">💰 Precio real (ya en stock)</span>`;
    }
    const etiquetaProveedor = ETIQUETA_PROVEEDOR[proveedor] || proveedor;
    const etiquetaMarca = marca ? ` — ${marca}` : '';
    const texto = `${etiquetaProveedor}${etiquetaMarca}`;
    if (link && /^https?:\/\//i.test(link)) {
        return `<a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);" title="Abrir ficha del producto en ${escapeAttr(etiquetaProveedor)}">${texto} 🔗</a>`;
    }
    return texto;
}

// NUEVO: dado el resultado de calcularMejorCompra() para UNA opción de proveedor, decide qué
// texto y color mostrar -- misma lógica usada tanto en el render inicial de la tabla como en
// actualizarFilaPorCantidad() (al editar "Cantidad a pedir"), para que ambos caminos den
// exactamente el mismo resultado. "cantidadPedida === 0" es un caso válido y distinto de "sin
// stock": significa que el stock que ya tienes cubre toda la necesidad y no hace falta pedir nada.
function textoYColorOpcion(compra, hayStock, cantidadPedida) {
    const desgloseTexto = compra.desglose
        .map(d => `${d.unidades} uds a ${formatearPrecioUnitarioLocal(d.precioUnitario)}€/ud ${d.esPrecioReal ? '(precio real de compra)' : `(tramo ≥${d.udsPack}u)`}`)
        .join(' + ');
    if (cantidadPedida <= 0) {
        return { desgloseTexto: '', texto: '📦 Cubierto con el stock que ya tienes', color: 'color:var(--text-secondary);' };
    }
    if (!hayStock || compra.desglose.length === 0) {
        return { desgloseTexto, texto: 'Sin stock disponible', color: 'color:var(--danger);' };
    }
    let texto = `${desgloseTexto} = ${formatearPrecioLocal(compra.totalPrecio)}€`;
    let color = '';
    if (!compra.logrado) {
        texto += ' ⚠️ no cubre toda la cantidad (stock insuficiente)';
        color = 'color:#eab308;';
    }
    return { desgloseTexto, texto, color };
}

// NUEVO: recalcula el precio/desglose de TODAS las opciones (proveedores) de una fila cuando el
// usuario cambia manualmente su "Cantidad a pedir" -- reutiliza calcularMejorCompra() con la
// nueva cantidad en vez de la cantidad inicial (necesaria menos stock), y actualiza en el DOM
// tanto los atributos data-* de cada radio (que lee recalcularPedido) como el texto visible de
// cada opción, conservando qué radio tenía marcado el usuario (o desmarcándolo si deja de ser
// viable con la nueva cantidad). Un valor de 0 es válido (ver textoYColorOpcion) -- solo se
// ignora mientras el campo está vacío o con un valor negativo/inválido, típico de estar
// escribiendo/borrando a mano.
function actualizarFilaPorCantidad(tr) {
    if (!tr) return;
    const inputCantidad = tr.querySelector('.pedido-input-cantidad-pedida');
    if (!inputCantidad || !cacheDatosPedido) return;

    const bruto = inputCantidad.value.trim();
    if (bruto === '') return; // sigue escribiendo/borrando -- no recalculamos todavía
    const cantidadPedida = parseNumeroES(bruto);
    if (cantidadPedida < 0) return; // valor inválido, no recalculamos

    const { tiersPorProveedor } = cacheDatosPedido;

    tr.querySelectorAll('.pedido-radio-opcion').forEach(radio => {
        const proveedor = radio.getAttribute('data-proveedor');
        const literalId = radio.getAttribute('data-literal-id');
        const marca = radio.getAttribute('data-marca') || '';
        const link = radio.getAttribute('data-link') || '';

        // NUEVO (2026-09-20): la opción de precio real de Stock_Almacen no tiene tramos por
        // proveedor -- se recalcula aparte con el precio fijo guardado en data-precio-real (ver
        // renderTablaPedido) en vez de buscarla en tiersPorProveedor (que no la conoce).
        let compra, hayStock;
        if (proveedor === 'STOCK_REAL') {
            const precioReal = parseNumeroES(radio.getAttribute('data-precio-real'));
            compra = compraConPrecioReal(precioReal, cantidadPedida);
            hayStock = precioReal > 0;
        } else {
            const tiers = (tiersPorProveedor[proveedor] && tiersPorProveedor[proveedor][literalId]) || [];
            compra = calcularMejorCompra(tiers, cantidadPedida);
            hayStock = tiers.some(t => t.stockPacks > 0);
        }
        const usable = cantidadPedida > 0 && hayStock && compra.desglose.length > 0;

        radio.disabled = !usable;
        if (!usable) radio.checked = false;
        radio.setAttribute('data-total-unidades', compra.totalUnidades);
        radio.setAttribute('data-total-precio', compra.totalPrecio);
        radio.setAttribute('data-logrado', compra.logrado);

        const { desgloseTexto, texto: textoCompra, color: colorTexto } =
            textoYColorOpcion(compra, hayStock, cantidadPedida);
        radio.setAttribute('data-desglose', desgloseTexto);

        const label = radio.closest('label');
        const spanTexto = label ? label.querySelector('.pedido-texto-opcion') : null;
        if (label) label.style.opacity = usable ? '1' : '0.55';
        if (spanTexto) {
            // MODIFICADO: innerHTML (no textContent) para conservar el link a la ficha del
            // producto -- ver etiquetaProveedorHtml(). textContent lo habría convertido en texto
            // plano cada vez que se edita "Cantidad a pedir", perdiendo el enlace.
            spanTexto.setAttribute('style', colorTexto);
            spanTexto.innerHTML = `${etiquetaProveedorHtml(proveedor, marca, link)} — ${textoCompra}`;
        }
    });

    tr.setAttribute('data-cantidad-pedida', cantidadPedida);
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

    // NUEVO (2026-09-20): el usuario detectó que los componentes con "💰 Precio real (ya en
    // stock)" seleccionado (ver renderTablaPedido/compraConPrecioReal) sí sumaban al "Precio
    // estimado" de arriba, pero no aparecían en NINGÚN sitio del desglose de abajo -- porTienda
    // solo agrupa ORDEN_PROVEEDORES (proveedores de verdad), así que esos componentes
    // desaparecían sin explicación y el "Total del pedido" de más abajo no cuadraba con el
    // "Precio estimado" de arriba. Se agrupan aparte (no son "una tienda", no llevan gastos de
    // envío -- ya los tienes) para que su desglose también se vea y sumen al total general.
    const yaEnStock = { items: [], subtotal: 0 };

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
            tr.classList.remove('row-danger', 'row-warning', 'row-cubierta-pareja', 'row-cubierta-stock');
            const cantidadPedida = parseFloat(tr.getAttribute('data-cantidad-pedida'));
            if (!isNaN(cantidadPedida) && cantidadPedida <= 0) {
                // NUEVO: no es un error -- ya tienes stock suficiente para este componente, así
                // que no hace falta elegir proveedor ni contarlo como pendiente (a menos que el
                // usuario edite "Cantidad a pedir" a mano y pida algo de todos modos).
                totalComponentes++;
                if (celdaPacks) celdaPacks.textContent = '📦 cubierto con stock';
                if (celdaPrecio) celdaPrecio.textContent = `${formatearPrecioLocal(0)}€`;
                tr.classList.add('row-cubierta-stock');
                return;
            }
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
        tr.classList.remove('row-danger', 'row-cubierta-pareja', 'row-cubierta-stock');
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

        // MODIFICADO: se usa el atributo data-id-componente (id "limpio") en vez del texto de
        // la celda, que ahora puede incluir el icono 💬 de pareja.
        const nombreComponente = tr.getAttribute('data-id-componente') || '';
        if (porTienda[proveedor]) {
            porTienda[proveedor].items.push({ componente: nombreComponente, desglose, unidades: totalUnidades, precio: precioEstimado });
            porTienda[proveedor].subtotal += precioEstimado;
        } else if (proveedor === 'STOCK_REAL') {
            yaEnStock.items.push({ componente: nombreComponente, desglose, unidades: totalUnidades, precio: precioEstimado });
            yaEnStock.subtotal += precioEstimado;
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

    renderDesglosePorTienda(porTienda, yaEnStock);
}

// NUEVO: pinta, al final de la tabla, un bloque por cada tienda con los artículos que se
// comprarían en ella (cantidad + precio), su subtotal, los gastos de envío fijos de esa tienda,
// el total de esa tienda, y finalmente la suma completa del pedido (artículos + envíos).
// AMPLIADO (2026-09-20): segundo parámetro "yaEnStock" -- componentes con "💰 Precio real (ya en
// stock)" seleccionado (ver recalcularPedido). Se pintan en un bloque aparte, sin gastos de envío
// (ya los tienes, no es un pedido nuevo), pero SÍ suman al "Total del pedido" general para que
// cuadre con el "Precio estimado" del resumen de arriba.
function renderDesglosePorTienda(porTienda, yaEnStock) {
    const desgloseDiv = document.getElementById('pedido-desglose-tiendas');
    if (!desgloseDiv) return;

    let totalGeneral = 0;
    let huboAlgunaTienda = false;
    let html = '<h3 style="margin-bottom:10px;">🏪 Desglose por tienda</h3>';

    ORDEN_PROVEEDORES.forEach(proveedor => {
        const datos = porTienda[proveedor];
        if (!datos || datos.items.length === 0) return;

        huboAlgunaTienda = true;
        const gastos = GASTOS_ENVIO[proveedor] || { envio: 0, aduanas: 0 };
        const envio = totalGastosEnvio(proveedor);
        const totalTienda = datos.subtotal + envio;
        totalGeneral += totalTienda;

        // NUEVO: si el proveedor tiene aduanas>0 (de momento solo LCSC), se muestra el desglose
        // "envío + aduanas" por separado en vez de un único importe, para que quede claro de dónde
        // sale cada parte del gasto (ver comentario en GASTOS_ENVIO).
        const textoGastos = gastos.aduanas > 0
            ? `Envío: ${formatearPrecioLocal(gastos.envio)}€ + Aduanas/gestión: ${formatearPrecioLocal(gastos.aduanas)}€ (${formatearPrecioLocal(envio)}€ total)`
            : `Gastos de envío: ${formatearPrecioLocal(envio)}€`;

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
                    Subtotal artículos: ${formatearPrecioLocal(datos.subtotal)}€ &nbsp;+&nbsp; ${textoGastos}
                </div>
                <div style="text-align:right; font-size:15px; font-weight:bold; margin-top:4px;">
                    Total ${ETIQUETA_PROVEEDOR[proveedor] || proveedor}: ${formatearPrecioLocal(totalTienda)}€
                </div>
            </div>`;
    });

    // NUEVO (2026-09-20): bloque "Ya en stock" -- no es una tienda (no hay gastos de envío, ya
    // tienes las piezas), así que se pinta con un estilo distinto y fuera del bucle de arriba,
    // pero su subtotal sí entra en totalGeneral para que "Total del pedido" cuadre con el
    // "Precio estimado" del resumen.
    if (yaEnStock && yaEnStock.items.length > 0) {
        huboAlgunaTienda = true;
        totalGeneral += yaEnStock.subtotal;

        const filasYaEnStockHtml = yaEnStock.items.map(item => `
            <tr>
                <td>${item.componente}</td>
                <td>${item.desglose}</td>
                <td>${formatearPrecioLocal(item.precio)}€</td>
            </tr>`).join('');

        html += `
            <div style="margin-bottom:18px; border:1px solid var(--border-color); border-radius:6px; padding:12px 15px;">
                <h4 style="margin:0 0 10px 0; color:var(--success);">💰 Ya en stock (precio real, no es un pedido nuevo)</h4>
                <p style="color:var(--text-secondary); font-size:12px; margin:0 0 10px 0;">Estos componentes no tienen hoy ningún proveedor con stock, pero ya los has comprado antes -- el precio es el coste medio real que ya pagaste (Stock_Almacen), no algo que vayas a pedir ahora. No lleva gastos de envío porque no es un pedido nuevo.</p>
                <div style="overflow-x:auto;">
                    <table>
                        <thead><tr><th>Componente</th><th>Cantidad</th><th>Precio</th></tr></thead>
                        <tbody>${filasYaEnStockHtml}</tbody>
                    </table>
                </div>
                <div style="text-align:right; font-size:15px; font-weight:bold; margin-top:8px;">
                    Subtotal ya en stock: ${formatearPrecioLocal(yaEnStock.subtotal)}€
                </div>
            </div>`;
    }

    if (!huboAlgunaTienda) {
        desgloseDiv.innerHTML = '';
        return;
    }

    // NUEVO (2026-09-20): la etiqueta ahora distingue si hay algo de "Ya en stock" metido en el
    // total, para que no parezca que TODO ese importe hay que pedirlo/pagarlo hoy.
    const etiquetaTotal = yaEnStock && yaEnStock.items.length > 0
        ? 'Total general (pedido nuevo + lo que ya tienes en stock)'
        : 'Total del pedido (artículos + envíos)';

    html += `
        <div style="text-align:right; font-size:17px; font-weight:bold; border-top:2px solid var(--border-color); padding-top:12px;">
            ${etiquetaTotal}: ${formatearPrecioLocal(totalGeneral)}€
        </div>`;

    desgloseDiv.innerHTML = html;
}

function formatearPrecioLocal(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

// NUEVO: para la columna "Stock disponible" -- se muestra como número entero si lo es (caso
// normal, unidades de componentes), y con hasta 2 decimales si por lo que sea viene fraccionado
// en Stock_Almacen, sin arrastrar ceros de más (parseNumeroES ya redondea a lo que haya escrito).
function formatearCantidadLocal(n) {
    if (Number.isInteger(n)) return String(n);
    return (Math.round(n * 100) / 100).toString().replace('.', ',');
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
