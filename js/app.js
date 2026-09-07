// js/app.js
import ENV from './config.js';
import { obtenerDatos } from './api.js';
import { renderTabla, mostrarMensaje } from './ui.js';
import { inicializarModuloPedidos } from './pedidos.js';
import { inicializarModuloPedido, ORDEN_PRESELECCION, totalGastosEnvio } from './pedido.js'; // NUEVO: generador de pedido

// Variable para saber qué pestaña estamos viendo
let vistaActual = 'Componentes';

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
//   1. Se resta el stock físico que ya haya en el almacén (Stock_Almacen) -- si cubre toda la
//      necesidad, ese componente sale gratis en el kit (no hace falta comprarlo), igual que
//      "Cantidad a pedir" en el generador de pedido.
//   2. El proveedor se elige con la MISMA preselección que el generador de pedido (ORDEN_PRESELECCION,
//      TME primero) en vez de "el más barato" -- solo se cae a LCSC/AliExpress si TME no tiene esa
//      opción disponible ahora mismo. Si ningún proveedor tiene stock real, se usa la opción de
//      referencia más barata (como antes) y el kit se marca "incompleto".
//   3. Los gastos de envío/aduanas (GASTOS_ENVIO, ver pedido.js) de cada proveedor realmente usado
//      en el kit se suman UNA vez por proveedor y se PRORRATEAN entre sus componentes de ese kit,
//      proporcionalmente a lo que cuesta cada uno (el componente más caro de ese proveedor absorbe
//      más parte del envío) -- así el total del kit refleja el coste real aproximado, no solo el
//      precio de los componentes sueltos.
function calcularPreciosPorKit(datosKits, datosComponentes, sustituciones, stockPorId) {
    const sustitucionesMap = {}; // ID_Nuevo -> ID_Original
    (sustituciones || []).forEach(row => {
        const idNuevo = (row['ID_Nuevo'] || '').trim();
        const idOriginal = (row['ID_Original'] || '').trim();
        if (idNuevo && idOriginal) sustitucionesMap[idNuevo] = idOriginal;
    });
    const grupoDe = (id) => sustitucionesMap[id] || id;

    // Por cada ID_Componente literal, todas sus opciones de precio (una por proveedor que lo
    // tenga registrado en Componentes), con su proveedor y si esa opción concreta está sin stock
    // ahora mismo (necesario para poder preseleccionar TME en vez de "el más barato").
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

    // NUEVO: resuelve UN literalId a la cantidad que realmente hace falta comprar (restando el
    // stock físico que ya se tenga) y al proveedor elegido (preselección TME, con fallback al más
    // barato de referencia si nadie tiene stock real). Devuelve null si el literalId no tiene
    // ningún precio registrado en absoluto.
    function resolverComponente(idComp, cantidadNecesaria) {
        const stockDisponible = (stockPorId && stockPorId[idComp]) || 0;
        const cantidadAPedir = Math.max(0, cantidadNecesaria - stockDisponible);

        if (cantidadAPedir <= 0) {
            return { idComp, cantidadAPedir: 0, proveedor: null, precioUnitario: 0, coste: 0, sinStock: false, cubiertoStock: true };
        }

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
            cantidadAPedir,
            proveedor: elegida.proveedor,
            precioUnitario: elegida.precioUnitario,
            coste: elegida.precioUnitario * cantidadAPedir,
            sinStock: elegida.sinStock,
            cubiertoStock: false
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
                    cantidadAPedir: mejorOpcion.cantidadAPedir,
                    proveedor: mejorOpcion.proveedor,
                    precioUnitario: mejorOpcion.precioUnitario,
                    costeArticulo: mejorOpcion.coste,
                    envioProrrateado: 0, // se rellena más abajo, una vez sumado todo el kit
                    subtotal: mejorOpcion.coste,
                    sinStock: mejorOpcion.sinStock,
                    cubiertoStock: mejorOpcion.cubiertoStock
                });
            } else {
                // Ningún literal del grupo tiene precio -- no se puede sumar. Se deja constancia
                // en el desglose (con los IDs del grupo, ya que no hay uno "elegido") en vez de
                // omitirlo en silencio, para que el popup explique por qué el total no cuadra.
                incompleto = true;
                desglose.push({
                    idComp: opcionesGrupo.map(o => o.idComp).join(' / '),
                    cantidad: opcionesGrupo[0] ? opcionesGrupo[0].cantidad : 0,
                    cantidadAPedir: null,
                    proveedor: null,
                    precioUnitario: null,
                    costeArticulo: null,
                    envioProrrateado: null,
                    subtotal: null,
                    sinStock: true,
                    cubiertoStock: false
                });
            }
        });

        // NUEVO: gastos de envío/aduanas -- una vez por proveedor realmente usado en este kit
        // (GASTOS_ENVIO/totalGastosEnvio de pedido.js), prorrateados entre sus componentes
        // proporcionalmente a lo que cuesta cada uno dentro de ese proveedor.
        let totalEnvio = 0;
        Object.entries(costesPorProveedor).forEach(([proveedor, costeProveedor]) => {
            const envio = totalGastosEnvio(proveedor);
            if (envio <= 0 || costeProveedor <= 0) return;
            totalEnvio += envio;
            desglose.forEach(d => {
                if (d.proveedor === proveedor && d.costeArticulo > 0) {
                    const parte = (d.costeArticulo / costeProveedor) * envio;
                    d.envioProrrateado = parte;
                    d.subtotal = d.costeArticulo + parte;
                }
            });
        });

        const total = totalArticulos + totalEnvio;

        desglose.sort((a, b) => a.idComp.localeCompare(b.idComp, 'es', { sensitivity: 'base' }));
        resultado[idKit] = { total, incompleto, desglose };
    });

    return resultado;
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
    // calcularPreciosPorKit) -- necesita Componentes (precios), Sustituciones (para no contar
    // dos veces un componente y su sustituto) y Stock_Almacen (para restar el stock físico ya
    // disponible antes de calcular qué haría falta comprar de verdad, igual que en pedido.js).
    let extra;
    if (nombrePestana === 'Kits_Consolas') {
        const datosComponentes = await obtenerDatos('Componentes');
        let sustituciones = [];
        if (ENV.SHEETS['Sustituciones']) {
            sustituciones = await obtenerDatos('Sustituciones');
        }
        const datosStock = await obtenerDatos('Stock_Almacen');
        const stockPorId = {};
        datosStock.forEach(row => {
            const id = (row['ID_Componente'] || '').trim();
            if (!id) return;
            stockPorId[id] = (stockPorId[id] || 0) + parseNumeroES(row['Uds_Disponibles']);
        });
        extra = { preciosPorKit: calcularPreciosPorKit(datos, datosComponentes, sustituciones, stockPorId) };
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
});
