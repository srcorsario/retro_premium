// js/ui.js
import ENV from './config.js';

// Clave para guardar la configuración de columnas en LocalStorage
const LS_COL_VISIBILITY = 'retro_premium_col_visibility';
// NUEVO: Clave separada para la visibilidad de columnas de la pestaña Kits (no comparte ajustes con Componentes)
const LS_COL_VISIBILITY_KITS = 'retro_premium_col_visibility_kits';

export function renderTabla(contenedorID, datos, nombrePestana, extra) {
    const container = document.getElementById(contenedorID);
    // Manejo defensivo del DOM
    if (!container) return;
    
    if (!datos || datos.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-secondary);">No hay datos para mostrar en ${nombrePestana}.</p>`;
        return;
    }

    // Filtrar filas vacías típicas de Google Sheets
    const datosLimpios = datos.filter(row => 
        Object.values(row).some(val => val !== '' && val !== null && val !== undefined)
    ).slice(0, ENV.MAX_TABLE_ROWS);

    // Si es la pestaña de Kits, usamos la lógica del acordeón (con los mismos toggles de columnas que Componentes)
    if (nombrePestana === 'Kits_Consolas') {
        const allHeadersKits = Object.keys(datosLimpios[0]);

        let hiddenColsKits = [];
        const savedColsKits = localStorage.getItem(LS_COL_VISIBILITY_KITS);
        if (savedColsKits) {
            try {
                hiddenColsKits = JSON.parse(savedColsKits);
            } catch (e) {
                hiddenColsKits = [];
            }
        }

        const visibleHeadersKits = allHeadersKits.filter(h => !hiddenColsKits.includes(h));

        // Inyectar los toggles antes del acordeón
        let toggleHtmlKits = '<div class="col-toggle-container">';
        allHeadersKits.forEach(h => {
            const isChecked = visibleHeadersKits.includes(h);
            toggleHtmlKits += `
                <label class="col-toggle-item">
                    <input type="checkbox" data-col="${h}" ${isChecked ? 'checked' : ''}>
                    ${h}
                </label>`;
        });
        toggleHtmlKits += '</div>';

        // NUEVO: precio total estimado por kit (calculado en app.js -- ver calcularPreciosPorKit),
        // recibido aquí como extra.preciosPorKit = { ID_Kit: {total, incompleto, desglose} }.
        const preciosPorKit = extra && extra.preciosPorKit;
        // NUEVO: tamaño de lote (nº de kits que se piden de golpe) usado para prorratear el envío
        // en ese precio -- casilla editable, el listener real vive en app.js (recalcularYRenderizarKits),
        // aquí solo se pinta el valor actual y se delega el evento 'change'.
        const tamanoLote = (extra && extra.tamanoLote) || 80;

        let toolbarLoteHtml = `
            <div style="margin-bottom:12px; display:flex; align-items:center; gap:8px; font-size:13px; flex-wrap:wrap;">
                <label for="kits-tamano-lote" style="color:var(--text-secondary);">📦 Kits por pedido (para prorratear envío/aduanas):</label>
                <input type="number" id="kits-tamano-lote" value="${tamanoLote}" min="1" step="1"
                    style="width:70px; padding:4px 6px; background: var(--bg-color); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px;">
            </div>`;

        container.innerHTML = toolbarLoteHtml + toggleHtmlKits;
        container.insertAdjacentHTML('beforeend', renderKitsAgrupados(datosLimpios, visibleHeadersKits, preciosPorKit, tamanoLote));

        // Listeners para los checkboxes (mismo patrón que en Componentes)
        const checkboxesKits = container.querySelectorAll('.col-toggle-item input[type="checkbox"]');
        checkboxesKits.forEach(chk => {
            chk.addEventListener('change', (e) => {
                const colName = e.target.getAttribute('data-col');
                let currentHidden = [];
                const currentSaved = localStorage.getItem(LS_COL_VISIBILITY_KITS);
                if (currentSaved) {
                    try { currentHidden = JSON.parse(currentSaved); } catch (err) {}
                }

                if (e.target.checked) {
                    currentHidden = currentHidden.filter(c => c !== colName);
                } else {
                    if (!currentHidden.includes(colName)) currentHidden.push(colName);
                }

                localStorage.setItem(LS_COL_VISIBILITY_KITS, JSON.stringify(currentHidden));
                renderTabla(contenedorID, datos, nombrePestana, extra);
            });
        });

        const tituloVista = document.getElementById('titulo-vista');
        if (tituloVista) tituloVista.innerText = `Kits y Placas Disponibles`;
        return;
    }

    // NUEVO (2026-09-09): la pestaña Stock Físico tiene su propio render -- columnas calculadas
    // (Stock en camino, Stock total), botón "Recibir" por fila y la sección "Packs que podemos
    // preparar" con el simulador de balanceo (ver renderStockAlmacen más abajo).
    if (nombrePestana === 'Stock_Almacen') {
        renderStockAlmacen(container, datosLimpios, extra);
        const tituloVista = document.getElementById('titulo-vista');
        if (tituloVista) tituloVista.innerText = `Stock Físico (${datosLimpios.length} componentes)`;
        return;
    }

    // Si es la pestaña de Variantes LCSC, AliExpress o TME, agrupamos por componente
    if (nombrePestana === 'Variantes_LCSC' || nombrePestana === 'Variantes_AliExpress' || nombrePestana === 'Variantes_TME') {
        container.innerHTML = renderVariantesAgrupadas(datosLimpios);
        const tituloVista = document.getElementById('titulo-vista');
        if (tituloVista) tituloVista.innerText = `${nombrePestana} (${datosLimpios.length} registros)`;
        return;
    }

    // --- CÓDIGO NORMAL PARA EL RESTO DE PESTAÑAS ---
    // Excluir la columna 'Kits_que_lo_usan' de los headers generales porque la inyectaremos en línea
    const allHeaders = Object.keys(datosLimpios[0]).filter(h => h !== 'Kits_que_lo_usan');
    let visibleHeaders = allHeaders;

    // Lógica de visibilidad de columnas exclusiva para "Componentes"
    if (nombrePestana === 'Componentes') {
        // Leer de LocalStorage qué columnas estamos ocultando
        let hiddenCols = [];
        const savedCols = localStorage.getItem(LS_COL_VISIBILITY);
        if (savedCols) {
            try {
                hiddenCols = JSON.parse(savedCols);
            } catch (e) {
                hiddenCols = [];
            }
        }
        
        visibleHeaders = allHeaders.filter(h => !hiddenCols.includes(h));

        // Inyectar los Toggles antes de la tabla
        let toggleHtml = '<div class="col-toggle-container">';
        allHeaders.forEach(h => {
            const isChecked = visibleHeaders.includes(h);
            toggleHtml += `
                <label class="col-toggle-item">
                    <input type="checkbox" data-col="${h}" ${isChecked ? 'checked' : ''}>
                    ${h}
                </label>`;
        });
        toggleHtml += '</div>';

        // Pintar toggles
        container.innerHTML = toggleHtml;

        // Listeners para los checkboxes (Norma 10: control de listeners)
        const checkboxes = container.querySelectorAll('.col-toggle-item input[type="checkbox"]');
        checkboxes.forEach(chk => {
            chk.addEventListener('change', (e) => {
                const colName = e.target.getAttribute('data-col');
                let currentHidden = [];
                const currentSaved = localStorage.getItem(LS_COL_VISIBILITY);
                if (currentSaved) {
                    try { currentHidden = JSON.parse(currentSaved); } catch(err) {}
                }

                if (e.target.checked) {
                    // Si se marca, lo quitamos de ocultos
                    currentHidden = currentHidden.filter(c => c !== colName);
                } else {
                    // Si se desmarca, lo añadimos a ocultos
                    if (!currentHidden.includes(colName)) currentHidden.push(colName);
                }

                localStorage.setItem(LS_COL_VISIBILITY, JSON.stringify(currentHidden));
                
                // Re-renderizar inmediatamente con los mismos datos para reflejar el cambio
                renderTabla(contenedorID, datos, nombrePestana);
            });
        });
    }

    let htmlHead = '<tr>';
    visibleHeaders.forEach(h => { htmlHead += `<th>${h}</th>`; });
    htmlHead += '</tr>';

    let htmlBody = '';
    let tableHtml = '';

    datosLimpios.forEach(fila => {
        // NOTA: la alerta de stock mínimo/crítico vivía aquí antes -- ahora Stock_Almacen tiene su
        // propio render (ver renderStockAlmacen), así que este bucle genérico ya no la necesita.
        htmlBody += `<tr>`;
        visibleHeaders.forEach(header => {
            let cellContent = fila[header] || '';

            // Agregar entre paréntesis los kits que lo usan, al lado del ID_Componente
            if (nombrePestana === 'Componentes' && header === 'ID_Componente') {
                // NUEVO: Detectar si el componente está sin stock para pintar el nombre en rojo
                const precioPack = (fila['Precio_Pack'] || '').toLowerCase();
                const esSinStock = precioPack.includes('sin stock') || precioPack.includes('no disponible');
                const estiloNombre = esSinStock ? 'style="color: #ef4444; font-weight: bold;"' : '';
                
                cellContent = `<span ${estiloNombre}>${cellContent}</span>`;
                
                if (fila['Kits_que_lo_usan']) {
                    cellContent += ` <small style="color: var(--text-secondary); font-size: 10px;">(${fila['Kits_que_lo_usan']})</small>`;
                }
            }

            htmlBody += `<td title="${fila[header] || ''}">${cellContent}</td>`; // Añadido title para ver URL completa al pasar el ratón
        });
        htmlBody += '</tr>';
    });

    tableHtml = `
        <table>
            <thead>${htmlHead}</thead>
            <tbody>${htmlBody}</tbody>
        </table>
    `;

    // Añadir la tabla respetando si ya inyectamos los toggles en "Componentes"
    if (nombrePestana === 'Componentes') {
        container.insertAdjacentHTML('beforeend', tableHtml);
    } else {
        container.innerHTML = tableHtml;
    }
}

