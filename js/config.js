// =========================================================
// 🛠️ CONFIGURACIÓN GLOBAL DEL PROYECTO
// =========================================================
// Cambia estos valores aquí cuando sea necesario.
// NO NECESITAS TOCAR NINGÚN OTRO ARCHIVO PARA ESTO.
// =========================================================

const ENV = {
    // --- CONEXIÓN CON GOOGLE SHEETS (Lectura) ---
    // ID de tu hoja pública (Se extrae del enlace /pub?output=csv)
    SHEET_ID: '2PACX-1vQitSKxbhg-LRaczPO4vsSxS4rA9jV2N3uz7xnyLu7-ufTzWW-2Zm9arK_zL_18C84kma3xvlIua32_',

    // --- CONEXIÓN CON APPS SCRIPT (Escritura/Modificaciones) ---
    // La URL que te da al desplegar como "Aplicación Web" en Apps Script
    API_URL: 'https://script.google.com/macros/s/AKfycbzPfPivHWxl056dILJRCGgbY9dzHpPt8xO-sFVDU7FwwLEiXr-d7l_sQxpC2LRi4qzG/exec', 

    // --- MAPEO DE PESTAÑAS ---
    // Nombres exactos de las pestañas en tu Google Sheet
    SHEETS: {
        COMPONENTES: 'Componentes',
        KITS: 'Kits_Consolas',
        STOCK: 'Stock_Almacen',
        VARIANTES_LCSC: 'Variantes_LCSC',
        VARIANTES_ALI: 'Variantes_AliExpress',
        GASTOS: 'Gastos_Extra'
    },

    // --- AJUSTES DE LA APLICACIÓN (Futuro) ---
    APP_NAME: 'Retro Components Dashboard',
    MONEDA: '€',
    
    // Límite de filas a mostrar por tabla para evitar que el navegador se congele
    // (Tu hoja tiene muchas filas vacías al final, esto lo controla)
    MAX_TABLE_ROWS: 100,

    // --- AJUSTES AVANZADOS (Futuro) ---
    // ACTIVAR_LOGS: true, 
    // TEMA_COLOR: 'azul',
};

// Exportamos la configuración para que los demás módulos puedan leerla
export default ENV;
