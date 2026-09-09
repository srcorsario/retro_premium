// js/app.js
import ENV from './config.js';
import { obtenerDatos } from './api.js';
import { renderTabla, mostrarMensaje } from './ui.js';
import { inicializarModuloPedidos } from './pedidos.js';
import { inicializarModuloPedido, ORDEN_PRESELECCION, totalGastosEnvio } from './pedido.js'; // NUEVO: generador de pedido

// Variable para saber qué pestaña estamos viendo
let vistaActual = 'Componentes';

// NUEVO: tamaño de lote (nº de kits que se piden de golpe en un pedido real) para prorratear el
// envío/aduanas en el precio de Kits -- editable desde una casilla en la propia pestaña (ver
// ui.js), guardado en localStorage para que no se resetee al recargar la página. 80 por defecto.
const LS_KITS_TAMANO_LOTE = 'retro_premium_kits_tamano_lote';

function obtenerTamanoLoteGuardado() {
    const guardado = localStorage.getItem(LS_KITS_TAMANO_LOTE);
    const numero = parseInt(guardado, 10);
    return (!isNaN(numero) && numero > 0) ? numero : 80;
}

// NUEVO: datos base (sin calcular precios) de la última carga de la pestaña Kits -- se guardan
// para poder recalcular solo el precio (p.ej. al cambiar el tamaño de lote) sin tener que volver a
// pedir todas las hojas a Google Sheets cada vez que el usuario toca la casilla.
let cacheKitsBase = null;

// NUEVO: recalcula los precios de Kits con un nuevo tamaño de lote y vuelve a pintar la tabla,
// reutilizando los datos ya cargados (cacheKitsBase). Se llama desde el listener de la casilla
// "Kits por pedido" (ver más abajo, event delegation igual que el resto de botones dinámicos).
function recalcularYRenderizarKits(nuevoTamanoLote) {
    if (!cacheKitsBase) return;
    if (nuevoTamanoLote && nuevoTamanoLote > 0) {
        localStorage.setItem(LS_KITS_TAMANO_LOTE, String(nuevoTamanoLote));
    }
    const tamanoLote = obtenerTamanoLoteGuardado();
    const extra = {
        preciosPorKit: calcularPreciosPorKit(cacheKitsBase.datos, cacheKitsBase.datosComponentes, cacheKitsBase.sustituciones, tamanoLote),
        tamanoLote
    };
    renderTabla('contenedor-tabla', cacheKitsBase.datos, 'Kits_Consolas', extra);
}

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

// NUEVO: Las hojas guardan los números en formato español (coma decimal), a veces con el símbolo
// € pegado o con espacio -- mismo helper que ya usa pedido.js para lo mismo.
function parseNumeroES(valor) {
    if (valor === null || valor === undefined) return 0;
    let texto = String(valor).trim();
    if (!texto) return 0;
    texto = texto.replace(/[€$\s]/g, '').replace(',', '.');
    const numero = parseFloat(texto);
    return isNaN(numero) ? 0 : numero;
}

