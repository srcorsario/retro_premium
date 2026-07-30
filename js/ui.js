// js/ui.js

export function renderTabla(contenedorID, datos) {
    const tbody = document.getElementById(contenedorID);
    tbody.innerHTML = ''; // Limpiamos tabla

    if (!datos || datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="50">No hay datos</td></tr>';
        return;
    }

    // Filtrar filas vacías (típico de Google Sheets)
    const datosLimpios = datos.filter(row => 
        Object.values(row).some(val => val !== '' && val !== null && val !== undefined)
    );

    datosLimpios.forEach(fila => {
        const tr = document.createElement('tr');
        // Cogemos las claves de la primera fila para generar las columnas
        Object.values(fila).forEach(valor => {
            const td = document.createElement('td');
            td.innerText = valor;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

export function mostrarMensaje(elementoID, texto, esError = false) {
    const el = document.getElementById(elementoID);
    if (el) {
        el.innerText = texto;
        el.style.color = esError ? '#ef4444' : '#22c55e';
    }
}