// NUEVO: La columna "Proveedores_Disponibles" (rellenada desde Apps Script) llega como texto
// plano tipo "LCSC / ❌TME" -- el color de celda de Sheets no viaja por el CSV publicado, así
// que el ❌ es el marcador de "sin stock" y aquí lo convertimos en el span rojo correspondiente.
// MODIFICADO: si el componente tiene un sustituto (hoja Sustituciones), Apps Script añade al
// final del texto una nota "💬 Sustituto: OTRO_ID" -- la separamos ANTES de partir por " / "
// (si no, el 💬 se colaría dentro del último proveedor y rompería su formato) y la pintamos
// aparte, en azul, para reconocer la relación entre las dos filas sin mezclar sus proveedores.
function formatearProveedoresDisponibles(texto) {
    if (!texto) return '';
    let base = String(texto);
    let notaHtml = '';

    const idxNota = base.indexOf('💬');
    if (idxNota !== -1) {
        const nota = base.slice(idxNota).trim(); // "💬 Sustituto: 025101.5MXL"
        base = base.slice(0, idxNota).trim();
        notaHtml = ` <span style="color:#3b82f6; font-size:11px;" title="Componente sustituible (hoja Sustituciones) -- evidentemente, solo hace falta comprar uno de los dos">${nota}</span>`;
    }

    const proveedoresHtml = base
        .split(' / ')
        .filter(parte => parte.trim() !== '')
        .map(parte => {
            const sinStock = parte.trim().startsWith('❌');
            const nombre = parte.trim().replace(/^❌/, '');
            return sinStock
                ? `<span style="color:#ef4444; font-weight:bold;">${nombre}</span>`
                : `<span>${nombre}</span>`;
        })
        .join(' / ');

    return proveedoresHtml + notaHtml;
}