// NUEVO: calcula el precio total estimado de cada kit (ID_Kit -> {total, incompleto}), sumando
// cantidad × precio/ud más barato disponible de cada componente. Dos reglas importantes pedidas
// por el usuario:
// 1. No repetir componentes asociados: si un componente tiene un sustituto (hoja Sustituciones),
//    ambos representan el MISMO hueco de la placa -- se agrupan (igual que en pedido.js) y solo
//    se cuenta UNA vez, la opción más barata entre los dos.
// 2. Se tiene en cuenta la cantidad de cada componente en el kit (columna "Cantidad" de
//    Kits_Consolas), no solo su precio unitario.
// La columna "Precio_Unitario" de Componentes ya trae el mejor precio/ud calculado en la propia
// hoja (fórmula MINIFS sobre Variantes_LCSC/TME/AliExpress) PERO sigue mostrando ese precio de
// referencia aunque el componente esté sin stock ahora mismo (ver memoria del proyecto) -- por
// eso se mira también "Precio_Pack" para detectar el aviso de texto "(Sin Stock)"/"(Fuera de
// límite)" y, si TODAS las opciones de un componente están así, se usa igualmente el precio de
// referencia más barato pero se marca el kit entero como "incompleto" (precio orientativo, no
// 100% comprable ahora mismo con lo que hay en stock).
// MODIFICADO 2026-09-07 (a petición del usuario -- "aplícale todos los costes prorrateados,
// teniendo en cuenta el proveedor de cada artículo, teniendo en cuenta el predeterminado y/o el
// stock"): el precio de un kit ya no es solo "componente × precio/ud más barato entre proveedores".
// Ahora, por cada componente:
//   1. El proveedor se elige con la MISMA preselección que el generador de pedido (ORDEN_PRESELECCION,
//      TME primero) en vez de "el más barato" -- solo se cae a LCSC/AliExpress si TME no tiene esa
//      opción disponible en el proveedor ahora mismo. Si ningún proveedor tiene stock real, se usa
//      la opción de referencia más barata (como antes) y el kit se marca "incompleto".
//   2. Los gastos de envío/aduanas (GASTOS_ENVIO, ver pedido.js) de cada proveedor realmente usado
//      en el kit se suman UNA vez por proveedor y se PRORRATEAN entre sus componentes de ese kit,
//      proporcionalmente a lo que cuesta cada uno (el componente más caro de ese proveedor absorbe
//      más parte del envío) -- así el total del kit refleja el coste real aproximado, no solo el
//      precio de los componentes sueltos.
// MODIFICADO 2026-09-07 (2ª petición): el precio de Kits YA NO resta el stock físico del almacén
// (Stock_Almacen) -- se probó, pero el usuario detectó que como cada kit se calcula por separado,
// una misma unidad de stock se contaba como "cubierta" a la vez en TODOS los kits que usan ese
// componente, dando una sensación falsa de ahorro. El precio de Kits es un valor ORIENTATIVO del
// kit completo (como si se comprara todo desde cero), no "cuánto me falta comprar ahora mismo".
function calcularPreciosPorKit(datosKits, datosComponentes, sustituciones, cantidadKitsPorPedido) {
    const sustitucionesMap = {}; // ID_Nuevo -> ID_Original
    (sustituciones || []).forEach(row => {
        const idNuevo = (row['ID_Nuevo'] || '').trim();
        const idOriginal = (row['ID_Original'] || '').trim();
        if (idNuevo && idOriginal) sustitucionesMap[idNuevo] = idOriginal;
    });
    const grupoDe = (id) => sustitucionesMap[id] || id;

    // Por cada ID_Componente literal, todas sus opciones de precio (una por proveedor que lo
    // tenga registrado en Componentes), con su proveedor y si esa opción concreta está sin stock
    // EN EL PROVEEDOR ahora mismo (necesario para poder preseleccionar TME en vez de "el más
    // barato" -- esto es la disponibilidad en LCSC/AliExpress/TME, no tu stock físico).
    const opcionesPorLiteralId = {};
    (datosComponentes || []).forEach(row => {
        const literalId = (row['ID_Componente'] || '').trim();
        if (!literalId) return;
        const proveedor = (row['Proveedor_Preferido'] || '').trim().toUpperCase();
        if (!proveedor) return;
        const precioUnitario = parseNumeroES(row['Precio_Unitario']);
        if (precioUnitario <= 0) return; // sin dato de precio en absoluto para esta fila
        const precioPackTexto = String(row['Precio_Pack'] || '').toLowerCase();
        const sinStock = precioPackTexto.includes('sin stock') || precioPackTexto.includes('no disponible') || precioPackTexto.includes('fuera de l');
        if (!opcionesPorLiteralId[literalId]) opcionesPorLiteralId[literalId] = [];
        opcionesPorLiteralId[literalId].push({ proveedor, precioUnitario, sinStock });
    });

    // NUEVO: resuelve UN literalId (para la cantidad completa que pide el kit, sin restar stock)
    // al proveedor elegido -- preselección TME, con fallback al más barato de referencia si nadie
    // tiene stock real en el proveedor. Devuelve null si el literalId no tiene ningún precio
    // registrado en absoluto.
    function resolverComponente(idComp, cantidadNecesaria) {
        const opciones = opcionesPorLiteralId[idComp];
        if (!opciones || opciones.length === 0) return null;

        let elegida = null;
        for (const proveedor of ORDEN_PRESELECCION) {
            const opt = opciones.find(o => o.proveedor === proveedor && !o.sinStock);
            if (opt) { elegida = opt; break; }
        }
        if (!elegida) {
            // Ningún proveedor tiene esta opción disponible ahora mismo -- usamos la más barata de
            // referencia entre las que haya (como antes de este cambio), marcando "sinStock".
            elegida = opciones.reduce((a, b) => (b.precioUnitario < a.precioUnitario ? b : a));
        }

        return {
            idComp,
            proveedor: elegida.proveedor,
            precioUnitario: elegida.precioUnitario,
            coste: elegida.precioUnitario * cantidadNecesaria,
            sinStock: elegida.sinStock
        };
    }

    const filasPorKit = {};
    (datosKits || []).forEach(row => {
        const idKit = row['ID_Kit'];
        if (!idKit) return;
        if (!filasPorKit[idKit]) filasPorKit[idKit] = [];
        filasPorKit[idKit].push(row);
    });

    const resultado = {};
    Object.entries(filasPorKit).forEach(([idKit, filas]) => {
        // Agrupamos las filas del kit por "grupo" para no contar dos veces una pareja
        // componente+sustituto -- evidentemente, solo hace falta comprar uno de los dos.
        const porGrupo = {};
        filas.forEach(fila => {
            const idComp = (fila['ID_Componente'] || '').trim();
            const cantidad = parseFloat(fila['Cantidad']) || 0;
            if (!idComp || cantidad <= 0) return;
            const grupo = grupoDe(idComp);
            if (!porGrupo[grupo]) porGrupo[grupo] = [];
            porGrupo[grupo].push({ idComp, cantidad });
        });

        let totalArticulos = 0;
        let incompleto = false;
        // NUEVO: además del total, guardamos el desglose por componente (uno por grupo) para el
        // popup que aparece al pasar el ratón por el nombre del kit -- ver renderKitsAgrupados.
        const desglose = [];
        // NUEVO: coste (sin envío) acumulado por proveedor DENTRO de este kit -- base para
        // prorratear su gasto de envío proporcionalmente entre sus componentes.
        const costesPorProveedor = {};

        Object.values(porGrupo).forEach(opcionesGrupo => {
            // De entre el componente y su(s) sustituto(s), nos quedamos con la opción más barata
            // ya resuelta (proveedor preseleccionado + cantidad menos stock) -- multiplicada por
            // SU propia cantidad (que puede diferir de la de su pareja).
            let mejorOpcion = null;
            opcionesGrupo.forEach(({ idComp, cantidad }) => {
                const resuelto = resolverComponente(idComp, cantidad);
                if (!resuelto) return;
                if (!mejorOpcion || resuelto.coste < mejorOpcion.coste) {
                    mejorOpcion = { ...resuelto, cantidad };
                }
            });
            if (mejorOpcion) {
                totalArticulos += mejorOpcion.coste;
                if (mejorOpcion.sinStock) incompleto = true;
                if (mejorOpcion.proveedor && mejorOpcion.coste > 0) {
                    costesPorProveedor[mejorOpcion.proveedor] = (costesPorProveedor[mejorOpcion.proveedor] || 0) + mejorOpcion.coste;
                }
                desglose.push({
                    idComp: mejorOpcion.idComp,
                    cantidad: mejorOpcion.cantidad,
                    proveedor: mejorOpcion.proveedor,
                    precioUnitario: mejorOpcion.precioUnitario,
                    costeArticulo: mejorOpcion.coste,
                    envioProrrateado: 0, // se rellena más abajo, una vez sumado todo el kit
                    subtotal: mejorOpcion.coste,
                    sinStock: mejorOpcion.sinStock
                });
            } else {
                // Ningún literal del grupo tiene precio -- no se puede sumar. Se deja constancia
                // en el desglose (con los IDs del grupo, ya que no hay uno "elegido") en vez de
                // omitirlo en silencio, para que el popup explique por qué el total no cuadra.
                incompleto = true;
                desglose.push({
                    idComp: opcionesGrupo.map(o => o.idComp).join(' / '),
                    cantidad: opcionesGrupo[0] ? opcionesGrupo[0].cantidad : 0,
                    proveedor: null,
                    precioUnitario: null,
                    costeArticulo: null,
                    envioProrrateado: null,
                    subtotal: null,
                    sinStock: true
                });
            }
        });

        // NUEVO: gastos de envío/aduanas -- una vez por proveedor realmente usado en este kit
        // (GASTOS_ENVIO/totalGastosEnvio de pedido.js), prorrateados entre sus componentes
        // proporcionalmente a lo que cuesta cada uno dentro de ese proveedor.
        // MODIFICADO 2026-09-07 (a petición del usuario -- "ten en cuenta que cada vez se van a
        // pedir 80 packs completos, así repartirás mejor ese coste", y después "déjalo en una
        // casilla editable"): el gasto de envío/aduanas de un proveedor es fijo por PEDIDO, no por
        // kit -- si en la práctica cada pedido real agrupa "cantidadKitsPorPedido" kits de golpe,
        // cargarle el gasto de envío COMPLETO a un solo kit sobrevalora muchísimo su coste real. A
        // este kit solo le corresponde 1/cantidadKitsPorPedido parte del gasto fijo de cada
        // proveedor (parámetro editable desde la pestaña Kits, con 80 de valor por defecto) -- esa
        // parte (ya reducida) es la que se prorratea entre sus componentes como antes.
        const tamanoLote = (cantidadKitsPorPedido && cantidadKitsPorPedido > 0) ? cantidadKitsPorPedido : 80;
        let totalEnvio = 0;
        Object.entries(costesPorProveedor).forEach(([proveedor, costeProveedor]) => {
            const envioTotalProveedor = totalGastosEnvio(proveedor);
            if (envioTotalProveedor <= 0 || costeProveedor <= 0) return;
            const envioParaEsteKit = envioTotalProveedor / tamanoLote;
            totalEnvio += envioParaEsteKit;
            desglose.forEach(d => {
                if (d.proveedor === proveedor && d.costeArticulo > 0) {
                    const parte = (d.costeArticulo / costeProveedor) * envioParaEsteKit;
                    d.envioProrrateado = parte;
                    d.subtotal = d.costeArticulo + parte;
                }
            });
        });

        const total = totalArticulos + totalEnvio;

        // MODIFICADO 2026-09-07 (a petición del usuario -- el popup mostraba los componentes en
        // otro orden que la tabla desplegable del kit y era confuso): ya NO se ordena alfabéticamente
        // -- "desglose" se deja tal cual se fue rellenando en el bucle de arriba, que sigue el mismo
        // orden en que las filas aparecen en Kits_Consolas para este kit (mismo orden que usa la
        // tabla desplegable en ui.js, que tampoco reordena), así ambos coinciden siempre.
        resultado[idKit] = { total, incompleto, desglose };
    });

    return resultado;
}

