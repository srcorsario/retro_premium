/**
 * =====================================================
 * SISTEMA INTERNO DE GOOGLE SHEETS + API WEB
 * =====================================================
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 Sincro Componentes')
    // MODIFICADO: menú simplificado a un único botón que hace todo (LCSC + TME + las 3
    // columnas derivadas de Kits_Consolas), para no tener que ir sincronizando sitio a sitio.
    // Las opciones de diagnóstico/reparación de un solo componente siguen existiendo en el
    // código (por si algún día hacen falta), pero ya no ensucian este menú.
    .addItem('🔄 Sincronizar Todo (LCSC + TME + Kits)', 'sincronizarTodoUI')
    .addSeparator()
    .addItem('📱 Añadir/Actualizar Manual AliExpress (Fila Seleccionada)', 'abrirAsistenteAliExpress')
    .addItem('📦 Añadir/Actualizar Manual TME (Fila Seleccionada)', 'abrirAsistenteTME') // respaldo si el automático falla
    .addSeparator()
    .addItem('🔁 Abrir Hoja Sustituciones', 'abrirHojaSustitucionesUI')
    .addItem('🔑 Otorgar Permisos al Script', 'autorizarScript')
    .addToUi();
}

/**
 * NUEVO: Lógica pura compartida por el botón de menú "Sincronizar Todo" (Sheets) y por la
 * acción web 'sync_todo' (llamada desde la web con el nuevo botón único) — encadena, en este
 * orden, la sincronización completa de LCSC (sincronizarTodoLCSC), la de TME (sincronizarTodoTME)
 * y las tres columnas derivadas de Kits_Consolas que dependen de esos datos (Kits_que_lo_usan,
 * Proveedores_Disponibles, Uds_Pack - Precio_Unid). Antes había que pulsar hasta 7 botones
 * distintos (tanto en Sheets como en la web) para dejarlo todo al día; ahora es uno solo en
 * cada sitio. Si algún paso falla no corta los demás: sigue con el resto y al final devuelve
 * un resumen con lo que salió bien y lo que dio error.
 * NO usa SpreadsheetApp.getUi() aquí (eso falla fuera del menú de Sheets, p.ej. desde la Web
 * App) — el toast sí es seguro en cualquier contexto, así que cada llamador decide si lo pide.
 */
function ejecutarSincronizacionCompleta(mostrarToast) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mensajes = [];
  const errores = [];

  const pasos = [
    { nombre: 'LCSC', toast: 'Sincronizando LCSC...', fn: sincronizarTodoLCSC },
    { nombre: 'TME', toast: 'Sincronizando TME...', fn: sincronizarTodoTME },
    { nombre: 'Kits_que_lo_usan', toast: 'Actualizando columna Kits...', fn: actualizarColumnaKitsUsados },
    { nombre: 'Proveedores_Disponibles', toast: 'Actualizando columna Proveedores...', fn: actualizarColumnaProveedoresKits },
    { nombre: 'Uds_Pack - Precio_Unid', toast: 'Actualizando columna Pack/Precio...', fn: actualizarColumnaPackPrecioKits }
  ];

  pasos.forEach(function(paso) {
    if (mostrarToast) ss.toast(paso.toast, '🔄 Sincronizar Todo', 20);
    try {
      mensajes.push('✅ ' + paso.fn());
    } catch (err) {
      errores.push('❌ ' + paso.nombre + ': ' + err.message);
    }
  });

  let resumen = mensajes.join('\n');
  if (errores.length > 0) {
    resumen += (resumen ? '\n\n' : '') + 'Con avisos:\n' + errores.join('\n');
  }
  return resumen;
}

// Wrapper para el botón de menú de Sheets: sí puede usar getUi() porque corre con UI abierta.
function sincronizarTodoUI() {
  const resumen = ejecutarSincronizacionCompleta(true);
  SpreadsheetApp.getUi().alert('Sincronización completa:\n\n' + resumen);
}

function autorizarScript() {
  SpreadsheetApp.getUi().alert("Permisos activos y verificados correctamente.");
}

/**
 * ASISTENTE ALIEXPRESS (Ventana Flotante)
 */
function abrirAsistenteAliExpress() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");

  if (ss.getActiveSheet().getName() !== "Componentes") {
    SpreadsheetApp.getUi().alert("Debes estar en la pestaña 'Componentes' y seleccionar la fila deseada.");
    return;
  }

  const filaActual = sheetComp.getActiveCell().getRow();
  if (filaActual < 2) {
    SpreadsheetApp.getUi().alert("Selecciona una fila válida de componente.");
    return;
  }

  const idComponente = sheetComp.getRange(filaActual, 2).getValue();  // Columna B
  const urlAliExpress = sheetComp.getRange(filaActual, 11).getValue(); // Columna K

  if (!idComponente) {
    SpreadsheetApp.getUi().alert("La fila seleccionada no tiene un ID_Componente en la columna B.");
    return;
  }

  const template = HtmlService.createTemplateFromFile('PopUpAliExpress');
  template.idComponente = String(idComponente);
  template.urlAliExpress = String(urlAliExpress || '');

  const htmlOutput = template.evaluate()
      .setWidth(450)
      .setHeight(480);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, `Asistente AliExpress: ${idComponente}`);
}

/**
 * NUEVO: ASISTENTE TME (Ventana Flotante)
 * Mismo patrón que el de AliExpress. Reutiliza la columna K (compartida entre
 * LCSC/AliExpress/TME) como enlace de producto a mostrar en el popup.
 */
function abrirAsistenteTME() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");

  if (ss.getActiveSheet().getName() !== "Componentes") {
    SpreadsheetApp.getUi().alert("Debes estar en la pestaña 'Componentes' y seleccionar la fila deseada.");
    return;
  }

  const filaActual = sheetComp.getActiveCell().getRow();
  if (filaActual < 2) {
    SpreadsheetApp.getUi().alert("Selecciona una fila válida de componente.");
    return;
  }

  const idComponente = sheetComp.getRange(filaActual, 2).getValue();  // Columna B
  const urlProducto = sheetComp.getRange(filaActual, 11).getValue(); // Columna K (compartida)

  if (!idComponente) {
    SpreadsheetApp.getUi().alert("La fila seleccionada no tiene un ID_Componente en la columna B.");
    return;
  }

  // NUEVO (fix): el asistente no miraba si ese ID_Componente ya tenía tramos guardados en
  // Variantes_TME -- siempre arrancaba con 6 filas vacías, así que si lo reabrías para revisar o
  // corregir un componente que ya tenías, no veías lo que ya había (y al guardar lo sustituías
  // "a ciegas"). Ahora se leen sus filas existentes y se pasan a la plantilla para precargarlas.
  const sheetTME = ss.getSheetByName("Variantes_TME");
  let tramosExistentes = [];
  let stockExistente = 100;
  if (sheetTME) {
    const datosTME = sheetTME.getDataRange().getValues();
    datosTME.shift(); // cabecera
    const filasDelComponente = datosTME.filter(function(row) { return String(row[0]) === String(idComponente); });
    if (filasDelComponente.length > 0) {
      tramosExistentes = filasDelComponente.map(function(row) {
        return { uds: Number(row[1]) || 0, precio: Number(row[2]) || 0 };
      });
      stockExistente = Number(filasDelComponente[0][3]) || 0;
    }
  }

  const template = HtmlService.createTemplateFromFile('PopUpTME');
  template.idComponente = String(idComponente);
  template.urlProducto = String(urlProducto || '');
  template.tramosExistentesJSON = JSON.stringify(tramosExistentes);
  template.stockExistente = stockExistente;

  const htmlOutput = template.evaluate()
      .setWidth(450)
      .setHeight(480);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, `Asistente TME: ${idComponente}`);
}

/**
 * MODIFICADO: ahora acepta un 5º parámetro opcional "nombreHoja" para poder
 * reutilizar la misma lógica de guardado con distintas pestañas de variantes
 * (Variantes_AliExpress por defecto, para no romper el popup ya existente
 * que solo pasa 4 argumentos; Variantes_TME cuando se llama vía guardarVarianteManualTME).
 */
function guardarVarianteManual(idComponente, udsPack, precioPack, stockPacks, nombreHoja) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hojaDestino = nombreHoja || "Variantes_AliExpress";
    const sheetVar = ss.getSheetByName(hojaDestino);

    if (!sheetVar) throw new Error("No se encuentra la pestaña '" + hojaDestino + "'.");
    if (!idComponente) throw new Error("ID de componente no válido.");

    const datosColA = sheetVar.getRange("A:A").getValues();
    let primeraFilaVacia = 2;
    while (primeraFilaVacia <= datosColA.length && datosColA[primeraFilaVacia - 1][0] !== "") {
      primeraFilaVacia++;
    }

    const datosFila = [
      String(idComponente),
      Number(udsPack),
      Number(precioPack),
      Number(stockPacks || 0)
    ];

    sheetVar.getRange(primeraFilaVacia, 1, 1, 4).setValues([datosFila]);
    ordenarVariantes(sheetVar);

    return `¡Guardado y ordenado para ${idComponente}!`;
  } catch (err) {
    throw new Error("Error al guardar: " + err.message);
  }
}

/**
 * NUEVO: guarda una entrada de stock físico manual desde la web (acción 'update_stock_manual',
 * modal "➕ Añadir Stock" en la pestaña Stock Físico) -- para no tener que abrir Google Sheets a
 * mano cada vez que llega material nuevo. Si el componente YA tiene una fila en Stock_Almacen, se
 * SUMA la cantidad indicada a lo que ya había (no se sobreescribe -- "añadir stock" funciona como
 * cabría esperar: si tenías 20 y llegan 50 más, quedan 70). Si el componente todavía no tiene
 * ninguna fila en Stock_Almacen, se crea una nueva con esa cantidad como stock inicial.
 * No asume cuántas columnas tiene la hoja -- localiza ID_Componente y Uds_Disponibles por
 * cabecera, y deja el resto de columnas de una fila nueva en blanco (p.ej. Stock_Minimo_Alerta se
 * puede rellenar luego a mano en Sheets si se quiere alerta de mínimos para ese componente).
 */
function guardarStockManual(idComponente, cantidad) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Stock_Almacen");
    if (!sheet) throw new Error("No se encuentra la pestaña 'Stock_Almacen'.");
    if (!idComponente) throw new Error("ID de componente no válido.");

    const cantidadNum = Number(cantidad);
    if (isNaN(cantidadNum) || cantidadNum <= 0) throw new Error("La cantidad debe ser un número mayor que 0.");

    const dataRange = sheet.getDataRange().getValues();
    const headers = dataRange.shift().map(function(h) { return String(h).trim(); });
    const idColIndex = headers.indexOf('ID_Componente');
    const udsColIndex = headers.indexOf('Uds_Disponibles');
    if (idColIndex === -1 || udsColIndex === -1) {
      throw new Error("Faltan columnas 'ID_Componente' o 'Uds_Disponibles' en Stock_Almacen.");
    }

    for (let i = 0; i < dataRange.length; i++) {
      if (String(dataRange[i][idColIndex]).trim() === String(idComponente).trim()) {
        const actual = Number(dataRange[i][udsColIndex]) || 0;
        const nuevoValor = actual + cantidadNum;
        sheet.getRange(i + 2, udsColIndex + 1).setValue(nuevoValor);
        return `Stock actualizado: ${idComponente} ahora tiene ${nuevoValor} uds (antes ${actual}, +${cantidadNum}).`;
      }
    }

    // No existía ninguna fila de Stock_Almacen para este componente -- se crea una nueva.
    const filaNueva = new Array(headers.length).fill('');
    filaNueva[idColIndex] = String(idComponente);
    filaNueva[udsColIndex] = cantidadNum;
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, filaNueva.length).setValues([filaNueva]);
    return `Nueva fila de stock creada para ${idComponente}: ${cantidadNum} uds.`;
  } catch (err) {
    throw new Error("Error al guardar stock: " + err.message);
  }
}

/**
 * NUEVO (2026-09-09): localiza el índice (1-based, como espera Range) de una columna por
 * cabecera en la pestaña Stock_Almacen, CREÁNDOLA si todavía no existe -- así no hace falta que
 * el usuario añada la columna "Stock_En_Camino" a mano en Google Sheets, se crea sola la primera
 * vez que se usa. Devuelve el índice 1-based y dentro del array `headers` (que se pasa por
 * referencia y se actualiza in-place) para que el resto de la función que llame a esto no tenga
 * que releer la hoja.
 */
function obtenerOCrearColumnaPorCabecera(sheet, headers, nombreColumna) {
  let idx = headers.indexOf(nombreColumna);
  if (idx !== -1) return idx; // 0-based dentro de `headers`, ya existía

  const nuevaColIndex1based = headers.length + 1;
  sheet.getRange(1, nuevaColIndex1based).setValue(nombreColumna);
  headers.push(nombreColumna);
  return headers.length - 1; // 0-based, recién añadida
}

/**
 * NUEVO (2026-09-09): guarda una entrada de "Stock en camino" (pedido ya hecho a un proveedor
 * pero que todavía no ha llegado físicamente) -- acción 'update_stock_en_camino', modal
 * "🚚 Añadir Stock en Camino" en la pestaña Stock Físico. Mismo patrón que guardarStockManual
 * (SUMA a lo que ya hubiera en camino, o crea la fila si el componente no tenía ninguna en
 * Stock_Almacen todavía), pero escribe en la columna "Stock_En_Camino" en vez de
 * "Uds_Disponibles" -- así ese material no cuenta como físicamente disponible para montar kits
 * hasta que se confirme su llegada con recibirStockEnCamino(). La columna se crea sola la
 * primera vez (ver obtenerOCrearColumnaPorCabecera) si la hoja todavía no la tiene.
 */
