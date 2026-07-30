// js/api.js
import { CONFIG } from './config.js';

export async function obtenerDatos(nombreHoja) {
    try {
        const url = `${CONFIG.API_URL}?action=getData&sheet=${nombreHoja}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error en la red');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error al obtener ${nombreHoja}:`, error);
        return [];
    }
}

export async function actualizarDatos(nombreHoja, payload) {
    try {
        const url = `${CONFIG.API_URL}?sheet=${nombreHoja}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Text/plain evita problemas de CORS preflight
            body: JSON.stringify(payload)
        });
        return true; // Asumimos éxito si no hay error
    } catch (error) {
        console.error(`Error al actualizar ${nombreHoja}:`, error);
        return false;
    }
}