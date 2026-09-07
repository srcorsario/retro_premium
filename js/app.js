// js/app.js
import ENV from './config.js';
import { obtenerDatos } from './api.js';
import { renderTabla, mostrarMensaje } from './ui.js';
import { inicializarModuloPedidos } from './pedidos.js';
import { inicializarModuloPedido } from './pedido.js'; // NUEVO: generador de pedido

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
function calcularPreciosPorKit(datosKits, datosComponentes, sustituciones) {
    const sustitucionesMap = {}; // ID_Nuevo -> ID_Original
    (sustituciones || []).forEach(row => {
        const idNuevo = (row['ID_Nuevo'] || '').trim();
        const idOriginal = (row['ID_Original'] || '').trim();
        if (idNuevo && idOriginal) sustitucionesMap[idNuevo] = idOriginal;
    });
    const grupoDe = (id) => sustitucionesMap[id] || id;

    // Por cada ID_Componente literal, todas sus opciones de precio (una por proveedor que lo
    // tenga registrado en Componentes), con si esa opción concreta está sin stock ahora mismo.
    const opcionesPorLiteralId = {};
    (datosComponentes || []).forEach(row => {
        const literalId = (row['ID_Componente'] || '').trim();
        if (!literalId) return;
        const precioUnitario = parseNumeroES(row['Precio_Unitario']);
        if (precioUnitario <= 0) return; // sin dato de precio en absoluto para esta fila
        const precioPackTexto = String(row['Precio_Pack'] || '').toLowerCase();
        const sinStock = precioPackTexto.includes('sin stock') || precioPackTexto.includes('no disponible') || precioPackTexto.includes('fuera de l');
        if (!opcionesPorLiteralId[literalId]) opcionesPorLiteralId[literalId] = [];
        opcionesPorLiteralId[literalId].push({ precioUnitario, sinStock });
    });

    // Mejor precio/ud para un literalId: prioriza opciones CON stock; solo si NINGUNA de sus
    // opciones tiene stock ahora mismo, cae al precio de referencia más barato entre las que hay.
    function mejorPrecioLiteral(literalId) {
        const opciones = opcionesPorLiteralId[literalId];
        if (!opciones || opciones.length === 0) return null;
        const conStock = opciones.filter(o => !o.sinStock);
        const candidatas = conStock.length > 0 ? conStock : opciones;
        const mejor = candidatas.reduce((a, b) => (b.precioUnitario < a.precioUnitario ? b : a));
        return { precioUnitario: mejor.precioUnitario, sinStock: conStock.length === 0 };
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

        let total = 0;
        let incompleto = false;
        // NUEVO: además del total, guardamos el desglose por componente (uno por grupo) para el
        // popup que aparece al pasar el ratón por el nombre del kit -- ver renderKitsAgrupados.
        const desglose = [];
        Object.values(porGrupo).forEach(opcionesGrupo => {
            // De entre el componente y su(s) sustituto(s), nos quedamos con la opción más barata
            // -- ya multiplicada por SU propia cantidad (que puede diferir de la de su pareja).
            let mejorOpcion = null;
            opcionesGrupo.forEach(({ idComp, cantidad }) => {
                const precio = mejorPrecioLiteral(idComp);
                if (!precio) return;
                const coste = precio.precioUnitario * cantidad;
                if (!mejorOpcion || coste < mejorOpcion.coste) {
                    mejorOpcion = { idComp, cantidad, precioUnitario: precio.precioUnitario, coste, sinStock: precio.sinStock };
                }
            });
            if (mejorOpcion) {
                total += mejorOpcion.coste;
                if (mejorOpcion.sinStock) incompleto = true;
                desglose.push({
                    idComp: mejorOpcion.idComp,
                    cantidad: mejorOpcion.cantidad,
                    precioUnitario: mejorOpcion.precioUnitario,
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
                    precioUnitario: null,
                    subtotal: null,
                    sinStock: true
                });
            }
        });

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
    // calcularPreciosPorKit) -- necesita Componentes (precios) y Sustituciones (para no contar
    // dos veces un componente y su sustituto).
    let extra;
    if (nombrePestana === 'Kits_Consolas') {
        const datosComponentes = await obtenerDatos('Componentes');
        let sustituciones = [];
        if (ENV.SHEETS['Sustituciones']) {
            sustituciones = await obtenerDatos('Sustituciones');
        }
        extra = { preciosPorKit: calcularPreciosPorKit(datos, datosComponentes, sustituciones) };
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