function guardarStockEnCamino(idComponente, cantidad) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Stock_Almacen");
    if (!sheet) throw new Error("No se encuentra la pestaña 'Stock_Almacen'.");
    if (!idComponente) throw new Error("ID de componente no válido.");

    const cantidadNum = Number(cantidad);
    if (isNaN(cantidadNum) || cantidadNum <= 0) throw new Error("La cantidad debe ser un número mayor que 0.");

    const dataRange = sheet.getDataRange().getValues();
    const headers = dataRange.shift().map(function(h) { return String(h).trim(); });
    const idColIndex = headers.indexOf('ID_Componente');
    if (idColIndex === -1) throw new Error("Falta la columna 'ID_Componente' en Stock_Almacen.");

    const camColIndex = obtenerOCrearColumnaPorCabecera(sheet, headers, 'Stock_En_Camino');

    for (let i = 0; i < dataRange.length; i++) {
      if (String(dataRange[i][idColIndex]).trim() === String(idComponente).trim()) {
        const actual = Number(dataRange[i][camColIndex]) || 0;
        const nuevoValor = actual + cantidadNum;
        sheet.getRange(i + 2, camColIndex + 1).setValue(nuevoValor);
        return `Stock en camino actualizado: ${idComponente} ahora tiene ${nuevoValor} uds en camino (antes ${actual}, +${cantidadNum}).`;
      }
    }

    // No existía ninguna fila de Stock_Almacen para este componente -- se crea una nueva, con
    // Uds_Disponibles en 0 (nada físico todavía) y la cantidad indicada en Stock_En_Camino.
    const filaNueva = new Array(headers.length).fill('');
    filaNueva[idColIndex] = String(idComponente);
    const udsColIndex = headers.indexOf('Uds_Disponibles');
    if (udsColIndex !== -1) filaNueva[udsColIndex] = 0;
    filaNueva[camColIndex] = cantidadNum;
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, filaNueva.length).setValues([filaNueva]);
    return `Nueva fila de stock creada para ${idComponente}: ${cantidadNum} uds en camino.`;
  } catch (err) {
    throw new Error("Error al guardar stock en camino: " + err.message);
  }
}

/**
 * NUEVO (2026-09-09): traspasa unidades de "Stock_En_Camino" a "Uds_Disponibles" cuando llega el
 * material -- acción 'recibir_stock_en_camino', botón "✅ Recibir" por fila en la pestaña Stock
 * Físico. Traspaso PARCIAL editable (a petición expresa del usuario, por si llega solo parte de
 * un pedido): se indica cuántas unidades han llegado realmente y solo esas se mueven; el resto
 * se queda en "Stock_En_Camino" para recibirlo más adelante. Valida que no se reciban más
 * unidades de las que había en camino (protege contra doble-clic / carreras y errores de
 * escritura manual de la cantidad).
 */
function recibirStockEnCamino(idComponente, cantidad) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Stock_Almacen");
    if (!sheet) throw new Error("No se encuentra la pestaña 'Stock_Almacen'.");
    if (!idComponente) throw new Error("ID de componente no válido.");

    const cantidadNum = Number(cantidad);
    if (isNaN(cantidadNum) || cantidadNum <= 0) throw new Error("La cantidad recibida debe ser un número mayor que 0.");

    const dataRange = sheet.getDataRange().getValues();
    const headers = dataRange.shift().map(function(h) { return String(h).trim(); });
    const idColIndex = headers.indexOf('ID_Componente');
    const udsColIndex = headers.indexOf('Uds_Disponibles');
    const camColIndex = headers.indexOf('Stock_En_Camino');
    if (idColIndex === -1 || udsColIndex === -1) {
      throw new Error("Faltan columnas 'ID_Componente' o 'Uds_Disponibles' en Stock_Almacen.");
    }
    if (camColIndex === -1) throw new Error(`${idComponente} no tiene ninguna unidad en camino registrada.`);

    for (let i = 0; i < dataRange.length; i++) {
      if (String(dataRange[i][idColIndex]).trim() === String(idComponente).trim()) {
        const enCaminoActual = Number(dataRange[i][camColIndex]) || 0;
        if (cantidadNum > enCaminoActual) {
          throw new Error(`Solo hay ${enCaminoActual} uds en camino de ${idComponente}, no se pueden recibir ${cantidadNum}.`);
        }
        const disponibleActual = Number(dataRange[i][udsColIndex]) || 0;
        const nuevoEnCamino = enCaminoActual - cantidadNum;
        const nuevoDisponible = disponibleActual + cantidadNum;
        sheet.getRange(i + 2, camColIndex + 1).setValue(nuevoEnCamino);
        sheet.getRange(i + 2, udsColIndex + 1).setValue(nuevoDisponible);
        return `Recibido: ${idComponente} +${cantidadNum} uds a almacén (ahora ${nuevoDisponible} disponibles, quedan ${nuevoEnCamino} en camino).`;
      }
    }

    throw new Error(`${idComponente} no tiene ninguna fila en Stock_Almacen.`);
  } catch (err) {
    throw new Error("Error al recibir stock: " + err.message);
  }
}

/**
 * NUEVO (2026-09-10): redondeo genérico a N decimales devolviendo un Number (no un string), para
 * escribir valores limpios en las celdas de Sheets. Sigue la convención del proyecto: precios por
 * unidad a 4 decimales, importes totales a 2 decimales.
 */
function redondear(numero, decimales) {
  const factor = Math.pow(10, decimales);
  return Math.round((Number(numero) + Number.EPSILON) * factor) / factor;
}

/**
 * NUEVO (2026-09-10): devuelve la pestaña `nombre`, creándola con la fila de cabeceras `headers`
 * si todavía no existe -- así "Pedidos" y "Pedidos_Detalle" (ver guardarPedidoCompleto) se crean
 * solas la primera vez que se guarda un pedido desde la web, sin que el usuario tenga que crearlas
 * a mano en Google Sheets primero.
 */
function obtenerOCrearHoja(ss, nombre, headers) {
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return hoja;
}

/**
 * NUEVO (2026-09-10): genera el ID_Pedido correlativo por proveedor (p.ej. "LCSC nº1",
 * "LCSC nº2", "ALIEXPRESS nº1") contando cuántos pedidos ya existen en la hoja "Pedidos" para ese
 * mismo proveedor (comparación insensible a mayúsculas/espacios).
 */
function generarIdPedido(hojaPedidos, proveedor) {
  const dataRange = hojaPedidos.getDataRange().getValues();
  const headers = dataRange.shift().map(function(h) { return String(h).trim(); });
  const provColIndex = headers.indexOf('Proveedor');
  let contador = 0;
  if (provColIndex !== -1) {
    dataRange.forEach(function(fila) {
      if (String(fila[provColIndex]).trim().toUpperCase() === proveedor.toUpperCase()) contador++;
    });
  }
  return `${proveedor.toUpperCase()} nº${contador + 1}`;
}

/**
 * NUEVO (2026-09-10): guarda un pedido completo desde el formulario "📦 Nuevo Pedido" de la
 * pestaña Stock Físico -- acción 'guardar_pedido_completo'. `datos` = { proveedor, fecha,
 * gastosEnvio, gastosManipulacion, descuento, aplicaAduana, gastosAduana,
 * lineas: [{idComponente, cantidad, precioUnitario}, ...] }.
 *
 * Reparte el gasto extra NETO (envío + manipulación + aduana, si aplicaAduana, MENOS el
 * descuento) entre las líneas del pedido PROPORCIONALMENTE AL VALOR de cada línea (cantidad ×
 * precioUnitario) sobre el valor total del pedido -- mismo criterio que ya usa el simulador de
 * kits para prorratear envío/aduanas. Con eso calcula Precio_Unitario_Real =
 * Precio_Unitario_Producto × (1 + gastoExtraTotal/valorArticulos). Los gastos de envío y de
 * manipulación (y el descuento) se aplican siempre, no dependen de aplicaAduana -- ese flag solo
 * controla si se suma también Gastos_Aduana.
 *
 * Registra una fila en "Pedidos" (cabecera), una fila por línea en "Pedidos_Detalle", y actualiza
 * Stock_Almacen: suma la cantidad a Uds_Disponibles y recalcula un COSTE MEDIO PONDERADO en la
 * columna "Precio_Real_Medio" (se crea sola la primera vez, igual que Stock_En_Camino) -- si el
 * componente ya tenía unidades con un precio medio previo, el nuevo medio pondera ambos lotes por
 * cantidad; si no, el medio pasa a ser directamente el de este pedido. También deja constancia del
 * último pedido de origen en la columna "Ultimo_ID_Pedido" (se crea igual). NOTA: al ser un coste
 * MEDIO por componente (no por lote), esta columna no distingue qué unidades físicas concretas
 * vinieron de qué pedido si llegan de proveedores distintos -- solo el último pedido que tocó ese
 * componente queda registrado; el desglose exacto por pedido siempre queda consultable en
 * "Pedidos_Detalle".
 *
 * Las columnas de "Pedidos" se localizan SIEMPRE por cabecera (obtenerOCrearColumnaPorCabecera),
 * nunca por posición fija -- así, si la hoja ya existía de una versión anterior sin
 * "Gastos_Manipulacion", esa columna se añade sola al final sin descuadrar ninguna columna ya
 * existente (mismo motivo por el que Stock_Almacen ya hacía esto con Stock_En_Camino).
 */
function guardarPedidoCompleto(datos) {
  try {
    if (!datos || !datos.proveedor) throw new Error("Falta el proveedor del pedido.");
    if (!datos.lineas || !Array.isArray(datos.lineas) || datos.lineas.length === 0) {
      throw new Error("El pedido no tiene ninguna línea de artículos.");
    }
    datos.lineas.forEach(function(l, i) {
      if (!l.idComponente) throw new Error(`Línea ${i + 1}: falta el componente.`);
      if (!(Number(l.cantidad) > 0)) throw new Error(`Línea ${i + 1} (${l.idComponente}): cantidad no válida.`);
      if (!(Number(l.precioUnitario) > 0)) throw new Error(`Línea ${i + 1} (${l.idComponente}): precio unitario no válido.`);
    });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const COLUMNAS_PEDIDOS = ['ID_Pedido', 'Proveedor', 'Fecha', 'Gastos_Envio', 'Gastos_Manipulacion', 'Descuento', 'Aplica_Aduana', 'Gastos_Aduana', 'Valor_Articulos', 'Gasto_Extra_Total'];
    const hojaPedidos = obtenerOCrearHoja(ss, 'Pedidos', COLUMNAS_PEDIDOS);
    const hojaDetalle = obtenerOCrearHoja(ss, 'Pedidos_Detalle',
      ['ID_Pedido', 'ID_Componente', 'Cantidad', 'Precio_Unitario_Producto', 'Precio_Unitario_Real']);

    let headersPedidos = hojaPedidos.getRange(1, 1, 1, hojaPedidos.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
    const colIndexPedidos = {};
    COLUMNAS_PEDIDOS.forEach(function(nombreCol) {
      colIndexPedidos[nombreCol] = obtenerOCrearColumnaPorCabecera(hojaPedidos, headersPedidos, nombreCol);
    });

    const proveedor = String(datos.proveedor).trim();
    const idPedido = generarIdPedido(hojaPedidos, proveedor);
    const fecha = datos.fecha ? new Date(datos.fecha) : new Date();
    const gastosEnvio = Number(datos.gastosEnvio) || 0;
    const gastosManipulacion = Number(datos.gastosManipulacion) || 0;
    const descuento = Number(datos.descuento) || 0;
    const aplicaAduana = !!datos.aplicaAduana;
    const gastosAduana = aplicaAduana ? (Number(datos.gastosAduana) || 0) : 0;

    const valorArticulos = datos.lineas.reduce(function(acc, l) {
      return acc + (Number(l.cantidad) * Number(l.precioUnitario));
    }, 0);
    // El descuento RESTA del gasto extra a repartir (puede dejarlo en negativo si el descuento es
    // mayor que envío+manipulación+aduana juntos -- en ese caso el precio real queda por DEBAJO
    // del precio de producto, que es justo lo esperable si el descuento compensa de sobra).
    const gastoExtraTotal = gastosEnvio + gastosManipulacion + gastosAduana - descuento;
    const factorReparto = valorArticulos > 0 ? (gastoExtraTotal / valorArticulos) : 0;

    const filaPedido = new Array(headersPedidos.length).fill('');
    filaPedido[colIndexPedidos['ID_Pedido']] = idPedido;
    filaPedido[colIndexPedidos['Proveedor']] = proveedor;
    filaPedido[colIndexPedidos['Fecha']] = fecha;
    filaPedido[colIndexPedidos['Gastos_Envio']] = redondear(gastosEnvio, 2);
    filaPedido[colIndexPedidos['Gastos_Manipulacion']] = redondear(gastosManipulacion, 2);
    filaPedido[colIndexPedidos['Descuento']] = redondear(descuento, 2);
    filaPedido[colIndexPedidos['Aplica_Aduana']] = aplicaAduana;
    filaPedido[colIndexPedidos['Gastos_Aduana']] = redondear(gastosAduana, 2);
    filaPedido[colIndexPedidos['Valor_Articulos']] = redondear(valorArticulos, 2);
    filaPedido[colIndexPedidos['Gasto_Extra_Total']] = redondear(gastoExtraTotal, 2);
    hojaPedidos.getRange(hojaPedidos.getLastRow() + 1, 1, 1, filaPedido.length).setValues([filaPedido]);

    // Se lee Stock_Almacen UNA sola vez para todas las líneas del pedido (evita releer toda la
    // hoja por cada artículo).
    const stockSheet = ss.getSheetByName('Stock_Almacen');
    if (!stockSheet) throw new Error("No se encuentra la pestaña 'Stock_Almacen'.");
    const stockData = stockSheet.getDataRange().getValues();
    const stockHeaders = stockData.shift().map(function(h) { return String(h).trim(); });
    const idColIndex = stockHeaders.indexOf('ID_Componente');
    const udsColIndex = stockHeaders.indexOf('Uds_Disponibles');
    if (idColIndex === -1 || udsColIndex === -1) {
      throw new Error("Faltan columnas 'ID_Componente' o 'Uds_Disponibles' en Stock_Almacen.");
    }
    const precioColIndex = obtenerOCrearColumnaPorCabecera(stockSheet, stockHeaders, 'Precio_Real_Medio');
    const origenColIndex = obtenerOCrearColumnaPorCabecera(stockSheet, stockHeaders, 'Ultimo_ID_Pedido');

    const filasDetalle = [];
    datos.lineas.forEach(function(l) {
      const idComponente = String(l.idComponente).trim();
      const cantidad = Number(l.cantidad);
      const precioProducto = Number(l.precioUnitario);
      const precioReal = redondear(precioProducto * (1 + factorReparto), 4);

      filasDetalle.push([idPedido, idComponente, cantidad, redondear(precioProducto, 4), precioReal]);

      let filaEncontrada = -1;
      for (let i = 0; i < stockData.length; i++) {
        if (String(stockData[i][idColIndex]).trim() === idComponente) { filaEncontrada = i; break; }
      }

      if (filaEncontrada !== -1) {
        const udsActual = Number(stockData[filaEncontrada][udsColIndex]) || 0;
        const precioActual = Number(stockData[filaEncontrada][precioColIndex]) || 0;
        const nuevoUds = udsActual + cantidad;
        const nuevoPrecioMedio = (udsActual > 0 && precioActual > 0)
          ? redondear(((precioActual * udsActual) + (precioReal * cantidad)) / nuevoUds, 4)
          : precioReal;

        stockSheet.getRange(filaEncontrada + 2, udsColIndex + 1).setValue(nuevoUds);
        stockSheet.getRange(filaEncontrada + 2, precioColIndex + 1).setValue(nuevoPrecioMedio);
        stockSheet.getRange(filaEncontrada + 2, origenColIndex + 1).setValue(idPedido);
        // Se actualiza también en memoria por si otra línea del MISMO pedido repite este
        // componente (no debería pasar, pero así el siguiente cálculo parte del valor correcto).
        stockData[filaEncontrada][udsColIndex] = nuevoUds;
        stockData[filaEncontrada][precioColIndex] = nuevoPrecioMedio;
      } else {
        const filaNueva = new Array(stockHeaders.length).fill('');
        filaNueva[idColIndex] = idComponente;
        filaNueva[udsColIndex] = cantidad;
        filaNueva[precioColIndex] = precioReal;
        filaNueva[origenColIndex] = idPedido;
        stockSheet.getRange(stockSheet.getLastRow() + 1, 1, 1, filaNueva.length).setValues([filaNueva]);
        stockData.push(filaNueva);
      }
    });

    hojaDetalle.getRange(hojaDetalle.getLastRow() + 1, 1, filasDetalle.length, 5).setValues(filasDetalle);

    return `Pedido ${idPedido} guardado: ${datos.lineas.length} artículo(s), valor ${redondear(valorArticulos, 2)}€ + ${redondear(gastoExtraTotal, 2)}€ de gasto extra repartido.`;
  } catch (err) {
    throw new Error("Error al guardar el pedido: " + err.message);
  }
}

/**
 * NUEVO: wrapper fino para guardar en Variantes_TME, usado por doPost (acción
 * 'update_tme_manual', desde el modal de la web) -- guarda UN solo tramo.
 */
function guardarVarianteManualTME(idComponente, udsPack, precioPack, stockPacks) {
  return guardarVarianteManual(idComponente, udsPack, precioPack, stockPacks, "Variantes_TME");
}

/**
 * NUEVO: como guardarVarianteManualTME pero para VARIOS tramos de precio a la vez (p.ej. los
 * 5-7 tramos reales que trae TME por cantidad: 1 ud, 5, 10, 25, 50...), en un solo envío desde
 * el asistente de Sheets (PopUpTME.html) -- mucho más práctico que abrir el popup una vez por
 * tramo. A diferencia de guardarVarianteManual (que solo AÑADE una fila), esta función primero
 * quita cualquier fila existente de este ID en Variantes_TME (igual que ya hace el asistente
 * automático de una sola fila, ver limpiarVariantesExistentes) para no acumular tramos
 * duplicados u obsoletos si se vuelve a editar el mismo componente más adelante.
 * @param idComponente ID_Componente al que pertenecen todos los tramos.
 * @param tramos Array de {uds, precio} -- cada uno un tamaño de pack y su precio TOTAL de pack.
 * @param stockPacks Unidades individuales en stock, iguales para todos los tramos (como hace TME).
 */
function guardarVariantesManualTME(idComponente, tramos, stockPacks) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetTME = ss.getSheetByName("Variantes_TME");
    if (!sheetTME) throw new Error("No se encuentra la pestaña 'Variantes_TME'.");
    if (!idComponente) throw new Error("ID de componente no válido.");
    if (!tramos || tramos.length === 0) throw new Error("Añade al menos un tramo (unidades + precio).");

    const stock = Number(stockPacks) || 0;
    const filasNuevas = tramos
      .filter(function(t) { return t && Number(t.uds) > 0 && Number(t.precio) > 0; })
      .map(function(t) { return [String(idComponente), Number(t.uds), Number(t.precio), stock]; });

    if (filasNuevas.length === 0) throw new Error("Ningún tramo tiene unidades y precio válidos.");

    // Igual que el asistente automático de una sola fila: quitamos primero cualquier fila
    // existente de este ID (manual o de una sincronización anterior) para no acumular
    // duplicados/tramos obsoletos al reeditar el mismo componente.
    limpiarVariantesExistentes(sheetTME, String(idComponente));

    const ultimaFila = Math.max(sheetTME.getLastRow(), 1);
    sheetTME.getRange(ultimaFila + 1, 1, filasNuevas.length, 4).setValues(filasNuevas);
    ordenarVariantes(sheetTME);

    return `¡Guardados ${filasNuevas.length} tramo(s) para ${idComponente}!`;
  } catch (err) {
    throw new Error("Error al guardar: " + err.message);
  }
}