// --- NUEVO (2026-09-09): PESTAÑA STOCK FÍSICO -- "Stock en camino" + "Packs que podemos
// preparar" con balanceo/reparto de componentes compartidos entre kits ---

// Reservas del simulador de balanceo: idKit -> cuántas unidades de ese kit el usuario está
// "probando" a preparar. Vive solo en memoria (se resetea al recargar la página) -- es una
// simulación visual, no escribe nada en Google Sheets (a petición expresa del usuario).
let reservasPorKit = {};

// NUEVO: datos base (sin aplicar reservas) de la última carga de la pestaña Stock Físico -- se
// guardan para recalcular solo "cuántos podemos preparar" al tocar una reserva, sin volver a
// pedir Stock_Almacen/Kits_Consolas/Sustituciones a Google Sheets cada vez (mismo patrón que
// cacheKitsBase/recalcularYRenderizarKits).
let cacheStockBase = null;

// Las hojas de Google Sheets guardan los números con coma decimal -- reutilizamos el mismo
// helper que ya usa el resto de app.js (parseNumeroES) para leer Uds_Disponibles/Stock_En_Camino.

// NUEVO: por cada "grupo" de componente (el ID_Original si tiene sustituto en la hoja
// Sustituciones, o su propio ID si no -- dos variantes intercambiables para el mismo hueco físico
// de una placa), suma el stock físico total disponible: lo que ya está en almacén
// (Uds_Disponibles) MÁS lo que está en camino (Stock_En_Camino) -- a petición del usuario, el
// stock en camino cuenta también para estos cálculos de planificación, aunque físicamente todavía
// no haya llegado.
function calcularStockPorGrupo(datosStock, sustitucionesMap) {
    const stockPorGrupo = {};
    (datosStock || []).forEach(row => {
        const id = (row['ID_Componente'] || '').trim();
        if (!id) return;
        const grupo = sustitucionesMap[id] || id;
        const disponible = parseNumeroES(row['Uds_Disponibles']);
        const enCamino = parseNumeroES(row['Stock_En_Camino']);
        stockPorGrupo[grupo] = (stockPorGrupo[grupo] || 0) + disponible + enCamino;
    });
    return stockPorGrupo;
}

