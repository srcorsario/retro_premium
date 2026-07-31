// js/api.js
import ENV from './config.js';

export async function obtenerDatos(nombrePestana) {
    try {
        // Busca el gid correspondiente a la pestaña que le pedimos
        const gid = ENV.SHEETS[nombrePestana];
        
        if (!gid) throw new Error(`No se encontró el GID para la pestaña: ${nombrePestana}`);

        // Usamos la URL pública y súper estable que me confirmaste
        const url = `https://docs.google.com/spreadsheets/d/e/${ENV.SHEET_ID}/pub?gid=${gid}&single=true&output=csv`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error en la red al leer CSV');
        
        const text = await response.text();
        return parsearCSVaJSON(text);
        
    } catch (error) {
        console.error(`Error al obtener ${nombrePestana}:`, error);
        return [];
    }
}

function parsearCSVaJSON(csvText) {
    const lineas = csvText.split('\n').filter(linea => linea.trim() !== '');
    if (lineas.length < 2) return [];

    const cabeceras = separarCSVLinea(lineas[0]);
    const datos = [];

    for (let i = 1; i < lineas.length; i++) {
        const valores = separarCSVLinea(lineas[i]);
        if (valores.length === cabeceras.length) {
            let objeto = {};
            cabeceras.forEach((cabecera, index) => {
                objeto[cabecera.trim().replace(/\r?\n|\r/g, ' ')] = valores[index].trim();
            });
            datos.push(objeto);
        }
    }
    return datos;
}

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

export async function actualizarDatos(payload) {
    if (ENV.API_URL === 'PENDING_APP_SCRIPT_URL') return false;
    try {
        const url = `${ENV.API_URL}?sheet=${payload.sheet || 'Stock_Almacen'}`;
        
        // MODIFICADO: Uso de 'no-cors' para evitar bloqueos de CORS de Google Apps Script
        // Al usar no-cors, el navegador no puede leer la respuesta, pero la petición llega al servidor.
        const response = await fetch(url, {
            method: 'POST',
            mode: 'no-cors', // NUEVO: Evita el error de política CORS
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
            body: JSON.stringify(payload)
        });
        
        // En modo 'no-cors', response.ok siempre es false y no podemos leer el JSON.
        // Asumimos que si la petición se completó sin lanzar excepción de red, fue exitosa.
        return true;
        
    } catch (error) {
        console.error("Error al escribir:", error);
        return false;
    }
}