/**
 * EXTRAER STOCK Y PRECIOS DE LCSC
 */
/**
 * NUEVO (fix): investigando por qué el precio de LCSC nunca se actualizaba a pesar de
 * resincronizar (ver conversación de agosto 2026 -- ejemplo real EEEFK1E330UR), se confirmó
 * comparando contra la página real que el bloque JSON embebido en el HTML que devuelve LCSC
 * SIEMPRE viene en USD ("currencySymbol":"$", campo "usdPrice"), sea cual sea la moneda que
 * muestra el navegador -- el € que se ve en la web es una conversión que hace el CLIENTE (JS)
 * después de cargar la página, aplicando un tipo de cambio que no está en ese HTML inicial (no
 * hay ninguna llamada de red aparte con el tipo de cambio real de LCSC, se comprobó con las
 * peticiones de la página). Así que antes se estaban guardando precios en USD como si fueran
 * EUR -- de ahí el ~15-20% de más que veías (0,0852 guardado vs 0,0759 real en la web).
 * Esta función ahora convierte explícitamente USD -> EUR con un tipo de cambio real (ver
 * obtenerTasaCambioUSDaEUR). No será céntimo a céntimo idéntico al que aplica LCSC internamente
 * (puede llevar un pequeño margen propio), pero corrige el grueso del error.
 */
function obtenerDatosLCSC(urlLCSC) {
  try {
    const response = UrlFetchApp.fetch(urlLCSC, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) return null;

    const html = response.getContentText();

    let stock = 0;
    const matchInventory = html.match(/"inventoryLevel"\s*:\s*(\d+)/i);
    if (matchInventory) {
      stock = Number(matchInventory[1]);
    }

    const tasaCambio = obtenerTasaCambioUSDaEUR();

    let priceList = [];
    const matchJsonPrices = html.match(/productPriceList\s*:\s*(\[[^\]]+\])/i)
                           || html.match(/"prices"\s*:\s*(\[[^\]]+\])/i)
                           || html.match(/"productPriceList"\s*:\s*(\[[^\]]+\])/i);

    if (matchJsonPrices) {
      try {
        const parsedPrices = JSON.parse(matchJsonPrices[1]);
        parsedPrices.forEach(p => {
          const uds = p.ladder || p.number || p.minNumber;
          // MODIFICADO (fix): el precio embebido viene en USD -- se convierte a EUR con la tasa
          // real antes de guardarlo (antes se guardaba el número USD tal cual, como si fuera €).
          const precioUSD = p.usdPrice || p.price;
          if (uds && precioUSD) {
            priceList.push({ uds: Number(uds), precioUnitario: Number(precioUSD) * tasaCambio });
          }
        });
      } catch(e) {}
    }

    return { stock: stock, prices: priceList };
  } catch (e) {
    Logger.log("Error al consultar LCSC: " + e.toString());
    return null;
  }
}

// NUEVO (fix): LCSC no expone en ningún sitio accesible por HTTP el tipo de cambio USD->EUR que
// aplica realmente (se comprobó incluso enviando las cookies de sesión reales -- el HTML del
// servidor siempre trae el precio en USD; la conversión a € la hace su JS en el navegador, sin
// ninguna llamada de red de por medio que se pueda copiar). Comparando los 6 tramos de precio
// reales de un componente (EEEFK1E330UR, agosto 2026) contra el JSON en USD embebido en su
// página, el ratio €/$ real de LCSC salió MUY consistente: ~0,8905 en los seis tramos. La tasa
// de mercado (BCE, vía Frankfurter) de ese mismo día era 0,8589 -- un ~3,69% más baja. Es decir,
// LCSC parece aplicarse un margen propio sobre el cambio de mercado (normal en cualquier tienda
// que hace conversión de divisa). Aplicamos ese margen empírico encima de la tasa de mercado para
// acercarnos mucho más a lo que se ve en LCSC.eu -- no es una garantía exacta permanente (si LCSC
// cambia su margen algún día habría que recalibrar este número), pero es lo más cerca que se
// puede llegar sin ejecutar su JavaScript.
const MARGEN_LCSC_SOBRE_MERCADO = 1.037;

/**
 * NUEVO (fix): tipo de cambio USD -> EUR usado por obtenerDatosLCSC (ver comentario ahí y el de
 * MARGEN_LCSC_SOBRE_MERCADO). Se cachea 6h (CacheService) para no pedirlo a la API externa en
 * cada componente de una sincronización completa -- una sola petición sirve para todo el
 * "Sincronizar Todo". Si la API de cambio falla (red caída, etc.), se usa un valor de respaldo
 * aproximado en vez de romper toda la sincronización de LCSC.
 */
function obtenerTasaCambioUSDaEUR() {
  const TASA_RESPALDO = 0.92; // aproximada (ya incluye el margen), solo por si la API no responde
  const cache = CacheService.getScriptCache();
  // MODIFICADO (fix): la clave de caché ahora lleva "_v2" -- la clave vieja ("tasaCambioUSDaEUR")
  // se quedó guardada en caché (hasta 6h) con la tasa SIN el margen de antes de añadir
  // MARGEN_LCSC_SOBRE_MERCADO, así que aunque el código ya tenía el fix, seguía devolviendo el
  // valor cacheado viejo -- por eso una resincronización no cambiaba nada. Cambiar de clave fuerza
  // a recalcular ya mismo en vez de esperar a que caduque la caché vieja por su cuenta.
  const CLAVE_CACHE = 'tasaCambioUSDaEUR_v2';
  const cacheado = cache.get(CLAVE_CACHE);
  if (cacheado) return Number(cacheado);

  try {
    const response = UrlFetchApp.fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=EUR', { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return TASA_RESPALDO;
    const data = JSON.parse(response.getContentText());
    const tasaMercado = data.rates && data.rates.EUR;
    if (!tasaMercado || isNaN(tasaMercado)) return TASA_RESPALDO;
    const tasa = tasaMercado * MARGEN_LCSC_SOBRE_MERCADO;
    cache.put(CLAVE_CACHE, String(tasa), 6 * 60 * 60); // 6 horas
    return tasa;
  } catch (e) {
    Logger.log("Error al obtener tasa de cambio USD->EUR, usando valor de respaldo: " + e.toString());
    return TASA_RESPALDO;
  }
}

/**
 * NUEVO: EXTRAER STOCK Y PRECIOS DE TME (API JSON oficial, sin scraping)
 * Descubierto analizando un .har real: POST a /ajax/common/product/data,
 * sin cookies ni sesión, acepta varios "symbol" en una sola llamada.
 * Como el "symbol" de TME coincide con nuestro ID_Componente, no depende
 * de la columna K en absoluto (a diferencia de LCSC).
 */
function obtenerDatosTMEBatch(symbols) {
  try {
    const url = "https://www.tme.eu/ajax/common/product/data";
    // NUEVO (fix): sin indicar "currency", TME devuelve los precios en USD (neto, sin IVA) --
    // sea cual sea el idioma/región de la petición -- y antes los guardábamos tal cual, como si
    // ya fueran euros (mismo tipo de bug que tuvo LCSC). A diferencia de LCSC, aquí la propia API
    // SÍ permite pedir directamente el precio ya convertido a EUR (comprobado contra la web real:
    // coincide céntimo a céntimo), así que no hace falta ningún tipo de cambio propio. Con
    // isGrossPrice:"true" pedimos el precio CON IVA incluido (21%), que es lo que confirmó el
    // usuario que quiere usar.
    const payload = {
      isFactoredPrice: false,
      isGrossPrice: "true",
      currency: "EUR",
      items: symbols.map(function(s) { return { symbol: s }; }),
      scope: ["prices", "stock", "delivery_confirmed"]
    };

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "es-ES,es;q=0.9",
        "Origin": "https://www.tme.eu",
        "Referer": "https://www.tme.eu/es/"
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      // NUEVO: dejamos rastro del motivo real del fallo (p.ej. límite de tamaño de lote)
      Logger.log("TME respondió " + response.getResponseCode() + " para " + symbols.length + " symbol(s): " + response.getContentText().substring(0, 300));
      return null;
    }

    const data = JSON.parse(response.getContentText());
    const productos = data.products || [];

    // NUEVO: diagnóstico -- antes solo se veía en el log si la petición HTTP fallaba del todo
    // (código != 200), pero el caso que nos interesa (p.ej. 025101.5MXL) es distinto: TME
    // responde 200 OK, pero para ese símbolo en concreto o bien NO aparece en absoluto en
    // "products", o bien aparece con stock pero con "priceGroup.elements" vacío (0 tramos de
    // precio). Registramos exactamente qué ha devuelto TME para cada símbolo pedido, para poder
    // distinguir estos dos casos la próxima vez que se sincronice (ver Ejecuciones en el editor
    // de Apps Script).
    const symbolsPedidos = symbols.map(String);
    const symbolsDevueltos = productos.map(function(p) { return String(p.symbol); });
    const symbolsAusentes = symbolsPedidos.filter(function(s) { return symbolsDevueltos.indexOf(s) === -1; });
    // NUEVO (fix, diagnóstico): el usuario detectó que el precio guardado para EEEFPC470UAR no
    // coincide con NINGUNA combinación (ni USD ni EUR, ni neto ni bruto) de las que se ven en
    // tme.eu -- probado en vivo desde un navegador normal, coincide exacto con currency:"EUR" +
    // isGrossPrice:"true". Sospecha: TME puede devolver un precio distinto a las peticiones que
    // salen de los servidores de Apps Script (sin cookies de sesión, con una IP de Google Cloud
    // en vez de una IP española) aunque se pida explícitamente currency:"EUR" -- ya se había visto
    // un comportamiento dependiente del origen de la petición con 025101.5MXL (reconoce el símbolo
    // pero no da precio). Este log deja constancia de currency/tipo/IVA y los 2 primeros tramos tal
    // cual los ve Apps Script, para poder comparar directamente contra lo que ve el navegador.
    const resumenProductos = productos.map(function(p) {
      const nTramos = (p.priceGroup && p.priceGroup.elements) ? p.priceGroup.elements.length : 0;
      const pg = p.priceGroup || {};
      const primerosTramos = (pg.elements || []).slice(0, 2).map(function(e) { return e.amount + "u=" + e.price; }).join(",");
      return p.symbol + "(stock=" + (p.stock || 0) + ",tramos=" + nTramos + ",moneda=" + pg.currency + ",tipo=" + pg.type + ",iva=" + pg.vatRate + ",[" + primerosTramos + "])";
    }).join(", ");
    Logger.log(
      "TME: lote [" + symbolsPedidos.join(", ") + "] -> devueltos: " + (resumenProductos || "(ninguno)") +
      (symbolsAusentes.length > 0 ? " | AUSENTES de la respuesta: " + symbolsAusentes.join(", ") : "")
    );

    return productos;
  } catch (e) {
    Logger.log("Error al consultar TME: " + e.toString());
    return null;
  }
}

