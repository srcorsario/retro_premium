// js/ui.js
import ENV from './config.js';

export function renderTabla(contenedorID, datos, nombrePestana) {
    const container = document.getElementById(contenedorID);
    // MODIFICADO: Manejo defensivo del DOM
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
        // MODIFICADO: Manejo defensivo del DOM
        const tituloVista = document.getElementById('titulo-vista');
        if (tituloVista) tituloVista.innerText = `Kits y Placas Disponibles`;
        return;
    }

    // NUEVO: Si es la pestaña de Variantes LCSC o AliExpress, agrupamos por componente
    if (nombrePestana === 'Variantes_LCSC' || nombrePestana === 'Variantes_AliExpress') {
        container.innerHTML = renderVariantesAgrupadas(datosLimpios);
        const tituloVista = document.getElementById('titulo-vista');
        if (tituloVista) tituloVista.innerText = `${nombrePestana} (${datosLimpios.length} registros)`;
        return;
    }

    // --- CÓDIGO NORMAL PARA EL RESTO DE PESTAÑAS ---
    const headers = Object.keys(datosLimpios[0]);
    let htmlHead = '<tr>';
    headers.forEach(h => { htmlHead += `<th>${h}</th>`; });
    htmlHead += '</tr>';

    let htmlBody = '';
    datosLimpios.forEach(fila => {
        let esAlerta = false;
        
        // Lógica de negocio visual: Si estamos en Stock y las unidades son <= mínimas
        if (nombrePestana === 'Stock_Almacen') {
            const uds = parseFloat(fila['Uds_Disponibles']) || 0;
            const min = parseFloat(fila['Stock_Minimo_Alerta']) || 0;
            if (uds <= min && uds > 0) esAlerta = true;
            if (uds === 0) esAlerta = 'critico';
        }
        
        let claseFila = esAlerta === 'critico' ? 'class="row-danger"' : (esAlerta ? 'class="row-warning"' : '');
        
        htmlBody += `<tr ${claseFila}>`;
        headers.forEach(header => {
            htmlBody += `<td title="${fila[header] || ''}">${fila[header] || ''}</td>`; // Añadido title para ver URL completa al pasar el ratón
        });
        htmlBody += '</tr>';
    });

    container.innerHTML = `
        <table>
            <thead>${htmlHead}</thead>
            <tbody>${htmlBody}</tbody>
        </table>
    `;
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

// NUEVO: --- LA FUNCIÓN QUE AGRUPA VARIANTES POR COMPONENTE (ACORDEÓN) ---
function renderVariantesAgrupadas(datos) {
    const componentes = {};
    
    // Agrupamos todas las filas que pertenezcan al mismo ID_Componente
    datos.forEach(fila => {
        const idComponente = fila['ID_Componente'] || 'Componente Desconocido';
        
        if (!componentes[idComponente]) componentes[idComponente] = [];
        componentes[idComponente].push(fila);
    });

    let htmlTotal = '<div class="family-group">'; // Reutilizamos el contenedor visual
    
    for (const [idComponente, variantes] of Object.entries(componentes)) {
        htmlTotal += `<div class="kit-card">`;
        
        // EL BOTÓN DESPLEGABLE (Reutilizamos clases CSS existentes)
        htmlTotal += `<div class="kit-toggle" onclick="this.classList.toggle('active'); this.nextElementSibling.classList.toggle('hidden');">`;
        htmlTotal += `📦 ${idComponente} <span class="arrow">▶</span>`;
        htmlTotal += `</div>`;
        
        // LA TABLA OCULTA
        htmlTotal += `<div class="kit-table-container hidden">`;
        const headers = Object.keys(variantes[0]);
        htmlTotal += `<table><thead><tr>`;
        headers.forEach(h => { htmlTotal += `<th>${h}</th>`; });
        htmlTotal += `</tr></thead><tbody>`;
        
        variantes.forEach(variante => {
            htmlTotal += `<tr>`;
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
    // MODIFICADO: Manejo defensivo del DOM
    if (el) {
        el.innerText = texto;
        el.style.color = esError ? 'var(--danger)' : 'var(--success)';
    }
}