// NUEVO: precio en formato local (2 decimales, coma) -- mismo criterio que pedido.js.
function formatearPrecioLocal(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

// NUEVO: precio POR UNIDAD a 4 decimales (igual que en pedido.js y en toda la web) -- con 2
// decimales un precio/ud pequeño se ve redondeado y no cuadra al multiplicarlo a mano.
function formatearPrecioUnitarioLocal(n) {
    return (Math.round(n * 10000) / 10000).toFixed(4).replace('.', ',');
}

// NUEVO: etiqueta corta de proveedor para el popup de desglose de precio de Kits -- mismo
// mapeo que ETIQUETA_PROVEEDOR en pedido.js, duplicado aquí para no importar entre módulos solo
// por esto (mismo criterio que ya se usa con formatearPrecioLocal/formatearPrecioUnitarioLocal).
const ETIQUETA_PROVEEDOR_KIT = { LCSC: 'LCSC', ALIEXPRESS: 'AliExpress', TME: 'TME' };

// NUEVO (2026-09-09): mismo escape básico de atributos HTML que usa pedido.js localmente --
// duplicado aquí por el mismo criterio que el resto de helpers de este archivo (no importar entre
// módulos solo por una función tan pequeña).
function escaparAttrStock(texto) {
    return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// NUEVO: cantidades enteras se muestran sin decimales; si por lo que sea llega un decimal (algún
// ajuste manual raro en Sheets) se muestra con coma, igual que el resto de la web.
function formatearCantidadStock(n) {
    if (!isFinite(n)) return '0';
    if (Number.isInteger(n)) return String(n);
    return (Math.round(n * 100) / 100).toString().replace('.', ',');
}

// --- NUEVO (2026-09-09): PESTAÑA STOCK FÍSICO ---
// Render propio de Stock_Almacen (en vez del genérico): añade la columna calculada
// "Stock_En_Camino" (creada sola en la hoja la primera vez que se usa "🚚 Añadir Stock en
// Camino" -- hasta entonces se trata como 0), una columna "Stock Total" (almacén + en camino,
// que es lo que ya cuenta para los cálculos de disponibilidad de toda la web) y un botón
// "✅ Recibir" por fila cuando ese componente tiene algo en camino. Tras la tabla se añade la
// sección "📦 Packs que podemos preparar" (ver renderPacksPreparables) con el simulador de
// balanceo entre kits -- extra.preparables la trae ya calculada desde app.js.
function renderStockAlmacen(container, datos, extra) {
    let toolbarHtml = `
        <div style="margin-bottom:12px; display:flex; gap:10px; flex-wrap:wrap;">
            <button id="btn-add-stock" class="btn" style="background: var(--success);">➕ Añadir Stock</button>
            <button id="btn-add-stock-camino" class="btn" style="background: var(--primary);">🚚 Añadir Stock en Camino</button>
        </div>`;

    if (!datos || datos.length === 0) {
        container.innerHTML = toolbarHtml + `<p style="text-align:center; color:var(--text-secondary);">No hay datos de Stock Físico para mostrar.</p>`;
        return;
    }

    // Columnas que ya pintamos "a mano" con su propio cálculo -- cualquier otra columna que tenga
    // la hoja (p.ej. si el usuario añade alguna a mano en Sheets) se añade igualmente al final,
    // sin que haga falta tocar este código.
    const COLUMNAS_FIJAS = ['ID_Componente', 'Uds_Disponibles', 'Stock_En_Camino', 'Stock_Minimo_Alerta'];
    const otrasColumnas = Object.keys(datos[0]).filter(h => !COLUMNAS_FIJAS.includes(h));

    let htmlHead = '<tr><th>ID_Componente</th><th>Uds_Disponibles</th><th>Stock en Camino</th><th>Stock Total (almacén + en camino)</th>';
    otrasColumnas.forEach(h => { htmlHead += `<th>${h}</th>`; });
    htmlHead += '<th>Acciones</th></tr>';

    let htmlBody = '';
    datos.forEach(fila => {
        const idComp = fila['ID_Componente'] || '';
        const disponible = parseFloat(String(fila['Uds_Disponibles'] || '0').replace(',', '.')) || 0;
        const enCamino = parseFloat(String(fila['Stock_En_Camino'] || '0').replace(',', '.')) || 0;
        const min = parseFloat(String(fila['Stock_Minimo_Alerta'] || '0').replace(',', '.')) || 0;
        const total = disponible + enCamino;

        // Misma lógica de alerta que había antes -- se basa en lo YA disponible físicamente en
        // almacén (no en el total con lo que está en camino, que todavía no se puede usar).
        let esAlerta = false;
        if (disponible <= min && disponible > 0) esAlerta = true;
        if (disponible === 0) esAlerta = 'critico';
        const claseFila = esAlerta === 'critico' ? 'class="row-danger"' : (esAlerta ? 'class="row-warning"' : '');

        let accionesHtml = '<span style="color:var(--text-secondary);">-</span>';
        if (enCamino > 0) {
            accionesHtml = `<button class="btn-small btn-recibir-stock" data-id="${escaparAttrStock(idComp)}" data-max="${enCamino}" style="background: var(--success);">✅ Recibir</button>`;
        }

        htmlBody += `<tr ${claseFila}>
            <td title="${escaparAttrStock(idComp)}">${idComp}</td>
            <td>${formatearCantidadStock(disponible)}</td>
            <td>${enCamino > 0 ? formatearCantidadStock(enCamino) : '-'}</td>
            <td style="font-weight:bold;">${formatearCantidadStock(total)}</td>`;
        otrasColumnas.forEach(h => {
            htmlBody += `<td title="${escaparAttrStock(fila[h] || '')}">${fila[h] || ''}</td>`;
        });
        htmlBody += `<td>${accionesHtml}</td></tr>`;
    });

    const tablaHtml = `<table><thead>${htmlHead}</thead><tbody>${htmlBody}</tbody></table>`;

    let packsHtml = '';
    if (extra && extra.preparables) {
        packsHtml = renderPacksPreparables(extra.preparables);
    }

    container.innerHTML = toolbarHtml + tablaHtml + packsHtml;
}

// NUEVO (2026-09-09): sección "📦 Packs que podemos preparar" -- una fila por kit con cuántas
// unidades completas se podrían montar ahora mismo (stock físico + en camino) y un input "Vas a
// preparar" para simular repartir ese stock entre kits que comparten componentes (ver
// calcularPreparablesPorKit en app.js -- este archivo solo pinta el resultado ya calculado).
function renderPacksPreparables(preparablesExtra) {
    const porKit = preparablesExtra.porKit || {};
    const nombreConsolaPorKit = preparablesExtra.nombreConsolaPorKit || {};
    const idsKits = Object.keys(porKit);
    if (idsKits.length === 0) return '';

    idsKits.sort((a, b) => {
        const familiaA = nombreConsolaPorKit[a] || '';
        const familiaB = nombreConsolaPorKit[b] || '';
        const cmpFamilia = familiaA.localeCompare(familiaB, 'es', { sensitivity: 'base' });
        if (cmpFamilia !== 0) return cmpFamilia;
        return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
    });

    let filasHtml = '';
    idsKits.forEach(idKit => {
        const info = porKit[idKit];
        const consola = nombreConsolaPorKit[idKit] || '';
        const claseFila = info.preparables <= 0 ? 'class="row-packs-agotado"' : '';
        filasHtml += `<tr ${claseFila}>
            <td>${idKit}</td>
            <td>${consola}</td>
            <td style="font-weight:bold;">${info.preparables}</td>
            <td>${info.limitante ? escaparAttrStock(info.limitante) : '-'}</td>
            <td><input type="number" class="packs-input-reserva" data-kit="${escaparAttrStock(idKit)}" min="0" step="1" value="${info.reserva || ''}" placeholder="0"></td>
        </tr>`;
    });

    return `
        <div class="packs-section">
            <h3>📦 Packs que podemos preparar</h3>
            <p style="color:var(--text-secondary); font-size:12px; margin-top:0;">"Preparables ahora" son las unidades completas de ese kit que se podrían montar con el stock actual (almacén + en camino). Escribe en "Vas a preparar" cuántas vas a montar de un kit para simular repartir el stock entre kits que comparten componentes: verás cómo baja (o sube, si lo reduces) el número de los DEMÁS kits afectados. Es solo una simulación en esta pantalla -- no descuenta nada de verdad en Google Sheets.</p>
            <div style="overflow-x:auto;">
                <table>
                    <thead><tr>
                        <th>Kit</th>
                        <th>Consola</th>
                        <th>Preparables ahora</th>
                        <th>Componente limitante</th>
                        <th>Vas a preparar</th>
                    </tr></thead>
                    <tbody>${filasHtml}</tbody>
                </table>
            </div>
            <div style="margin-top:10px;">
                <button id="btn-reset-reparto" class="btn" style="background: var(--danger);">↺ Reiniciar reparto</button>
            </div>
        </div>`;
}

// --- LA FUNCIÓN QUE AGRUPA POR FAMILIA (ACORDEÓN) ---
// NUEVO: 2º parámetro opcional "visibleHeaders" -- si se pasa, la tabla interna de cada kit
// solo muestra esas columnas (mismo checkbox de visibilidad que ya existe en Componentes).
// NUEVO: 3º parámetro opcional "preciosPorKit" ({ ID_Kit: {total, incompleto, desglose} }, calculado
// en app.js) -- si se pasa, se muestra el precio total estimado de cada kit junto a su nombre.
// NUEVO: 4º parámetro "tamanoLote" -- nº de kits que se asume se piden de golpe, solo para el
// texto informativo del popup (el cálculo real ya viene hecho en preciosPorKit).
function renderKitsAgrupados(datos, visibleHeaders, preciosPorKit, tamanoLote) {
    const familias = {};
    
    datos.forEach(fila => {
        const nombreFamilia = fila['Consola'] || 'Familia Desconocida';
        const nombreKit = fila['ID_Kit'] || 'Kit Desconocido';
        
        if (!familias[nombreFamilia]) familias[nombreFamilia] = {};
        if (!familias[nombreFamilia][nombreKit]) familias[nombreFamilia][nombreKit] = [];
        
        familias[nombreFamilia][nombreKit].push(fila);
    });

    let htmlTotal = '';
    
    for (const [nombreFamilia, kits] of Object.entries(familias)) {
        htmlTotal += `<div class="family-group">`;
        htmlTotal += `<h3 class="family-header">🎮 ${nombreFamilia}</h3>`;
        
        for (const [nombreKit, componentes] of Object.entries(kits)) {
            htmlTotal += `<div class="kit-card">`;

            // EL BOTÓN DESPLEGABLE
            // NUEVO: si tenemos precio calculado para este kit, se muestra junto al nombre --
            // en ámbar con ⚠️ si es "incompleto" (algún componente no tiene stock real ahora
            // mismo y se ha usado su precio de referencia), en verde si el precio es 100% real.
            const precioInfo = preciosPorKit && preciosPorKit[nombreKit];
            let precioHtml = '';
            let nombreKitHtml = `📝 ${nombreKit}`;
            if (precioInfo) {
                const colorPrecio = precioInfo.incompleto ? '#eab308' : 'var(--success)';
                precioHtml = ` <span style="font-size:0.85rem; font-weight:normal; color:${colorPrecio};">💰 ${formatearPrecioLocal(precioInfo.total)}€${precioInfo.incompleto ? ' ⚠️' : ''}</span>`;

                // NUEVO: al pasar el ratón por el NOMBRE del kit (no por todo el bloque) aparece
                // un popup con el desglose línea a línea -- ver .kit-nombre-tooltip en CSS.
                // MODIFICADO 2026-09-07: cada línea ahora también muestra el proveedor elegido
                // (preselección TME, ver calcularPreciosPorKit en app.js) y su parte prorrateada
                // de envío/aduanas de ese proveedor, aparte del coste del propio componente. Este
                // precio es orientativo del kit completo -- NO descuenta tu stock físico (a
                // petición del usuario, ver comentario en calcularPreciosPorKit). Las filas sin
                // precio (ningún literal del grupo tenía Precio_Unitario) se marcan en rojo con
                // "sin precio" en vez de un importe.
                const filasDesglose = precioInfo.desglose.map(d => {
                    if (d.subtotal === null) {
                        return `<tr>
                            <td style="color:var(--danger);">${d.idComp}</td>
                            <td colspan="3" style="text-align:right; color:var(--danger);">sin precio</td>
                        </tr>`;
                    }
                    const avisoStock = d.sinStock ? ' ⚠️' : '';
                    const etiquetaProveedor = ETIQUETA_PROVEEDOR_KIT[d.proveedor] || d.proveedor || '';
                    const envioTexto = d.envioProrrateado > 0 ? `+${formatearPrecioLocal(d.envioProrrateado)}€ envío` : '—';
                    return `<tr>
                        <td>${d.idComp} <span style="color:var(--text-secondary);">(${etiquetaProveedor})</span>${avisoStock}</td>
                        <td style="text-align:right; color:var(--text-secondary);">${d.cantidad} × ${formatearPrecioUnitarioLocal(d.precioUnitario)}€</td>
                        <td style="text-align:right; color:var(--text-secondary);">${envioTexto}</td>
                        <td style="text-align:right; font-weight:bold;">${formatearPrecioLocal(d.subtotal)}€</td>
                    </tr>`;
                }).join('');

                const popupHtml = `
                    <div class="kit-tooltip-popup">
                        <div style="font-weight:bold; margin-bottom:6px; white-space:normal;">💰 Desglose de ${nombreKit} <span style="font-weight:normal; color:var(--text-secondary);">(incluye envío/aduanas prorrateados, suponiendo pedidos de ${tamanoLote || 80} kits)</span>${precioInfo.incompleto ? ' <span style="color:#eab308; font-weight:normal;">(orientativo -- ⚠️ = sin stock real ahora mismo)</span>' : ''}</div>
                        <table style="width:100%;"><tbody>
                            ${filasDesglose}
                            <tr style="border-top:1px solid var(--border-color);">
                                <td colspan="3" style="text-align:right; padding-top:6px;">Total:</td>
                                <td style="text-align:right; font-weight:bold; padding-top:6px;">${formatearPrecioLocal(precioInfo.total)}€</td>
                            </tr>
                        </tbody></table>
                    </div>`;

                nombreKitHtml = `<span class="kit-nombre-tooltip">📝 ${nombreKit}${popupHtml}</span>`;
            }
            htmlTotal += `<div class="kit-toggle" onclick="this.classList.toggle('active'); this.nextElementSibling.classList.toggle('hidden');">`;
            htmlTotal += `<span>${nombreKitHtml}${precioHtml}</span> <span class="arrow">▶</span>`;
            htmlTotal += `</div>`;
            
            // LA TABLA OCULTA
            htmlTotal += `<div class="kit-table-container hidden">`;
            const headers = (visibleHeaders && visibleHeaders.length > 0)
                ? Object.keys(componentes[0]).filter(h => visibleHeaders.includes(h))
                : Object.keys(componentes[0]);
            htmlTotal += `<table><thead><tr>`;
            headers.forEach(h => { htmlTotal += `<th>${h}</th>`; });
            htmlTotal += `</tr></thead><tbody>`;
            
            componentes.forEach(comp => {
                htmlTotal += `<tr>`;
                headers.forEach(h => {
                    if (h === 'Proveedores_Disponibles') {
                        htmlTotal += `<td title="${comp[h] || ''}">${formatearProveedoresDisponibles(comp[h])}</td>`;
                    } else {
                        htmlTotal += `<td title="${comp[h] || ''}">${comp[h] || ''}</td>`;
                    }
                });
                htmlTotal += `</tr>`;
            });
            
            htmlTotal += `</tbody></table></div></div>`; 
        }
        htmlTotal += `</div>`; 
    }
    
    return htmlTotal;
}

// --- LA FUNCIÓN QUE AGRUPA VARIANTES POR COMPONENTE (ACORDEÓN) ---
function renderVariantesAgrupadas(datos) {
    const componentes = {};
    
    // Agrupamos todas las filas que pertenezcan al mismo ID_Componente
    datos.forEach(fila => {
        const idComponente = fila['ID_Componente'] || 'Componente Desconocido';
        
        if (!componentes[idComponente]) componentes[idComponente] = [];
        componentes[idComponente].push(fila);
    });

    // NUEVO: Calcular dinámicamente el ancho de la columna del componente basado en el texto más largo
    let longestId = '';
    for (const id in componentes) {
        if (id.length > longestId.length) {
            longestId = id;
        }
    }
    
    let colWidthPx = 'max-content';
    if (longestId) {
        // Usar canvas para medir el texto exacto sin necesidad de inyectarlo en el DOM
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        context.font = "1.1rem system-ui, -apple-system, sans-serif"; // Mismo font que .kit-toggle
        const textToMeasure = `📦 ${longestId}`;
        const width = context.measureText(textToMeasure).width;
        colWidthPx = `${Math.ceil(width) + 5}px`; // +5px de margen mínimo
    }

    // NUEVO: Inyectar la variable CSS en el contenedor principal
    let htmlTotal = `<div class="family-group" style="--comp-col-width: ${colWidthPx};">`; 
    
    for (const [idComponente, variantes] of Object.entries(componentes)) {
        htmlTotal += `<div class="kit-card">`;
        
        // NUEVO: Extraer la info de los kits (todas las variantes del mismo componente comparten esta info)
        const kitsUsados = variantes[0]['Kits_que_lo_usan'] && variantes[0]['Kits_que_lo_usan'] !== 'Ninguno' 
            ? variantes[0]['Kits_que_lo_usan'] 
            : '';

        // NUEVO: Comprobar si TODAS las variantes de este componente tienen 0 stock
        const todoSinStock = variantes.every(v => parseInt(v['Stock_Packs'] || '0', 10) === 0);
        const colorNombre = todoSinStock ? 'style="color: #ef4444; font-weight: bold;"' : '';

        // EL BOTÓN DESPLEGABLE (Reutilizamos clases CSS existentes)
        htmlTotal += `<div class="kit-toggle" onclick="this.classList.toggle('active'); this.nextElementSibling.classList.toggle('hidden');">`;
        
        // MODIFICADO: Estructura en grid para alinear Componente y Kits
        htmlTotal += `<div class="kit-info-wrapper">`;
        htmlTotal += `<span class="comp-name" ${colorNombre}>📦 ${idComponente}</span>`;
        if (kitsUsados) {
            htmlTotal += `<small class="kits-used">(Kits: ${kitsUsados})</small>`;
        }
        htmlTotal += `</div>`; // Fin de kit-info-wrapper
        
        htmlTotal += `<span class="arrow">▶</span>`;
        htmlTotal += `</div>`;
        
        // LA TABLA OCULTA
        htmlTotal += `<div class="kit-table-container hidden">`;
        // MODIFICADO: Excluir la columna 'Kits_que_lo_usan' de la tabla interna para evitar redundancia
        const headers = Object.keys(variantes[0]).filter(h => h !== 'Kits_que_lo_usan');
        htmlTotal += `<table><thead><tr>`;
        headers.forEach(h => { htmlTotal += `<th>${h}</th>`; });
        htmlTotal += `</tr></thead><tbody>`;
        
        variantes.forEach(variante => {
            // NUEVO: Lógica para pintar de rojo si el tamaño del pack supera al stock disponible
            const stock = parseInt(variante['Stock_Packs'] || '0', 10);
            const pack = parseInt(variante['Variacion_Pack'] || '0', 10);
            const sinStockSuficiente = (stock > 0 && pack > stock);
            let claseFila = sinStockSuficiente ? 'class="row-danger"' : '';

            htmlTotal += `<tr ${claseFila}>`;
            headers.forEach(h => { 
                htmlTotal += `<td title="${variante[h] || ''}">${variante[h] || ''}</td>`; 
            });
            htmlTotal += `</tr>`;
        });
        
        htmlTotal += `</tbody></table></div></div>`; 
    }
    htmlTotal += `</div>`; 
    
    return htmlTotal;
}

export function mostrarMensaje(elementoID, texto, esError = false) {
    const el = document.getElementById(elementoID);
    // Manejo defensivo del DOM
    if (el) {
        // MODIFICADO: Cambiado a innerHTML para permitir saltos de línea (<br>) en los reportes de stock
        el.innerHTML = texto;
        el.style.color = esError ? 'var(--danger)' : 'var(--success)';
    }
}