/**
 * NUEVO: Igual que obtenerDatosTMEBatch pero troceando en lotes pequeños.
 * En el .har original nunca vimos a TME pedir más de 4 símbolos a la vez;
 * al mandar de golpe todos los componentes (>15) la API empezó a fallar,
 * así que aquí vamos por tandas (con una pequeña pausa entre ellas) en vez
 * de una única petición gigante.
 */
function obtenerDatosTMEBatchChunked(symbols, chunkSize) {
  const tamanoLote = chunkSize || 4;
  let resultado = [];

  // NUEVO: dado un producto (o undefined si el símbolo ni siquiera vino en la respuesta),
  // decide si merece la pena reintentarlo de forma individual: o no vino nada, o vino pero sin
  // ningún tramo de precio (priceGroup.elements vacío) -- este último es justo el patrón que
  // vimos con 025101.5MXL: TME lo reconoce (con stock) pero no manda precios EN EL LOTE.
  function necesitaReintento(producto) {
    if (!producto) return true;
    const nTramos = (producto.priceGroup && producto.priceGroup.elements) ? producto.priceGroup.elements.length : 0;
    return nTramos === 0;
  }

  for (let i = 0; i < symbols.length; i += tamanoLote) {
    const lote = symbols.slice(i, i + tamanoLote);
    let productos = obtenerDatosTMEBatch(lote);

    if (productos === null) {
      // NUEVO: un lote entero puede fallar por un rate-limit puntual (no porque
      // los símbolos no existan) — antes de darlos por perdidos, reintentamos
      // ese lote símbolo a símbolo, que es la vía que sabemos más fiable.
      Logger.log("TME: fallo en el lote " + lote.join(", ") + " — reintentando uno a uno.");
      productos = [];
    }

    // MODIFICADO (fix): antes solo se reintentaba símbolo a símbolo si el LOTE ENTERO fallaba
    // (respuesta != 200). Pero un lote puede responder 200 OK y aun así, para uno o varios
    // símbolos concretos, devolver 0 tramos de precio o directamente omitirlo -- eso es lo que
    // le pasaba a 025101.5MXL, y antes se daba por perdido sin más. Ahora, para cada símbolo del
    // lote que haya venido "vacío" (ausente o sin tramos), lo reintentamos de forma individual
    // -- la vía que ya sabíamos más fiable -- antes de darlo definitivamente por "sin datos".
    const pedidosDelLote = lote.map(String);
    const symbolsAReintentar = pedidosDelLote.filter(function(symbol) {
      const producto = productos.filter(function(p) { return String(p.symbol) === symbol; })[0];
      return necesitaReintento(producto);
    });

    if (symbolsAReintentar.length > 0) {
      Logger.log("TME: reintentando de forma individual " + symbolsAReintentar.join(", ") + " (vinieron vacíos en el lote).");
      symbolsAReintentar.forEach(function(symbol) {
        Utilities.sleep(300);
        const individual = obtenerDatosTMEBatch([symbol]);
        const productoIndividual = individual ? individual[0] : null;
        if (productoIndividual && !necesitaReintento(productoIndividual)) {
          // Sustituimos la entrada "vacía" del lote (si la había) por la del reintento, que sí trae tramos.
          productos = productos.filter(function(p) { return String(p.symbol) !== symbol; }).concat([productoIndividual]);
        }
      });
    }

    resultado = resultado.concat(productos);

    if (i + tamanoLote < symbols.length) {
      Utilities.sleep(400);
    }
  }

  return resultado;
}

// NUEVO (fix): pedir currency:"EUR" + isGrossPrice:"true" (ver obtenerDatosTMEBatch) hace que la
// API devuelva el precio ya en euros y "bruto", PERO el usuario detectó que seguía sin coincidir
// con lo que ve en tme.eu (11,50€ guardado vs 12,65€ real para 50 uds de EEEFPC470UAR). Añadiendo
// un log de diagnóstico se confirmó la causa: a las peticiones que salen de los servidores de
// Apps Script (sin cookies de navegador, sin país detectado), TME les responde con vatRate=0 --
// es decir, en la práctica NUNCA aplica el 21% de IVA español a estas peticiones, aunque se pida
// "isGrossPrice: true" (¡el propio "bruto" que devuelve ya no lleva IVA real, porque su propio
// "vatRate" es 0 para esa petición!). Comparando 7 componentes reales (14 tramos) contra el precio
// que SÍ ve un navegador normal en tme.eu/es/ (que aplica 21% real), salió un ratio consistente de
// ~1,091 (rango 1,077-1,108) -- aplicamos ese margen empírico para acercarnos al precio real que
// pagaría el usuario. (Se descartó MC7805ACTG del cálculo: dio una relación completamente opuesta,
// ~0,81 en vez de ~1,09 -- probablemente esa referencia tiene varias variantes/fabricantes en TME
// y la API devuelve una distinta según el contexto de la petición; si se nota un precio raro para
// ese componente en concreto, mejor comprobarlo a mano con el asistente manual.)
// MODIFICADO (fix): se subió a 1,10 tras recalibrar SOLO con EEEFPC470UAR (coincidía exacto en su
// tramo de 50 uds). Pero al comprobar OTRO componente (EEHZA1V270V) con 1,10 salió el error en el
// sentido CONTRARIO (~2% por ENCIMA del precio real en sus 5 tramos, en vez de por debajo). Es
// decir: el desfase real no es un porcentaje fijo igual para todos los componentes -- varía de uno
// a otro (probablemente porque la lista de precios "alternativa" que le sirve TME a Apps Script no
// es un simple recargo de moneda como en LCSC, sino que tiene sus propios márgenes por
// producto/fabricante). Con un único número nunca se va a acertar exacto para todos los
// componentes. Con los 21 tramos medidos hasta ahora (8 componentes distintos, EEEFPC470UAR y
// EEHZA1V270V incluidos) la media global sale ~1,09 -- se deja ahí por ser el valor que más se
// acerca EN CONJUNTO, aunque cada componente individual pueda tener un ±1,5-2% de error. Si se
// necesita precisión exacta para un pedido grande, mejor comprobar el precio real en tme.eu antes
// de comprar, o usar el asistente manual para ese componente.
const MARGEN_TME_SOBRE_APPS_SCRIPT = 1.09;

// NUEVO (fix 2026-09-07): MC7805ACTG lleva desde el principio dando problemas en TME (ya se
// había descartado del cálculo de MARGEN_TME_SOBRE_APPS_SCRIPT por dar una relación opuesta,
// ~0,81 en vez de ~1,09). Comprobado a fondo hoy comparando los 6 tramos guardados en
// Variantes_TME contra el precio neto real de tme.eu: el ratio es un 1,635 CONSTANTE en los 6
// tramos (1+, 10+, 25+, 50+, 100+, 250+) -- es decir, no es un desajuste de tramos ni un tema de
// USD/EUR (ninguna conversión de moneda da un factor tan alto), sino un ~50% de sobreprecio que
// ya viene así en el dato crudo que la API de TME devuelve para este símbolo concreto, ANTES
// incluso de aplicarle nuestro margen (1,635 / 1,09 = 1,50 exacto). Lo más probable, según lo que
// ya se sospechaba, es que "MC7805ACTG" en TME resuelva a más de un producto/variante (otro
// fabricante o encapsulado) y la API de precio por lote no siempre esté devolviendo el mismo que
// aparece como resultado exacto en la web. En vez de seguir parcheando con otra constante (que no
// arreglaría un problema que no es de margen), estos símbolos se EXCLUYEN de la sincronización
// automática de TME -- hay que introducir su precio a mano con el asistente manual, igual que ya
// se hace con AliExpress. Añadir aquí cualquier otro ID_Componente que dé este mismo patrón.
const EXCLUIDOS_SYNC_TME = ['MC7805ACTG'];

/**
 * NUEVO: Convierte un producto devuelto por TME (con su priceGroup.elements)
 * al mismo formato [idComponente, uds, precioPackTotal, stock] que ya usamos
 * para LCSC/AliExpress, para no tener que tocar el resto del sistema.
 */
function filasDesdeProductoTME(producto) {
  const elementos = (producto.priceGroup && producto.priceGroup.elements) || [];
  const stock = producto.stock || 0;
  return elementos
    .slice()
    .sort(function(a, b) { return a.amount - b.amount; })
    .map(function(el) {
      const precioCorregido = el.price * MARGEN_TME_SOBRE_APPS_SCRIPT;
      return [String(producto.symbol), el.amount, Number((el.amount * precioCorregido).toFixed(4)), stock];
    });
}

/**
 * NUEVO: SINCRONIZACIÓN AUTOMÁTICA DE TME DESDE LA HOJA (Fila Seleccionada)
 */
function sincronizarTMEAutomattic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  const sheetTME = ss.getSheetByName("Variantes_TME");

  if (!sheetTME) {
    SpreadsheetApp.getUi().alert("No existe la pestaña 'Variantes_TME'.");
    return;
  }

  const filaActual = sheetComp.getActiveCell().getRow();
  if (filaActual < 2) return;

  const idComponente = sheetComp.getRange(filaActual, 2).getValue();
  if (!idComponente) return;

  // NUEVO (fix 2026-09-07): ver comentario junto a EXCLUIDOS_SYNC_TME -- para estos símbolos la
  // API de TME da un precio poco fiable (probable colisión con otra variante/fabricante), así que
  // avisamos y no sincronizamos automáticamente ni siquiera en el sync manual de una fila.
  if (EXCLUIDOS_SYNC_TME.indexOf(String(idComponente)) !== -1) {
    SpreadsheetApp.getUi().alert(`${idComponente} está excluido de la sincronización automática de TME (su precio por API no es fiable -- introdúcelo a mano con el asistente manual).`);
    return;
  }

  ss.toast(`Conectando con TME para ${idComponente}...`, "📦 Sincronizando", 10);
  const productos = obtenerDatosTMEBatch([String(idComponente)]);

  if (!productos || productos.length === 0) {
    SpreadsheetApp.getUi().alert(`No se encontraron datos en TME para ${idComponente}.`);
    return;
  }

  const filasAAgregar = filasDesdeProductoTME(productos[0]);
  if (filasAAgregar.length === 0) {
    SpreadsheetApp.getUi().alert(`TME no devolvió tramos de precio para ${idComponente}.`);
    return;
  }

  limpiarVariantesExistentes(sheetTME, String(idComponente));
  const ultimaFila = Math.max(sheetTME.getLastRow(), 1);
  sheetTME.getRange(ultimaFila + 1, 1, filasAAgregar.length, 4).setValues(filasAAgregar);
  ordenarVariantes(sheetTME);
  ss.toast(`¡Importados ${filasAAgregar.length} tramos de TME para ${idComponente}!`, "✅ Finalizado", 5);
}

/**
 * NUEVO: Sincroniza TODOS los componentes con TME en una sola petición
 * (para la API Web). La API de TME acepta varios "symbol" a la vez, así que
 * a diferencia de sincronizarTodoLCSC no hace falta bucle con sleep().
 */