// NUEVO: por cada kit, la lista de "huecos" (grupos de componente) que necesita y cuántas
// unidades de cada uno. Si un kit tiene el componente Y su sustituto como filas separadas para el
// mismo hueco (mismo grupo), nos quedamos con la cantidad mayor de las dos -- ambas representan
// el mismo hueco físico, así que basta con tener stock combinado de cualquiera de los dos.
function calcularRequisitosPorKit(datosKits, sustitucionesMap) {
    const porGrupo = {};
    (datosKits || []).forEach(row => {
        const idKit = row['ID_Kit'];
        const idComp = (row['ID_Componente'] || '').trim();
        const cantidad = parseFloat(row['Cantidad']) || 0;
        if (!idKit || !idComp || cantidad <= 0) return;
        const grupo = sustitucionesMap[idComp] || idComp;
        if (!porGrupo[idKit]) porGrupo[idKit] = {};
        if (!porGrupo[idKit][grupo] || cantidad > porGrupo[idKit][grupo].cantidad) {
            porGrupo[idKit][grupo] = { grupo, cantidad, idComp };
        }
    });
    const resultado = {};
    Object.entries(porGrupo).forEach(([idKit, gruposObj]) => {
        resultado[idKit] = Object.values(gruposObj);
    });
    return resultado;
}

