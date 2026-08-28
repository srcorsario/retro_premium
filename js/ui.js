// js/ui.js
import ENV from './config.js';

// Clave para guardar la configuración de columnas en LocalStorage
const LS_COL_VISIBILITY = 'retro_premium_col_visibility';

export function renderTabla(contenedorID, datos, nombrePestana) {
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

    // Si es la pestaña de Kits, usamos la lógica del acordeón
    if (nombrePestana === 'Kits_Consolas') {
        container.innerHTML = renderKitsAgrupados(datosLimpios);
        const tituloVista = document.getElementById('titulo-vista');
        if (tituloVista) tituloVista.innerText = `Kits y Placas Disponibles`;
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
        let esAlerta = false;
        
        // Lógica de negocio visual: Si estamos en Stock y las unidades son <= mínimas
        if (nombrePestana === 'Stock_Almacen') {
            const uds = parseFloat(fila['Uds_Disponibles']) || 0;
            const min = parseFloat(fila['Stock_Minimo_Alerta']) || 0;
            if (uds <= min && uds > 0) esAlerta = true;
            if (uds === 0) esAlerta = 'critico';
        }
        
        // MODIFICADO: Se elimina esSinStock de la clase de la fila para pintar solo el texto
        let claseFila = esAlerta === 'critico' ? 'class="row-danger"' : (esAlerta ? 'class="row-warning"' : '');
        
        htmlBody += `<tr ${claseFila}>`;
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

// --- LA FUNCIÓN QUE AGRUPA POR FAMILIA (ACORDEÓN) ---
function renderKitsAgrupados(datos) {
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
            htmlTotal += `<div class="kit-toggle" onclick="this.classList.toggle('active'); this.nextElementSibling.classList.toggle('hidden');">`;
            htmlTotal += `📝 ${nombreKit} <span class="arrow">▶</span>`;
            htmlTotal += `</div>`;
            
            // LA TABLA OCULTA
            htmlTotal += `<div class="kit-table-container hidden">`;
            const headers = Object.keys(componentes[0]);
            htmlTotal += `<table><thead><tr>`;
            headers.forEach(h => { htmlTotal += `<th>${h}</th>`; });
            htmlTotal += `</tr></thead><tbody>`;
            
            componentes.forEach(comp => {
                htmlTotal += `<tr>`;
                headers.forEach(h => { 
                    htmlTotal += `<td title="${comp[h] || ''}">${comp[h] || ''}</td>`; 
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