function sincronizarTodoTME() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  const sheetTME = ss.getSheetByName("Variantes_TME");
  if (!sheetTME) throw new Error("No existe la pestaña 'Variantes_TME'.");

  const datosComp = sheetComp.getDataRange().getValues();
  const headers = datosComp.shift();
  const colId = headers.indexOf('ID_Componente');
  const colProv = headers.indexOf('Proveedor_Preferido');

  // MODIFICADO (fix): antes se pedían a TME TODOS los ID_Componente de la hoja, aunque su
  // proveedor fuese LCSC o AliExpress -- de ahí que "Sin datos en TME" saliera llena de
  // componentes que nunca se han buscado en TME (p.ej. FUSE-PICO-1.5A-AXIAL, solo en
  // AliExpress). Además de ser peticiones de sobra, cuantos más símbolos se piden de golpe más
  // probable es que un lote entero falle por el rate-limit de TME (ver
  // obtenerDatosTMEBatchChunked) -- así que filtrar solo a los que SÍ son de TME también reduce
  // el riesgo de que un componente que sí tiene stock real (como 025101.5MXL) se vea arrastrado
  // por el fallo de otros símbolos ajenos en el mismo lote.
  // MODIFICADO (fix previo): un mismo ID_Componente puede aparecer en varias filas de
  // Componentes (una por proveedor); deduplicamos para no pedir el mismo símbolo dos veces.
  // MODIFICADO (fix 2026-09-07): quitamos también los símbolos de EXCLUIDOS_SYNC_TME (ver
  // comentario junto a esa constante) -- para esos, la propia API de TME da un precio poco
  // fiable, así que ni siquiera merece la pena pedirlo automáticamente.
  const idsExcluidosEncontrados = [];
  const idsComponentes = Array.from(new Set(
    datosComp
      .filter(function(row) { return String(row[colProv] || '').trim().toUpperCase() === 'TME'; })
      .map(function(row) { return row[colId]; })
      .filter(function(id) { return id; })
      .map(String)
      .filter(function(id) {
        if (EXCLUIDOS_SYNC_TME.indexOf(id) !== -1) {
          idsExcluidosEncontrados.push(id);
          return false;
        }
        return true;
      })
  ));

  if (idsComponentes.length === 0) {
    return idsExcluidosEncontrados.length > 0
      ? `No hay componentes para sincronizar (excluidos de TME: ${Array.from(new Set(idsExcluidosEncontrados)).join(', ')} -- introdúcelos a mano).`
      : "No hay componentes para sincronizar.";
  }

  // NUEVO: dejamos constancia en el registro de ejecuciones de qué IDs se piden
  Logger.log("TME: IDs solicitados (" + idsComponentes.length + "): " + idsComponentes.join(", "));

  // MODIFICADO: troceado en lotes de 4 (el máximo que vimos pedir a la web real de TME en el
  // .har, ver obtenerDatosTMEBatchChunked) en vez de una única petición gigante.
  const productos = obtenerDatosTMEBatchChunked(idsComponentes, 4);
  if (!productos || productos.length === 0) throw new Error("No se pudo conectar con la API de TME (ningún lote respondió).");

  let todasLasFilas = [];
  let totalActualizados = 0;
  const idsConDatos = {};

  productos.forEach(function(p) {
    const filas = filasDesdeProductoTME(p);
    if (filas.length > 0) {
      todasLasFilas = todasLasFilas.concat(filas);
      totalActualizados++;
      idsConDatos[String(p.symbol)] = true;
    }
  });

  // NUEVO: qué IDs se pidieron pero TME no devolvió tramos de precio para ellos
  const idsUnicos = Array.from(new Set(idsComponentes));
  const noEncontrados = idsUnicos.filter(function(id) { return !idsConDatos[id]; });
  Logger.log("TME: sin datos (" + noEncontrados.length + "): " + noEncontrados.join(", "));

  // NUEVO: distinguimos dos casos bien distintos dentro de "sin datos", porque tienen causas y
  // soluciones distintas -- confirmado investigando 025101.5MXL: TME puede reconocer un símbolo
  // (con stock) pero no dar NUNCA su precio a peticiones que no vienen de Apps Script (muy
  // probablemente por geolocalización de IP -- no hay cookie ni parámetro de país en la
  // petición, ni de TME.eu ni nuestra, así que lo decide su servidor por la IP de origen; esto
  // no tiene arreglo posible desde Apps Script). Eso es un caso para el asistente manual, no un
  // fallo transitorio que se vaya a arreglar solo con reintentar.
  const productoPorId = {};
  productos.forEach(function(p) { productoPorId[String(p.symbol)] = p; });
  const sinPrecioPeroConStock = noEncontrados.filter(function(id) {
    const p = productoPorId[id];
    return p && (p.stock || 0) > 0;
  });
  const noEncontradosDeVerdad = noEncontrados.filter(function(id) {
    return sinPrecioPeroConStock.indexOf(id) === -1;
  });

  // MODIFICADO (fix): antes esto borraba TODA la hoja Variantes_TME y la reescribía solo con lo
  // que hubiera venido bien en ESTA pasada -- así que un fallo puntual de TME para un símbolo
  // (ver comentario de fusionarFilasVariantes) le borraba el stock/precio que ya tenía guardado
  // de una sincronización anterior, dejándolo "sin stock" aunque siguiera teniendo stock real.
  // Ahora solo se sustituyen las filas de los símbolos que SÍ se han vuelto a sincronizar con
  // éxito; el resto (fallidos esta vez, o no solicitados) se conserva tal cual estaba.
  fusionarFilasVariantes(sheetTME, idsConDatos, todasLasFilas);
  ordenarVariantes(sheetTME);

  let msg = `Sincronizados ${totalActualizados} componentes desde TME (de ${idsUnicos.length} pedidos).`;
  if (sinPrecioPeroConStock.length > 0) {
    msg += ` TME reconoce pero no da precio (posible restricción regional -- usa el asistente manual): ${sinPrecioPeroConStock.join(', ')}.`;
  }
  if (noEncontradosDeVerdad.length > 0) {
    msg += ` Sin ningún dato en TME: ${noEncontradosDeVerdad.join(', ')}.`;
  }
  if (idsExcluidosEncontrados.length > 0) {
    msg += ` Excluidos del sync automático (precio poco fiable en TME -- usa el asistente manual): ${Array.from(new Set(idsExcluidosEncontrados)).join(', ')}.`;
  }
  return msg;
}

/**
 * NUEVO (fix): Las columnas L/M/N (Precio_Pack/Uds_Pack/Precio_Unitario) usan fórmulas
 * tipo ARRAYFORMULA/MAP con un rango abierto (ej. B2:B), que "ensucian" con fórmulas
 * (aunque su resultado visible sea "") muchísimas filas por debajo de tus datos reales.
 * Eso hace que sheetComp.getLastRow() devuelva un número de fila mucho más alto de lo
 * real, y por tanto NO sirve para saber dónde añadir filas nuevas. Esta función busca
 * la última fila con datos REALES mirando sólo ID_Componente / Cod_Componente (columnas
 * que nunca son fórmulas).
 */
function obtenerUltimaFilaRealComponentes(datosComp, colId, colCod) {
  for (let i = datosComp.length - 1; i >= 0; i--) {
    const tieneId = colId !== -1 && String(datosComp[i][colId] || '').trim() !== '';
    const tieneCod = colCod !== -1 && String(datosComp[i][colCod] || '').trim() !== '';
    if (tieneId || tieneCod) {
      return i + 2; // +1 por la cabecera (fila 1), +1 porque el índice del array es 0-based
    }
  }
  return 1; // no hay datos, sólo cabecera
}

/**
 * NUEVO (fix): mismo problema que obtenerUltimaFilaRealComponentes, pero en "Kits_Consolas".
 * Las propias columnas L/M (Proveedores_Disponibles / Uds_Pack - Precio_Unid) las escribimos
 * NOSOTROS en cada sincronización con setValues()/setRichTextValues() -- y eso, aunque el
 * contenido quede vacío, "ensucia" esas celdas como si tuvieran datos reales para siempre.
 * El resultado es un bucle que se retroalimenta solo: sheetKits.getDataRange() devuelve cada
 * vez más filas de las que existen de verdad (llegó a 1006 en este caso, con solo ~30 filas
 * reales), y cada sincronización vuelve a escribir ese mismo número de filas, perpetuando el
 * problema. Esta función busca la última fila con datos REALES mirando solo ID_Componente
 * (columna que el usuario rellena a mano, nunca la tocan estas funciones).
 */
function obtenerUltimaFilaRealKits(datosKits, colIdComp) {
  for (let i = datosKits.length - 1; i >= 0; i--) {
    const tieneId = colIdComp !== -1 && String(datosKits[i][colIdComp] || '').trim() !== '';
    if (tieneId) {
      return i + 2; // +1 por la cabecera (fila 1), +1 porque el índice del array es 0-based
    }
  }
  return 1; // no hay datos, sólo cabecera
}

/**
 * NUEVO (fix): borra cualquier resto escrito por nosotros mismos por debajo de la última fila
 * con datos reales, en la columna indicada de Kits_Consolas -- así rompemos el bucle de
 * auto-inflado descrito arriba en vez de solo evitar que crezca más.
 */
function limpiarSobrantesKits(sheetKits, columna, ultimaFilaReal) {
  const ultimaFilaHoja = sheetKits.getLastRow();
  if (ultimaFilaHoja > ultimaFilaReal) {
    sheetKits.getRange(ultimaFilaReal + 1, columna, ultimaFilaHoja - ultimaFilaReal, 1).clearContent();
  }
}

// NUEVA FUNCIÓN UI: Lanza la función pura y muestra alerta
function crearFilasTMEEnComponentesUI() {
  try {
    const msg = crearFilasTMEEnComponentes();
    SpreadsheetApp.getUi().alert("✅ " + msg);
  } catch (err) {
    SpreadsheetApp.getUi().alert("❌ Error: " + err.message);
  }
}

/**
 * NUEVO: Por cada ID_Componente que ya tenga datos reales en Variantes_TME
 * y que TODAVÍA no tenga su propia fila "TME" en Componentes (mismo patrón
 * que la fila 10006 que creaste a mano para EEEFTH100UAR), añade una fila
 * nueva: copia los datos generales (Tipo, Valor, Voltaje, Encapsulado,
 * Marca_Top, Serie, Rol_Circuito) de la fila existente de ese componente,
 * pone en K el enlace de búsqueda de TME y en O "TME". No toca L/M/N
 * (Precio_Pack/Uds_Pack/Precio_Unitario) porque son fórmulas que se
 * autoextienden solas al añadir filas.
 */
function crearFilasTMEEnComponentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  const sheetTME = ss.getSheetByName("Variantes_TME");
  if (!sheetComp || !sheetTME) throw new Error("No se encuentran las hojas 'Componentes' o 'Variantes_TME'.");

  // 1. Symbols con datos reales en Variantes_TME (columna A)
  const datosTME = sheetTME.getDataRange().getValues();
  datosTME.shift(); // quitamos cabecera
  const symbolsConDatos = Array.from(new Set(
    datosTME.map(function(row) { return String(row[0]); }).filter(function(s) { return s; })
  ));

  if (symbolsConDatos.length === 0) return "No hay datos en Variantes_TME todavía.";

  // 2. Leer Componentes completo
  const datosComp = sheetComp.getDataRange().getValues();
  const headers = datosComp.shift().map(function(h) { return String(h).trim(); });

  const colCod = headers.indexOf('Cod_Componente');
  const colId = headers.indexOf('ID_Componente');
  const colTipo = headers.indexOf('Tipo');
  const colValor = headers.indexOf('Valor');
  const colVoltaje = headers.indexOf('Voltaje');
  const colEncapsulado = headers.indexOf('Encapsulado');
  const colMarca = headers.indexOf('Marca_Top');
  const colSerie = headers.indexOf('Serie');
  const colRol = headers.indexOf('Rol_Circuito');
  const colLCSCCode = headers.indexOf('LCSC_Code');
  const colLink = headers.indexOf('Link_AliExpress');
  const colProveedor = headers.indexOf('Proveedor_Preferido');
  const colMaxUds = headers.indexOf('Máximo de Unidades por Pack');
  const colMaxPrecio = headers.indexOf('Presupuesto Máximo en €');
  const colKits = headers.indexOf('Kits_que_lo_usan');

  if (colId === -1 || colProveedor === -1 || colLink === -1) {
    throw new Error("Faltan columnas esperadas (ID_Componente, Proveedor_Preferido o Link_AliExpress) en Componentes.");
  }

  // 3. Detectar qué symbols YA tienen su fila TME, y guardar una fila "plantilla" por symbol
  const yaTieneFilaTME = {};
  const plantillaPorId = {};
  datosComp.forEach(function(row) {
    const id = String(row[colId] || '');
    if (!id) return;
    if (!plantillaPorId[id]) plantillaPorId[id] = row; // primera fila que veamos con ese ID, de referencia
    if (String(row[colProveedor] || '').trim().toUpperCase() === 'TME') {
      yaTieneFilaTME[id] = true;
    }
  });

  // 4. Calcular próximo Cod_Componente disponible
  let siguienteCod = 1;
  if (colCod !== -1) {
    datosComp.forEach(function(row) {
      const n = Number(row[colCod]);
      if (!isNaN(n) && n >= siguienteCod) siguienteCod = n + 1;
    });
  }

  // 5. Construir filas nuevas
  const filasNuevas = [];
  const symbolsAgregados = [];

  symbolsConDatos.forEach(function(symbol) {
    if (yaTieneFilaTME[symbol]) return; // ya tiene su fila TME, no duplicar

    const plantilla = plantillaPorId[symbol]; // puede ser undefined si el symbol no existía en Componentes (no debería pasar)
    const fila = new Array(headers.length).fill('');

    if (colCod !== -1) { fila[colCod] = siguienteCod; siguienteCod++; }
    fila[colId] = symbol;
    if (plantilla) {
      if (colTipo !== -1) fila[colTipo] = plantilla[colTipo];
      if (colValor !== -1) fila[colValor] = plantilla[colValor];
      if (colVoltaje !== -1) fila[colVoltaje] = plantilla[colVoltaje];
      if (colEncapsulado !== -1) fila[colEncapsulado] = plantilla[colEncapsulado];
      if (colMarca !== -1) fila[colMarca] = plantilla[colMarca];
      if (colSerie !== -1) fila[colSerie] = plantilla[colSerie];
      if (colRol !== -1) fila[colRol] = plantilla[colRol];
      if (colMaxUds !== -1) fila[colMaxUds] = plantilla[colMaxUds];
      if (colMaxPrecio !== -1) fila[colMaxPrecio] = plantilla[colMaxPrecio];
      if (colKits !== -1) fila[colKits] = plantilla[colKits];
    }
    if (colLCSCCode !== -1) fila[colLCSCCode] = ''; // no aplica para TME
    fila[colLink] = 'https://www.tme.eu/es/katalog/?queryPhrase=' + encodeURIComponent(symbol);
    fila[colProveedor] = 'TME';
    // L, M, N (Precio_Pack/Uds_Pack/Precio_Unitario) se quedan en blanco: la fórmula MAP() de la fila 1 se autoextiende sola

    filasNuevas.push(fila);
    symbolsAgregados.push(symbol);
  });

  if (filasNuevas.length === 0) return "Todos los componentes con datos en TME ya tenían su fila. No se ha añadido nada.";

  const ultimaFila = obtenerUltimaFilaRealComponentes(datosComp, colId, colCod);
  sheetComp.getRange(ultimaFila + 1, 1, filasNuevas.length, headers.length).setValues(filasNuevas);

  return `Añadidas ${filasNuevas.length} filas nuevas para: ${symbolsAgregados.join(', ')}.`;
}