// NUEVO: el corazón del simulador de balanceo. Dado cuánto stock hay de cada grupo de componente
// y cuánto ha "reservado" el usuario de cada kit (para probar repartos), calcula para CADA kit
// cuántas unidades más se podrían preparar ahora mismo TENIENDO EN CUENTA lo que los demás kits
// ya tienen reservado (no lo que ese kit tiene reservado a sí mismo, que no se resta de su propia
// disponibilidad -- así el número refleja "hasta dónde podrías subir la reserva de este kit sin
// tocar las de los demás"). Cambiar la reserva de un kit compartido hace bajar (o subir, si se
// reduce) el número de OTROS kits que usan el mismo componente -- eso es "repartir" el stock.
function calcularPreparablesPorKit(requisitosPorKit, stockPorGrupo, reservas) {
    // Cuánto se ha reservado en total (entre TODOS los kits) de cada grupo de componente.
    const reservadoPorGrupoTotal = {};
    Object.entries(requisitosPorKit).forEach(([idKit, requisitos]) => {
        const reservado = reservas[idKit] || 0;
        if (reservado <= 0) return;
        requisitos.forEach(r => {
            reservadoPorGrupoTotal[r.grupo] = (reservadoPorGrupoTotal[r.grupo] || 0) + (reservado * r.cantidad);
        });
    });

    const resultado = {};
    Object.entries(requisitosPorKit).forEach(([idKit, requisitos]) => {
        const reservaEsteKit = reservas[idKit] || 0;
        let minPreparables = Infinity;
        let limitante = null;
        // NUEVO (2026-09-09, 2ª petición): desglose por componente de ESTE kit con la reserva
        // actual -- cuántas unidades consume ("Vas a preparar" × cantidad por kit) y cuánto queda
        // del stock total de ese grupo de componente después de TODAS las reservas actuales (de
        // cualquier kit, no solo este) -- para verlo actualizarse en vivo mientras se escribe.
        const detalle = [];
        requisitos.forEach(r => {
            const stockTotal = stockPorGrupo[r.grupo] || 0;
            // Lo que otros kits (no este) ya han reservado de este mismo grupo de componente.
            const comprometidoOtros = (reservadoPorGrupoTotal[r.grupo] || 0) - (reservaEsteKit * r.cantidad);
            const disponibleParaEsteKit = Math.max(0, stockTotal - comprometidoOtros);
            const preparablesPorEsteComp = Math.floor(disponibleParaEsteKit / r.cantidad);
            if (preparablesPorEsteComp < minPreparables) {
                minPreparables = preparablesPorEsteComp;
                limitante = r.idComp;
            }
            const quedanTrasReparto = Math.max(0, stockTotal - (reservadoPorGrupoTotal[r.grupo] || 0));
            detalle.push({
                idComp: r.idComp,
                cantidadPorUnidad: r.cantidad,
                cantidadUsada: reservaEsteKit * r.cantidad,
                stockTotal,
                quedanTrasReparto
            });
        });
        if (minPreparables === Infinity) minPreparables = 0;
        resultado[idKit] = { preparables: minPreparables, limitante, reserva: reservaEsteKit, detalle };
    });
    return resultado;
}

