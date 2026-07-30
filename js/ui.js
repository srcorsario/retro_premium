// js/ui.js
import ENV from './config.js';

export function renderTabla(contenedorID, datos, nombrePestana) {
    const container = document.getElementById(contenedorID);
    
    // Si no hay datos, mostramos mensaje
    if (!datos || datos.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:var(--text-secondary);">No hay datos para mostrar en ${nombrePestana}.</p>`;
        return;
    }

    // Filtrar filas vacías típicas de Google Sheets
    const datosLimpios = datos.filter(row => 
        Object.values(row).some(val => val !== '' && val !== null && val !== undefined)
    ).slice(0, ENV.MAX_TABLE_ROWS); // Limitar filas por rendimiento

    // 1. Construir Cabeceras dinámicamente
    const headers = Object.keys(datosLimpios[0]);
    let htmlHead = '<tr>';
    headers.forEach(h => { htmlHead += `<th>${h}</th>`; });
    htmlHead += '</tr>';

    // 2. Construir Filas
    let htmlBody = '';
    datosLimpios.forEach(fila => {
        let esAlerta = false;

        // Lógica de negocio visual: Si estamos en Stock y las unidades son <= mínimas
        if (nombrePestana === ENV.SHEETS.STOCK) {
            const uds = parseFloat(fila['Uds_Disponibles']) || 0;
            const min = parseFloat(fila['Stock_Minimo_Alerta']) || 0;
            if (uds <= min && uds > 0) esAlerta = true;
            if (uds === 0) esAlerta = 'critico'; // Sin stock
        }

        // Aplicar clase CSS si hay alerta
        let claseFila = esAlerta === 'critico' ? 'class="row-danger"' : (esAlerta ? 'class="row-warning"' : '');
        
        htmlBody += `<tr ${claseFila}>`;
        headers.forEach(header => {
            let valor = fila[header] || '';
            htmlBody += `<td>${valor}</td>`;
        });
        htmlBody += '</tr>';
    });

    // 3. Montar la tabla en el HTML
    container.innerHTML = `
        <table>
            <thead>${htmlHead}</thead>
            <tbody>${htmlBody}</tbody>
        </table>
    `;
}

export function mostrarMensaje(elementoID, texto, esError = false) {
    const el = document.getElementById(elementoID);
    if (el) {
        el.innerText = texto;
        el.style.color = esError ? 'var(--danger)' : 'var(--success)';
    }
}
