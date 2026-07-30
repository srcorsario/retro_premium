// js/api.js
import ENV from './config.js';

/**
 * LEER DATOS (Vía CSV Público - Sin errores de CORS)
 */
export async function obtenerDatos(nombrePestana) {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${ENV.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${nombrePestana}`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error en la red al leer CSV');
        
        const text = await response.text();
        return parsearCSVaJSON(text);
        
    } catch (error) {
        console.error(`Error al obtener ${nombrePestana}:`, error);
        return [];
    }
}

/**
 * Función interna para convertir el texto del CSV a Arrays de Objetos
 */
function parsearCSVaJSON(csvText) {
    const lineas = csvText.split('\n').filter(linea => linea.trim() !== '');
    if (lineas.length < 2) return [];

    const cabeceras = separarCSVLinea(lineas[0]);
    const datos = [];

    for (let i = 1; i < lineas.length; i++) {
        const valores = separarCSVLinea(lineas[i]);
        // Solo procesar si la fila tiene el mismo número de columnas que la cabecera
        if (valores.length === cabeceras.length) {
            let objeto = {};
            cabeceras.forEach((cabecera, index) => {
                // Limpiamos posibles saltos de línea internos y espacios
                objeto[cabecera.trim().replace(/\r?\n|\r/g, ' ')] = valores[index].trim();
            });
            datos.push(objeto);
        }
    }
    return datos;
}

// Maneja comas que estén dentro de comillas dobles en el CSV
function separarCSVLinea(linea) {
    const resultado = [];
    let actual = '';
    let entreComillas = false;
    for (let i = 0; i < linea.length; i++) {
        const char = linea[i];
        if (char === '"') {
            entreComillas = !entreComillas;
        } else if (char === ',' && !entreComillas) {
            resultado.push(actual);
            actual = '';
        } else {
            actual += char;
        }
    }
    resultado.push(actual);
    return resultado;
}

/**
 * ESCRIBIR DATOS (Vía Apps Script - Para modificar Stock)
 */
export async function actualizarDatos(payload) {
    if (ENV.API_URL === 'PENDING_APP_SCRIPT_URL') {
        console.warn("API_URL no configurada en config.js. No se pueden guardar datos.");
        return false;
    }

    try {
        const url = `${ENV.API_URL}?sheet=${payload.sheet || 'Stock_Almacen'}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        return result.status === 'success';
    } catch (error) {
        console.error("Error al escribir en Google Sheets:", error);
        return false;
    }
}