// NUEVO: recalcula "Packs que podemos preparar" con las reservas actuales y vuelve a pintar la
// pestaña Stock Físico, reutilizando los datos ya cargados (cacheStockBase) -- se llama desde el
// listener de los inputs de reserva y del botón "Reiniciar reparto" (delegación de eventos, mismo
// patrón que recalcularYRenderizarKits).
function recalcularYRenderizarStock() {
    if (!cacheStockBase) return;
    const preparables = calcularPreparablesPorKit(cacheStockBase.requisitosPorKit, cacheStockBase.stockPorGrupo, reservasPorKit);
    const extra = {
        preparables: {
            porKit: preparables,
            nombreConsolaPorKit: cacheStockBase.nombreConsolaPorKit
        }
    };
    renderTabla('contenedor-tabla', cacheStockBase.datosStock, 'Stock_Almacen', extra);
}

// NUEVO: Orden de proveedor para que, dentro de un mismo ID_Componente, salgan siempre en el mismo orden
const ORDEN_PROVEEDOR = { LCSC: 0, ALIEXPRESS: 1, TME: 2 };

// NUEVO: Agrupa visualmente las filas de "Componentes" por ID_Componente sin tocar la hoja de
// Google Sheets (el orden real de las filas en Sheets no cambia, solo cómo se pintan aquí).
function ordenarComponentesPorId(datos) {
    return [...datos].sort((a, b) => {
        const idA = String(a['ID_Componente'] || '');
        const idB = String(b['ID_Componente'] || '');
        const cmpId = idA.localeCompare(idB, 'es', { sensitivity: 'base' });
        if (cmpId !== 0) return cmpId;

        const provA = ORDEN_PROVEEDOR[String(a['Proveedor_Preferido'] || '').toUpperCase()] ?? 99;
        const provB = ORDEN_PROVEEDOR[String(b['Proveedor_Preferido'] || '').toUpperCase()] ?? 99;
        return provA - provB;
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

    // NUEVO: Agrupamos las filas del mismo componente (p.ej. LCSC + TME) de forma consecutiva.
    // Se hace DESPUÉS de calcularKitsPorComponente porque esa función reordena por Kits_que_lo_usan
    // y descolocaría de nuevo las filas de un mismo ID_Componente.
    if (nombrePestana === 'Componentes') {
        datos = ordenarComponentesPorId(datos);
    }

    // NUEVO: en la pestaña Kits calculamos también el precio total estimado de cada uno (ver
    // calcularPreciosPorKit) -- necesita Componentes (precios) y Sustituciones (para no contar dos
    // veces un componente y su sustituto). NO usa Stock_Almacen -- el precio de Kits es un valor
    // orientativo del kit completo, no descuenta lo que ya tengas comprado (ver comentario en
    // calcularPreciosPorKit). Guardamos los datos base en cacheKitsBase para poder recalcular solo
    // el precio (p.ej. al cambiar la casilla "Kits por pedido") sin volver a pedir las hojas.
    let extra;
    if (nombrePestana === 'Kits_Consolas') {
        const datosComponentes = await obtenerDatos('Componentes');
        let sustituciones = [];
        if (ENV.SHEETS['Sustituciones']) {
            sustituciones = await obtenerDatos('Sustituciones');
        }
        cacheKitsBase = { datos, datosComponentes, sustituciones };
        const tamanoLote = obtenerTamanoLoteGuardado();
        extra = { preciosPorKit: calcularPreciosPorKit(datos, datosComponentes, sustituciones, tamanoLote), tamanoLote };
    }

    // NUEVO (2026-09-09): en la pestaña Stock Físico calculamos también "Packs que podemos
    // preparar" -- necesita Kits_Consolas (qué componentes y cuántos usa cada kit) y Sustituciones
    // (para tratar un componente y su sustituto como el mismo hueco físico). Las reservas del
    // simulador de balanceo (reservasPorKit) NO se resetean aquí a propósito: si el usuario estaba
    // repartiendo stock entre kits y la pestaña se recarga con los mismos kits, el reparto sigue
    // donde lo dejó.
    if (nombrePestana === 'Stock_Almacen') {
        const datosKits = await obtenerDatos('Kits_Consolas');
        let sustituciones = [];
        if (ENV.SHEETS['Sustituciones']) {
            sustituciones = await obtenerDatos('Sustituciones');
        }
        const sustitucionesMap = {};
        sustituciones.forEach(row => {
            const idNuevo = (row['ID_Nuevo'] || '').trim();
            const idOriginal = (row['ID_Original'] || '').trim();
            if (idNuevo && idOriginal) sustitucionesMap[idNuevo] = idOriginal;
        });

        const requisitosPorKit = calcularRequisitosPorKit(datosKits, sustitucionesMap);
        const stockPorGrupo = calcularStockPorGrupo(datos, sustitucionesMap);
        const nombreConsolaPorKit = {};
        (datosKits || []).forEach(row => {
            if (row['ID_Kit'] && !nombreConsolaPorKit[row['ID_Kit']]) {
                nombreConsolaPorKit[row['ID_Kit']] = row['Consola'] || '';
            }
        });

        // Descarta reservas de kits que ya no existen en la última carga (p.ej. si se borró un kit)
        Object.keys(reservasPorKit).forEach(idKit => {
            if (!requisitosPorKit[idKit]) delete reservasPorKit[idKit];
        });

        cacheStockBase = { datosStock: datos, requisitosPorKit, stockPorGrupo, nombreConsolaPorKit };
        extra = {
            preparables: {
                porKit: calcularPreparablesPorKit(requisitosPorKit, stockPorGrupo, reservasPorKit),
                nombreConsolaPorKit
            }
        };
    }

    renderTabla('contenedor-tabla', datos, nombrePestana, extra);

    if (tituloVista) tituloVista.innerText = `${nombrePestana} (${datos.length} registros)`;
}

// Cuando la web esté lista
document.addEventListener('DOMContentLoaded', () => {
    console.log(`${ENV.APP_NAME} iniciado`);
    
    // Cargar la pestaña por defecto
    cargarVista(vistaActual);
    
    // Inicializar el módulo de pedidos para el selector de kits y botones
    inicializarModuloPedidos();

    // NUEVO: Inicializar el generador de pedido (selección de kits + cantidades)
    inicializarModuloPedido();
    
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

    // NUEVO: casilla "Kits por pedido" (pestaña Kits, ver ui.js) -- se regenera cada vez que se
    // repinta la tabla, así que se escucha por delegación en document (mismo patrón que el botón
    // "➕ Añadir Stock" en pedidos.js). 'change' (no 'input') para no repintar mientras se está
    // escribiendo -- repintar en cada tecla destruiría la propia casilla y le haría perder el foco.
    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'kits-tamano-lote') {
            const valor = parseInt(e.target.value, 10);
            if (!isNaN(valor) && valor > 0) {
                recalcularYRenderizarKits(valor);
            }
        }
    });

    // NUEVO (2026-09-09): input "Vas a preparar" de cada fila del simulador "Packs que podemos
    // preparar" (pestaña Stock Físico, ver ui.js) -- se regenera cada vez que se repinta la
    // pestaña, así que se escucha por delegación (mismo patrón que "kits-tamano-lote"). Aquí sí se
    // usa 'input' (no 'change', a diferencia de "kits-tamano-lote") para que el reparto entre kits
    // reaccione al momento mientras se escribe -- pero eso significa reconstruir la tabla entera en
    // cada tecla, lo que destruiría y recrearía la propia casilla que se está editando y le haría
    // perder el foco a media escritura (el mismo problema que "kits-tamano-lote" evita usando
    // 'change'). Para no perder el foco: se guarda qué kit y qué posición del cursor tenía el input
    // antes de repintar, y se restaura en el input nuevo (mismo data-kit) justo después.
    document.addEventListener('input', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('packs-input-reserva')) {
            const idKit = e.target.getAttribute('data-kit');
            if (!idKit) return;
            const valor = parseInt(e.target.value, 10);
            reservasPorKit[idKit] = (!isNaN(valor) && valor > 0) ? valor : 0;

            const cursorPos = e.target.selectionStart;
            recalcularYRenderizarStock();

            const nuevoInput = document.querySelector(`.packs-input-reserva[data-kit="${CSS.escape(idKit)}"]`);
            if (nuevoInput) {
                nuevoInput.focus();
                try {
                    // type="number" no soporta setSelectionRange en algunos navegadores (lanza
                    // InvalidStateError) -- si falla, el foco ya se restauró igualmente, solo se
                    // pierde la posición exacta del cursor dentro del número.
                    if (cursorPos !== null && typeof nuevoInput.setSelectionRange === 'function') {
                        nuevoInput.setSelectionRange(cursorPos, cursorPos);
                    }
                } catch (err) { /* ver comentario arriba -- no es un fallo real */ }
            }
        }
    });

    // NUEVO: botón "↺ Reiniciar reparto" del simulador -- borra todas las reservas de prueba y
    // vuelve a mostrar cuántos packs se podrían preparar de cada kit de forma independiente.
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-reset-reparto')) {
            reservasPorKit = {};
            recalcularYRenderizarStock();
        }
    });
});