function repararFilasTMEDesplazadasUI() {
  try {
    const msg = repararFilasTMEDesplazadas();
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    SpreadsheetApp.getUi().alert("❌ Error: " + err.message);
  }
}

/**
 * REPARACIÓN (ejecutar UNA VEZ): la primera ejecución de crearFilasTMEEnComponentes()
 * tenía el bug de arriba (usaba getLastRow() en vez de obtenerUltimaFilaRealComponentes),
 * así que probablemente SÍ creó las filas TME correctamente, pero muy por debajo de tus
 * datos reales (por eso "no parecía haber pasado nada", y la segunda ejecución ya las
 * detectó como existentes). Esta función busca esas filas "perdidas" y las sube justo
 * debajo de tus datos reales, borrando el hueco vacío que quedaba entre medias.
 */
function repararFilasTMEDesplazadas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  if (!sheetComp) throw new Error("No se encuentra la hoja 'Componentes'.");

  const datosComp = sheetComp.getDataRange().getValues();
  const headers = datosComp.shift().map(function(h) { return String(h).trim(); });

  const colId = headers.indexOf('ID_Componente');
  const colCod = headers.indexOf('Cod_Componente');
  const colProveedor = headers.indexOf('Proveedor_Preferido');

  if (colId === -1) throw new Error("No se encuentra la columna 'ID_Componente' en Componentes.");

  const ultimaFilaReal = obtenerUltimaFilaRealComponentes(datosComp, colId, colCod);
  const ultimaFilaHoja = sheetComp.getLastRow();

  if (ultimaFilaHoja <= ultimaFilaReal) {
    return "✅ No hay filas desplazadas. Todo está en orden.";
  }

  // Buscamos filas con datos reales (ID_Componente o Proveedor_Preferido no vacíos) por debajo de la última fila real
  const filasPerdidas = [];
  for (let i = ultimaFilaReal - 1; i < datosComp.length; i++) {
    const row = datosComp[i];
    const tieneId = String(row[colId] || '').trim() !== '';
    const tieneProveedor = colProveedor !== -1 && String(row[colProveedor] || '').trim() !== '';
    if (tieneId || tieneProveedor) {
      filasPerdidas.push(row);
    }
  }

  if (filasPerdidas.length === 0) {
    return `ℹ️ Había filas "fantasma" (sólo fórmulas vacías) hasta la fila ${ultimaFilaHoja}, pero ningún dato real perdido. No se ha movido nada.`;
  }

  // Subimos las filas perdidas justo debajo de los datos reales
  sheetComp.getRange(ultimaFilaReal + 1, 1, filasPerdidas.length, headers.length).setValues(filasPerdidas);

  // Borramos el hueco viejo (posiciones originales de esas filas + relleno de fórmulas vacías)
  const filaInicioBorrado = ultimaFilaReal + filasPerdidas.length + 1;
  const numFilasABorrar = ultimaFilaHoja - filaInicioBorrado + 1;
  if (numFilasABorrar > 0) {
    sheetComp.deleteRows(filaInicioBorrado, numFilasABorrar);
  }

  return `✅ Se han recuperado y subido ${filasPerdidas.length} fila(s) que estaban "perdidas" por debajo de tus datos. Revísalas justo a continuación de la última fila con datos.`;
}

/**
 * NUEVO: Diagnóstico masivo — pide a TME TODOS los ID_Componente de la hoja
 * y muestra en una alerta cuáles se pidieron y cuáles NO devolvieron datos,
 * sin escribir nada en Variantes_TME (solo para depurar).
 */
function probarDiagnosticoTMETodos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");

  const datosComp = sheetComp.getDataRange().getValues();
  const headers = datosComp.shift();
  const colId = headers.indexOf('ID_Componente');

  const idsComponentes = Array.from(new Set(
    datosComp.map(function(row) { return row[colId]; }).filter(function(id) { return id; }).map(String)
  ));

  if (idsComponentes.length === 0) {
    SpreadsheetApp.getUi().alert("No hay ID_Componente para consultar.");
    return;
  }

  const productos = obtenerDatosTMEBatchChunked(idsComponentes, 4);
  if (!productos || productos.length === 0) {
    SpreadsheetApp.getUi().alert("Error al conectar con la API de TME (ningún lote respondió). Revisa el registro de Ejecuciones para ver el código de error real.");
    return;
  }

  const encontrados = {};
  productos.forEach(function(p) {
    if (filasDesdeProductoTME(p).length > 0) encontrados[p.symbol] = true;
  });
  const noEncontrados = idsComponentes.filter(function(id) { return !encontrados[id]; });

  const mensaje =
    `Pedidos (${idsComponentes.length}):\n${idsComponentes.join(', ')}\n\n` +
    `Con datos en TME (${idsComponentes.length - noEncontrados.length}):\n${idsComponentes.filter(function(id){return encontrados[id];}).join(', ') || '(ninguno)'}\n\n` +
    `SIN datos en TME (${noEncontrados.length}):\n${noEncontrados.join(', ') || '(ninguno)'}`;

  SpreadsheetApp.getUi().alert(mensaje);
}

/**
 * NUEVO: Diagnóstico rápido de TME, igual que el de LCSC.
 */
function probarDiagnosticoTME() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  let symbolPrueba = "EEEFTH100UAR";

  if (sheetComp && ss.getActiveSheet().getName() === "Componentes") {
    const filaActual = sheetComp.getActiveCell().getRow();
    if (filaActual >= 2) {
      const idFila = sheetComp.getRange(filaActual, 2).getValue();
      if (idFila) symbolPrueba = String(idFila).trim();
    }
  }

  const productos = obtenerDatosTMEBatch([symbolPrueba]);
  if (!productos || productos.length === 0) return SpreadsheetApp.getUi().alert("Error al obtener datos o símbolo no encontrado en TME: " + symbolPrueba);
  const p = productos[0];
  const tramos = (p.priceGroup && p.priceGroup.elements) || [];
  SpreadsheetApp.getUi().alert(`Symbol: ${p.symbol}\nStock: ${p.stock}\nTramos: ${tramos.length}`);
}

/**
 * SINCRONIZACIÓN AUTOMÁTICA DE LCSC DESDE LA HOJA (Fila Selecionada)
 */
function sincronizarLCSCAutomattic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  const sheetLCSC = ss.getSheetByName("Variantes_LCSC");

  if (!sheetLCSC) {
    SpreadsheetApp.getUi().alert("No existe la pestaña 'Variantes_LCSC'.");
    return;
  }

  const filaActual = sheetComp.getActiveCell().getRow();
  if (filaActual < 2) return;

  const idComponente = sheetComp.getRange(filaActual, 2).getValue();
  const urlLCSC = sheetComp.getRange(filaActual, 11).getValue();

  if (!urlLCSC || !String(urlLCSC).includes("lcsc.com")) return;

  ss.toast(`Conectando con LCSC para ${idComponente}...`, "⚡ Sincronizando", 10);
  const datosLCSC = obtenerDatosLCSC(String(urlLCSC).trim());

  if (!datosLCSC || datosLCSC.prices.length === 0) return;

  limpiarVariantesExistentes(sheetLCSC, String(idComponente));
  const filasAAgregar = [];
  datosLCSC.prices.sort((a, b) => a.uds - b.uds).forEach(item => {
    filasAAgregar.push([String(idComponente), item.uds, Number((item.uds * item.precioUnitario).toFixed(4)), datosLCSC.stock]);
  });

  const ultimaFila = Math.max(sheetLCSC.getLastRow(), 1);
  sheetLCSC.getRange(ultimaFila + 1, 1, filasAAgregar.length, 4).setValues(filasAAgregar);
  ordenarVariantes(sheetLCSC);
  ss.toast(`¡Importados ${filasAAgregar.length} tramos para ${idComponente}!`, "✅ Finalizado", 5);
}

/**
 * FUNCIÓN OPTIMIZADA: Sincroniza TODOS los componentes de LCSC (para la API Web)
 */
function sincronizarTodoLCSC() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  const sheetLCSC = ss.getSheetByName("Variantes_LCSC");
  if (!sheetLCSC) throw new Error("No existe la pestaña 'Variantes_LCSC'.");

  const datosComp = sheetComp.getDataRange().getValues();
  const headers = datosComp.shift();
  const colId = headers.indexOf('ID_Componente');
  const colUrl = headers.indexOf('Link_AliExpress');

  let todasLasFilas = [];
  let totalActualizados = 0;
  // NUEVO (fix, mismo motivo que en sincronizarTodoTME): registramos qué símbolos SÍ han
  // devuelto datos frescos en esta pasada, para no borrar el resto de la hoja.
  const idsConDatos = {};

  for (let i = 0; i < datosComp.length; i++) {
    const idComponente = datosComp[i][colId];
    const urlLCSC = datosComp[i][colUrl];

    if (urlLCSC && String(urlLCSC).includes("lcsc.com")) {
      const datosLCSC = obtenerDatosLCSC(String(urlLCSC).trim());

      if (datosLCSC && datosLCSC.prices.length > 0) {
        datosLCSC.prices.sort((a, b) => a.uds - b.uds).forEach(item => {
          todasLasFilas.push([String(idComponente), item.uds, Number((item.uds * item.precioUnitario).toFixed(4)), datosLCSC.stock]);
        });
        totalActualizados++;
        idsConDatos[String(idComponente)] = true;
      } else {
        Logger.log("No se pudieron obtener datos para: " + idComponente);
      }

      if (i < datosComp.length - 1) {
        Utilities.sleep(1500);
      }
    }
  }

  // MODIFICADO (fix): antes esto borraba TODA la hoja Variantes_LCSC y la reescribía solo con lo
  // que hubiera venido bien en ESTA pasada -- un fallo puntual al leer un solo producto de LCSC
  // (p.ej. un timeout) le borraba el stock/precio que ya tenía guardado de una sincronización
  // anterior. Ahora solo se sustituyen las filas de los símbolos que SÍ se han vuelto a
  // sincronizar con éxito; el resto se conserva tal cual estaba (ver fusionarFilasVariantes).
  fusionarFilasVariantes(sheetLCSC, idsConDatos, todasLasFilas);
  ordenarVariantes(sheetLCSC);

  // NUEVO: se indica la tasa USD->EUR aplicada en esta pasada (ver obtenerTasaCambioUSDaEUR) para
  // que quede constancia de con qué tipo de cambio se calcularon estos precios.
  const tasaUsada = obtenerTasaCambioUSDaEUR();
  return `Sincronizados ${totalActualizados} componentes desde LCSC (tasa USD→EUR aplicada: ${tasaUsada}).`;
}

// NUEVA FUNCIÓN UI: Lanza la función pura y muestra alerta
/**
 * NUEVO: Sistema de "sustituciones" — cuando un componente descatalogado se reemplaza por
 * otro con un ID_Componente distinto (mismo valor eléctrico, pero otro fabricante/proveedor,
 * p.ej. Panasonic EEUFS0J221 sustituido por un Rubycon con su propio part number), se apunta
 * aquí qué ID nuevo sustituye a qué ID original. Así "Actualizar Col Kits", "Actualizar Col
 * Proveedores (Kits)" y "Actualizar Col Pack/Precio (Kits)" tratan ambos IDs como el mismo
 * "grupo" automáticamente, sin tener que tocar Kits_Consolas cada vez que sustituyes algo.
 * Hoja "Sustituciones": columna A = ID_Nuevo, columna B = ID_Original, columna C = Nota (libre).
 * Se crea sola (vacía) la primera vez que se ejecuta cualquiera de esas sincronizaciones.
 */
function obtenerOCrearHojaSustituciones() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Sustituciones");
  if (!sheet) {
    sheet = ss.insertSheet("Sustituciones");
    sheet.getRange(1, 1, 1, 3).setValues([["ID_Nuevo", "ID_Original", "Nota"]]);
  }
  return sheet;
}

function abrirHojaSustitucionesUI() {
  obtenerOCrearHojaSustituciones().activate();
}

// Devuelve { ID_Nuevo: ID_Original, ... } a partir de la hoja "Sustituciones"
function cargarMapaSustituciones() {
  const sheet = obtenerOCrearHojaSustituciones();
  const mapa = {};
  const datos = sheet.getDataRange().getValues();
  datos.shift(); // cabecera
  datos.forEach(function(row) {
    const idNuevo = String(row[0] || '').trim();
    const idOriginal = String(row[1] || '').trim();
    if (idNuevo && idOriginal) mapa[idNuevo] = idOriginal;
  });
  return mapa;
}

function actualizarColumnaProveedoresKitsUI() {
  try {
    const msg = actualizarColumnaProveedoresKits();
    SpreadsheetApp.getUi().alert("✅ " + msg);
  } catch (err) {
    SpreadsheetApp.getUi().alert("❌ Error: " + err.message);
  }
}

/**
 * NUEVO: Rellena la columna L de "Kits_Consolas" con los proveedores donde está
 * disponible cada componente (columna F = ID_Componente): LCSC / AliExpress / TME,
 * separados por " / ". El nombre del proveedor se pinta en ROJO si ahora mismo no
 * tiene stock (según Variantes_LCSC / Variantes_AliExpress / Variantes_TME), y se
 * deja en color normal si sí tiene stock. Un componente puede aparecer en varias
 * hojas de Variantes a la vez si tiene fila propia para cada proveedor en Componentes
 * (mismo patrón que las filas TME duplicadas).
 * Llamable desde el menú de Sheets (UI) y también desde la web (doPost, acción
 * 'sync_proveedores_kits'), igual que el resto de sincronizaciones.
 */
function actualizarColumnaProveedoresKits() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetKits = ss.getSheetByName("Kits_Consolas");
  const sheetComp = ss.getSheetByName("Componentes");
  const sheetLCSC = ss.getSheetByName("Variantes_LCSC");
  const sheetAli = ss.getSheetByName("Variantes_AliExpress");
  const sheetTME = ss.getSheetByName("Variantes_TME");
  if (!sheetKits || !sheetComp) throw new Error("No se encuentran las hojas 'Kits_Consolas' o 'Componentes'.");

  const COL_DESTINO = 12; // L
  const NOMBRE_CABECERA = 'Proveedores_Disponibles';

  // NUEVO: Aseguramos que la columna L tenga cabecera fija, así la web (que solo lee el CSV
  // publicado, sin colores) puede identificar esta columna por su nombre y pintarla ella misma.
  const celdaCabecera = sheetKits.getRange(1, COL_DESTINO);
  if (String(celdaCabecera.getValue() || '').trim() === '') {
    celdaCabecera.setValue(NOMBRE_CABECERA);
  }

  const sustituciones = cargarMapaSustituciones();

  // 1. Indexamos las filas de Componentes por su propio ID_Componente literal, guardando también
  //    su proveedor y marca (para poder distinguir dos filas del mismo proveedor para el mismo
  //    ID, p.ej. Panasonic y Rubycon ambos en LCSC).
  const datosComp = sheetComp.getDataRange().getValues();
  const headersComp = datosComp.shift().map(function(h) { return String(h).trim(); });
  const colIdComp = headersComp.indexOf('ID_Componente');
  const colProv = headersComp.indexOf('Proveedor_Preferido');
  const colMarca = headersComp.indexOf('Marca_Top');
  if (colIdComp === -1 || colProv === -1) {
    throw new Error("Faltan columnas 'ID_Componente' o 'Proveedor_Preferido' en Componentes.");
  }

  // MODIFICADO (fix): antes se agrupaba por "grupo" (fusionando el ID original y su sustituto en
  // el mismo cubo), así que un componente que SOLO está registrado en AliExpress (p.ej.
  // FUSE-PICO-1.5A-AXIAL) aparecía TAMBIÉN con LCSC/TME -- que en realidad son proveedores de su
  // sustituto (025101.5MXL), no suyos, y con el stock del sustituto. Ahora cada fila de
  // Componentes se indexa por su propio ID_Componente literal (sin fusionar), así cada fila de
  // Kits_Consolas muestra SOLO sus proveedores y stock reales, aunque tenga un sustituto.
  const filasPorLiteralId = {};
  datosComp.forEach(function(row) {
    const literalId = String(row[colIdComp] || '').trim();
    const prov = String(row[colProv] || '').trim().toUpperCase();
    if (!literalId || !prov) return;
    if (!filasPorLiteralId[literalId]) filasPorLiteralId[literalId] = [];
    filasPorLiteralId[literalId].push({
      literalId: literalId,
      clave: prov,
      marca: colMarca !== -1 ? String(row[colMarca] || '').trim() : ''
    });
  });

  // NUEVO: mapa inverso (ID_Original -> [ID_Nuevo, ...]) para poder señalar la relación de
  // sustitución en los dos sentidos -- tanto desde el ID nuevo/de marca hacia el original que
  // sustituye, como al revés (desde el original hacia el/los nuevo(s) que lo sustituyen).
  const sustitutosPorOriginal = {};
  Object.keys(sustituciones).forEach(function(idNuevo) {
    const idOriginal = sustituciones[idNuevo];
    if (!sustitutosPorOriginal[idOriginal]) sustitutosPorOriginal[idOriginal] = [];
    sustitutosPorOriginal[idOriginal].push(idNuevo);
  });
  function obtenerSustitutosDe(id) {
    if (sustituciones[id]) return [sustituciones[id]];
    return sustitutosPorOriginal[id] || [];
  }

  // 2. Mapa ID_Componente -> stock total, por cada hoja de variantes (col A = ID, col D = Stock_Packs)
  function mapaStockDesde(sheet) {
    const mapa = {};
    if (!sheet) return mapa;
    const datos = sheet.getDataRange().getValues();
    datos.shift(); // cabecera
    datos.forEach(function(row) {
      const id = String(row[0] || '').trim();
      if (!id) return;
      const stock = Number(row[3]) || 0;
      mapa[id] = (mapa[id] || 0) + stock;
    });
    return mapa;
  }

  const ORDEN_PROVEEDORES = [
    { clave: 'LCSC', etiqueta: 'LCSC', mapaStock: mapaStockDesde(sheetLCSC) },
    { clave: 'ALIEXPRESS', etiqueta: 'AliExpress', mapaStock: mapaStockDesde(sheetAli) },
    { clave: 'TME', etiqueta: 'TME', mapaStock: mapaStockDesde(sheetTME) }
  ];

  // 3. Leer ID_Componente de cada fila de Kits_Consolas (columna F, localizada por cabecera)
  let datosKits = sheetKits.getDataRange().getValues();
  const headersKits = datosKits.shift().map(function(h) { return String(h).trim(); });
  const colIdKitsComp = headersKits.indexOf('ID_Componente');
  if (colIdKitsComp === -1) throw new Error("No se encuentra la columna 'ID_Componente' en Kits_Consolas.");

  // NUEVO (fix): acotamos a la última fila con ID_Componente real -- ver obtenerUltimaFilaRealKits.
  // Sin esto, sheetKits.getDataRange() puede devolver muchas más filas de las reales (llegó a
  // 1006 aquí, con solo ~30 filas de datos), porque esta misma función ya había "ensuciado" antes
  // la columna L escribiendo en filas vacías.
  const ultimaFilaRealKits = obtenerUltimaFilaRealKits(datosKits, colIdKitsComp);
  datosKits = datosKits.slice(0, ultimaFilaRealKits - 1);

  if (datosKits.length === 0) return "No hay filas en Kits_Consolas.";

  const ROJO = '#e53935';
  const richTextValues = [];

  datosKits.forEach(function(row) {
    const id = String(row[colIdKitsComp] || '').trim();
    if (!id) {
      richTextValues.push([SpreadsheetApp.newRichTextValue().setText('').build()]);
      return;
    }

    // MODIFICADO (fix): ya no se fusiona con el grupo del sustituto -- "entradas" son solo las
    // filas de Componentes registradas para ESTE ID literal.
    const entradas = filasPorLiteralId[id] || [];

    // NUEVO: si este ID tiene un sustituto (en cualquiera de los dos sentidos), lo señalamos con
    // una nota aparte "💬 Sustituto: ..." al final del texto -- así se ve la relación entre las
    // dos filas sin mezclar sus proveedores/stock reales.
    const sustitutos = obtenerSustitutosDe(id);
    const notaSustituto = sustitutos.length > 0 ? (' 💬 Sustituto: ' + sustitutos.join(', ')) : '';

    if (entradas.length === 0) {
      const textoVacio = '(sin proveedor asignado)' + notaSustituto;
      const builderVacio = SpreadsheetApp.newRichTextValue().setText(textoVacio);
      if (notaSustituto) {
        builderVacio.setTextStyle(
          textoVacio.length - notaSustituto.length, textoVacio.length,
          SpreadsheetApp.newTextStyle().setForegroundColor('#3b82f6').build()
        );
      }
      richTextValues.push([builderVacio.build()]);
      return;
    }

    // Recorremos en el orden LCSC -> AliExpress -> TME; si dentro de un proveedor hay más de una
    // fila (p.ej. dos en LCSC por dos marcas distintas), añadimos la marca entre paréntesis para distinguirlas.
    const partes = [];
    ORDEN_PROVEEDORES.forEach(function(p) {
      const entradasProveedor = entradas.filter(function(e) { return e.clave === p.clave; });
      entradasProveedor.forEach(function(entrada) {
        const stock = p.mapaStock[entrada.literalId] || 0;
        const conStock = stock > 0;
        const necesitaDesambiguar = entradasProveedor.length > 1;
        const etiquetaBase = necesitaDesambiguar
          ? `${p.etiqueta} (${entrada.marca || entrada.literalId})`
          : p.etiqueta;
        // NOTA: el color de celda NO viaja por el CSV publicado que lee la web, así que
        // marcamos "sin stock" también con un prefijo ❌ en el propio texto: la web lo
        // detecta y lo pinta en rojo ella misma (ver ui.js). En Sheets, además, coloreamos
        // de verdad la celda para que se vea bien aquí también.
        const textoConMarcador = conStock ? etiquetaBase : ('❌' + etiquetaBase);
        partes.push({ texto: textoConMarcador, conStock: conStock });
      });
    });

    let texto = '';
    partes.forEach(function(p, i) { texto += (i > 0 ? ' / ' : '') + p.texto; });
    const finPartes = texto.length;
    texto += notaSustituto;

    const builder = SpreadsheetApp.newRichTextValue().setText(texto);
    let cursor = 0;
    partes.forEach(function(p, i) {
      if (i > 0) cursor += 3; // longitud de " / "
      const inicio = cursor;
      const fin = cursor + p.texto.length;
      if (!p.conStock) {
        builder.setTextStyle(inicio, fin, SpreadsheetApp.newTextStyle().setForegroundColor(ROJO).build());
      }
      cursor = fin;
    });
    if (notaSustituto) {
      // NUEVO: nota de sustitución en azul, para distinguirla claramente de los proveedores reales.
      builder.setTextStyle(finPartes, texto.length, SpreadsheetApp.newTextStyle().setForegroundColor('#3b82f6').build());
    }

    richTextValues.push([builder.build()]);
  });

  sheetKits.getRange(2, COL_DESTINO, richTextValues.length, 1).setRichTextValues(richTextValues);

  // NUEVO (fix): limpiamos cualquier resto por debajo de las filas reales, para no seguir
  // arrastrando (y re-escribiendo) el inflado en la próxima sincronización.
  limpiarSobrantesKits(sheetKits, COL_DESTINO, richTextValues.length + 1);

  return `Columna de proveedores actualizada para ${richTextValues.length} filas de Kits_Consolas.`;
}

function actualizarColumnaPackPrecioKitsUI() {
  try {
    const msg = actualizarColumnaPackPrecioKits();
    SpreadsheetApp.getUi().alert("✅ " + msg);
  } catch (err) {
    SpreadsheetApp.getUi().alert("❌ Error: " + err.message);
  }
}

/**
 * NUEVO: Rellena la columna M de "Kits_Consolas" ("Uds_Pack - Precio_Unid") con, para cada
 * proveedor que tenga el componente (mismo orden que la columna L, "Proveedores_Disponibles"),
 * el tamaño de pack y precio unitario tal cual figuran en Componentes (columnas Uds_Pack /
 * Precio_Unitario), con formato "(20pack - 0,11€)". Si hay varios proveedores se listan
 * separados por " - ": "(150pack - 0,21€) - (100pack - 0,17€)". Si ese proveedor concreto no
 * tiene stock ahora mismo (Variantes_*), se deja en "(0pack - 0€)" en vez del valor real.
 * Llamable desde el menú de Sheets (UI) y desde la web (doPost, acción 'sync_pack_precio_kits').
 */
function actualizarColumnaPackPrecioKits() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetKits = ss.getSheetByName("Kits_Consolas");
  const sheetComp = ss.getSheetByName("Componentes");
  const sheetLCSC = ss.getSheetByName("Variantes_LCSC");
  const sheetAli = ss.getSheetByName("Variantes_AliExpress");
  const sheetTME = ss.getSheetByName("Variantes_TME");
  if (!sheetKits || !sheetComp) throw new Error("No se encuentran las hojas 'Kits_Consolas' o 'Componentes'.");

  const COL_DESTINO = 13; // M
  const NOMBRE_CABECERA = 'Uds_Pack - Precio_Unid';

  const celdaCabecera = sheetKits.getRange(1, COL_DESTINO);
  if (String(celdaCabecera.getValue() || '').trim() === '') {
    celdaCabecera.setValue(NOMBRE_CABECERA);
  }

  // MODIFICADO (fix): ya no hace falta cargar el mapa de sustituciones aquí -- esta columna ya
  // no fusiona componente + sustituto (ver actualizarColumnaProveedoresKits para el motivo).
  // 1. Indexamos las filas de Componentes por su propio ID_Componente literal, guardando por
  //    cada fila su proveedor, Uds_Pack y Precio_Unitario.
  const datosComp = sheetComp.getDataRange().getValues();
  const headersComp = datosComp.shift().map(function(h) { return String(h).trim(); });
  const colIdComp = headersComp.indexOf('ID_Componente');
  const colProv = headersComp.indexOf('Proveedor_Preferido');
  const colUdsPack = headersComp.indexOf('Uds_Pack');
  const colPrecioUnit = headersComp.indexOf('Precio_Unitario');
  if (colIdComp === -1 || colProv === -1 || colUdsPack === -1 || colPrecioUnit === -1) {
    throw new Error("Faltan columnas 'ID_Componente', 'Proveedor_Preferido', 'Uds_Pack' o 'Precio_Unitario' en Componentes.");
  }

  // MODIFICADO (fix): igual que en actualizarColumnaProveedoresKits -- ya no se fusiona por
  // "grupo" (componente + sustituto), porque eso hacía que un componente sin fila propia en un
  // proveedor mostrase el pack/precio del OTRO componente de la pareja. Cada fila de Componentes
  // se indexa ahora por su propio ID_Componente literal.
  const filasPorLiteralId = {};
  datosComp.forEach(function(row) {
    const literalId = String(row[colIdComp] || '').trim();
    const prov = String(row[colProv] || '').trim().toUpperCase();
    if (!literalId || !prov) return;
    if (!filasPorLiteralId[literalId]) filasPorLiteralId[literalId] = [];
    filasPorLiteralId[literalId].push({
      literalId: literalId,
      clave: prov,
      uds: Number(row[colUdsPack]) || 0,
      precio: Number(row[colPrecioUnit]) || 0
    });
  });

  // 2. Mapa ID_Componente -> stock total, por cada hoja de variantes (col A = ID, col D = Stock_Packs)
  function mapaStockDesde(sheet) {
    const mapa = {};
    if (!sheet) return mapa;
    const datos = sheet.getDataRange().getValues();
    datos.shift(); // cabecera
    datos.forEach(function(row) {
      const id = String(row[0] || '').trim();
      if (!id) return;
      const stock = Number(row[3]) || 0;
      mapa[id] = (mapa[id] || 0) + stock;
    });
    return mapa;
  }

  const ORDEN_PROVEEDORES = [
    { clave: 'LCSC', mapaStock: mapaStockDesde(sheetLCSC) },
    { clave: 'ALIEXPRESS', mapaStock: mapaStockDesde(sheetAli) },
    { clave: 'TME', mapaStock: mapaStockDesde(sheetTME) }
  ];

  // 3. Leer ID_Componente de cada fila de Kits_Consolas (localizada por cabecera)
  let datosKits = sheetKits.getDataRange().getValues();
  const headersKits = datosKits.shift().map(function(h) { return String(h).trim(); });
  const colIdKitsComp = headersKits.indexOf('ID_Componente');
  if (colIdKitsComp === -1) throw new Error("No se encuentra la columna 'ID_Componente' en Kits_Consolas.");

  // NUEVO (fix): acotamos a la última fila con ID_Componente real (ver obtenerUltimaFilaRealKits
  // y el mismo comentario en actualizarColumnaProveedoresKits).
  const ultimaFilaRealKits = obtenerUltimaFilaRealKits(datosKits, colIdKitsComp);
  datosKits = datosKits.slice(0, ultimaFilaRealKits - 1);

  if (datosKits.length === 0) return "No hay filas en Kits_Consolas.";

  // MODIFICADO (fix): esto es un precio POR UNIDAD (columna "Precio_Unitario" de Componentes),
  // no un importe total -- se muestra a 4 decimales, igual que LCSC/TME en sus fichas de
  // producto (ej. "€ 0.0759"), en vez de a 2. Redondear a 2 decimales un precio/unidad pequeño
  // (0,09€ en vez de 0,0852€) hacía parecer que había un descuadre al comparar con la web real.
  function formatearPrecio(n) {
    return (Math.round(n * 10000) / 10000).toFixed(4).replace('.', ',');
  }

  const valoresSalida = datosKits.map(function(row) {
    const id = String(row[colIdKitsComp] || '').trim();
    if (!id) return [''];

    // MODIFICADO (fix): "entradas" son solo las filas de Componentes registradas para ESTE ID
    // literal (ya no se fusionan con las de su sustituto).
    const entradas = filasPorLiteralId[id] || [];
    if (entradas.length === 0) return ['(sin proveedor asignado)'];

    // Mismo orden (LCSC -> AliExpress -> TME) y mismo agrupado por fila que en la columna L,
    // así una sustitución con dos filas en el mismo proveedor saca dos grupos "(pack - precio)".
    const partes = [];
    ORDEN_PROVEEDORES.forEach(function(p) {
      entradas
        .filter(function(e) { return e.clave === p.clave; })
        .forEach(function(entrada) {
          const stock = p.mapaStock[entrada.literalId] || 0;
          if (stock <= 0) {
            partes.push('(0pack - 0€)');
          } else {
            partes.push(`(${entrada.uds}pack - ${formatearPrecio(entrada.precio)}€)`);
          }
        });
    });

    return [partes.join(' - ')];
  });

  sheetKits.getRange(2, COL_DESTINO, valoresSalida.length, 1).setValues(valoresSalida);

  // NUEVO (fix): limpiamos cualquier resto por debajo de las filas reales, para no seguir
  // arrastrando (y re-escribiendo) el inflado en la próxima sincronización.
  limpiarSobrantesKits(sheetKits, COL_DESTINO, valoresSalida.length + 1);

  return `Columna "Uds_Pack - Precio_Unid" actualizada para ${valoresSalida.length} filas de Kits_Consolas.`;
}

// NUEVA FUNCIÓN UI: Lanza la función pura y muestra alerta
function actualizarColumnaKitsUsadosUI() {
  try {
    const msg = actualizarColumnaKitsUsados();
    SpreadsheetApp.getUi().alert("✅ " + msg);
  } catch (err) {
    SpreadsheetApp.getUi().alert("❌ Error: " + err.message);
  }
}

// NUEVA FUNCIÓN PURA: Actualiza físicamente la columna R "Kits_que_lo_usan" (llamable desde Web y UI)
function actualizarColumnaKitsUsados() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  const sheetKits = ss.getSheetByName("Kits_Consolas");

  if (!sheetComp || !sheetKits) throw new Error("No se encuentran las hojas 'Componentes' o 'Kits_Consolas'.");

  // 1. Leer datos de Kits
  let datosKits = sheetKits.getDataRange().getValues();
  const headersKits = datosKits.shift().map(h => String(h).trim());
  const colIdCompKit = headersKits.indexOf('ID_Componente');
  const colIdKit = headersKits.indexOf('ID_Kit');

  if (colIdCompKit === -1 || colIdKit === -1) throw new Error("No se encuentran las columnas en la hoja Kits.");

  // NUEVO (fix): acotamos a la última fila con ID_Componente real -- ver obtenerUltimaFilaRealKits.
  const ultimaFilaRealKits = obtenerUltimaFilaRealKits(datosKits, colIdCompKit);
  datosKits = datosKits.slice(0, ultimaFilaRealKits - 1);

  // Mapear qué kits usan cada componente
  const mapaKits = {};
  datosKits.forEach(row => {
    const idComp = String(row[colIdCompKit]).trim();
    const idKit = String(row[colIdKit]).trim();
    if (idComp && idKit) {
      if (!mapaKits[idComp]) mapaKits[idComp] = new Set();
      mapaKits[idComp].add(idKit);
    }
  });

  // 2. Leer datos de Componentes
  const datosComp = sheetComp.getDataRange().getValues();
  const headersComp = datosComp.shift().map(h => String(h).trim()); // MODIFICADO: Trim para evitar espacios invisibles
  const colIdComp = headersComp.indexOf('ID_Componente');
  const colKitsUsados = headersComp.indexOf('Kits_que_lo_usan'); // Columna R

  if (colIdComp === -1 || colKitsUsados === -1) throw new Error("No se encuentran las columnas en la hoja Componentes. Asegúrate de que la columna R se llame 'Kits_que_lo_usan'.");

  // NUEVO: Si un componente es un sustituto (tiene entrada en la hoja "Sustituciones"), heredamos
  // los kits del ID original al que sustituye, aunque Kits_Consolas siga apuntando al ID antiguo.
  const sustituciones = cargarMapaSustituciones();

  // 3. Actualizar la columna R en la hoja Componentes
  let actualizados = 0;
  for (let i = 0; i < datosComp.length; i++) {
    const idComp = String(datosComp[i][colIdComp]).trim();
    const grupo = sustituciones[idComp] || idComp;
    const kitsUsados = mapaKits[grupo] ? Array.from(mapaKits[grupo]).join(', ') : '';

    sheetComp.getRange(i + 2, colKitsUsados + 1).setValue(kitsUsados);
    if (kitsUsados) actualizados++;
  }

  return `Columna 'Kits_que_lo_usan' actualizada. Se han registrado kits para ${actualizados} componentes.`;
}

function probarDiagnosticoLCSC() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetComp = ss.getSheetByName("Componentes");
  let urlPrueba = "https://www.lcsc.com/product-detail/C89321.html";

  if (sheetComp && ss.getActiveSheet().getName() === "Componentes") {
    const filaActual = sheetComp.getActiveCell().getRow();
    if (filaActual >= 2) {
      const urlFila = sheetComp.getRange(filaActual, 11).getValue();
      if (urlFila && String(urlFila).includes("lcsc.com")) urlPrueba = String(urlFila).trim();
    }
  }

  const res = obtenerDatosLCSC(urlPrueba);
  if (!res) return SpreadsheetApp.getUi().alert("Error al obtener datos.");
  SpreadsheetApp.getUi().alert(`URL: ${urlPrueba}\nStock: ${res.stock}\nTramos: ${res.prices.length}`);
}

function limpiarVariantesExistentes(sheet, idComponente) {
  const datos = sheet.getDataRange().getValues();
  for (let i = datos.length - 1; i >= 1; i--) {
    if (String(datos[i][0]) === idComponente) sheet.deleteRow(i + 1);
  }
}

/**
 * NUEVO (fix): sustituye en una hoja de Variantes (LCSC/TME) SOLO las filas de los símbolos que
 * se han vuelto a sincronizar con éxito en esta pasada (idsConDatosNuevos), dejando intactas las
 * filas de cualquier otro símbolo -- incluidos los que se intentaron pero fallaron esta vez.
 * ANTES, sincronizarTodoLCSC/sincronizarTodoTME BORRABAN toda la hoja y la reescribían solo con
 * lo que hubiera venido bien en ESA pasada: un fallo puntual de un solo componente (algo
 * frecuente en TME, ver obtenerDatosTMEBatchChunked) le borraba el stock/precio que YA tenía
 * bien guardado de una sincronización anterior, dejándolo "sin stock" aunque siguiera teniendo
 * stock real -- exactamente el síntoma que reportó el usuario con 025101.5MXL.
 * @param sheet Hoja Variantes_LCSC o Variantes_TME.
 * @param idsConDatosNuevos Objeto { idComponente: true, ... } -- símbolos con datos frescos AHORA.
 * @param filasNuevas Array de filas [idComponente, uds, precioPackTotal, stock] recién obtenidas.
 */
function fusionarFilasVariantes(sheet, idsConDatosNuevos, filasNuevas) {
  const ultimaFila = sheet.getLastRow();
  const filasExistentes = ultimaFila > 1
    ? sheet.getRange(2, 1, ultimaFila - 1, 4).getValues()
    : [];

  // Conservamos toda fila existente cuyo símbolo NO se haya vuelto a sincronizar con éxito
  // ahora mismo (ya sea porque falló esta pasada, o porque ni siquiera se intentó).
  const filasConservadas = filasExistentes.filter(function(row) {
    return !idsConDatosNuevos[String(row[0])];
  });

  const filasFinales = filasConservadas.concat(filasNuevas);

  if (ultimaFila > 1) {
    sheet.getRange(2, 1, ultimaFila - 1, sheet.getLastColumn()).clearContent();
  }
  if (filasFinales.length > 0) {
    sheet.getRange(2, 1, filasFinales.length, 4).setValues(filasFinales);
  }
}

function ordenarVariantes(sheetVar) {
  const ultimaFila = sheetVar.getLastRow();
  if (ultimaFila < 3) return;
  const rangoDatos = sheetVar.getRange(2, 1, ultimaFila - 1, 4);
  rangoDatos.sort([{ column: 1, ascending: true }, { column: 2, ascending: true }]);
}

/**
 * =====================================================
 * SISTEMA WEB API (PARA GITHUB PAGES)
 * =====================================================
 */
function doGet(e) {
  const callback = e.parameters.callback;
  let sheetName = e.parameters.sheet || 'Componentes';
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error("Pestaña no encontrada");
    const data = sheet.getDataRange().getValues();
    if (data.length === 0) throw new Error("Pestaña vacía");
    const headers = data.shift();
    const jsonData = data.map(function(row) {
      let obj = {};
      headers.forEach(function(header, index) {
        let cleanHeader = String(header).replace(/\r?\n|\r/g, ' ').trim();
        obj[cleanHeader] = row[index];
      });
      return obj;
    });
    const jsonString = JSON.stringify(jsonData);
    if (callback) return ContentService.createTextOutput(callback + "(" + jsonString + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(jsonString).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === 'sync_lcsc') {
      const msg = sincronizarTodoLCSC();
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'update_aliexpress_manual') {
      const msg = guardarVarianteManual(payload.idComponente, payload.udsPack, payload.precioPack, payload.stockPacks);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO: Acción para sincronizar TODO TME automáticamente (equivalente a sync_lcsc)
    if (action === 'sync_tme') {
      const msg = sincronizarTodoTME();
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO: Acción para guardar variante manual de TME
    if (action === 'update_tme_manual') {
      const msg = guardarVarianteManualTME(payload.idComponente, payload.udsPack, payload.precioPack, payload.stockPacks);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO: Acción para sincronizar la columna R desde la web
    if (action === 'sync_kits_usados') {
      const msg = actualizarColumnaKitsUsados();
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO: Acción para sincronizar la columna L de Kits_Consolas (proveedores/stock) desde la web
    if (action === 'sync_proveedores_kits') {
      const msg = actualizarColumnaProveedoresKits();
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO: Acción para sincronizar la columna M de Kits_Consolas (pack/precio unitario) desde la web
    if (action === 'sync_pack_precio_kits') {
      const msg = actualizarColumnaPackPrecioKits();
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO: Acción para el modal "➕ Añadir Stock" de la pestaña Stock Físico -- suma la cantidad
    // indicada al stock existente de ese componente (o crea la fila si todavía no tenía ninguna).
    if (action === 'update_stock_manual') {
      const msg = guardarStockManual(payload.idComponente, payload.cantidad);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO (2026-09-09): Acción para el modal "🚚 Añadir Stock en Camino" de la pestaña Stock
    // Físico -- registra material ya pedido a un proveedor pero que todavía no ha llegado.
    if (action === 'update_stock_en_camino') {
      const msg = guardarStockEnCamino(payload.idComponente, payload.cantidad);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO (2026-09-09): Acción para el botón "✅ Recibir" por fila de la pestaña Stock Físico --
    // traspasa (parcial o totalmente) unidades de "Stock_En_Camino" a "Uds_Disponibles".
    if (action === 'recibir_stock_en_camino') {
      const msg = recibirStockEnCamino(payload.idComponente, payload.cantidad);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO (2026-09-10): Acción para el formulario "📦 Nuevo Pedido" de la pestaña Stock Físico --
    // registra el pedido (cabecera + líneas) y actualiza el coste medio ponderado de Stock_Almacen.
    if (action === 'guardar_pedido_completo') {
      const msg = guardarPedidoCompleto(payload.pedido);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // NUEVO: Acción para el botón único "Sincronizar Todo" de la web -- encadena LCSC + TME +
    // las 3 columnas derivadas de Kits_Consolas en una sola llamada (mismo botón que en Sheets).
    if (action === 'sync_todo') {
      const msg = ejecutarSincronizacionCompleta(false);
      return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": msg}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sheetName = e.parameters.sheet || 'Stock_Almacen';
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error("Pestaña no encontrada para escribir");

    const dataRange = sheet.getDataRange().getValues();
    const headers = dataRange.shift().map(h => String(h).trim());
    const idColIndex = headers.indexOf('ID_Componente');
    const targetColIndex = headers.indexOf(payload.columna_objetivo);

    if (idColIndex !== -1 && targetColIndex !== -1) {
      for (let i = 0; i < dataRange.length; i++) {
        if (String(dataRange[i][idColIndex]) === String(payload.id_componente)) {
          sheet.getRange(i + 2, targetColIndex + 1).setValue(payload.nuevo_valor);
          break;
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({"status": "success", "message": "Actualizado correctamente"}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}