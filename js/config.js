// js/config.js
const ENV = {
    // ID público de tu hoja
    SHEET_ID: '2PACX-1vQitSKxbhg-LRaczPO4vsSxS4rA9jV2N3uz7xnyLu7-ufTzWW-2Zm9arK_zL_18C84kma3xvlIua32_',
    
    // URL de tu Apps Script (Para el futuro módulo de escritura)
    API_URL: 'https://script.google.com/macros/s/AKfycbx0hZGY3FFLYLlQJ5uHvOzXrO4X8HIRAaQ-pZPG5Kd-i1ZG8ucWen-lrVZ-7EnlCkgC/exec',

    // MAPEO EXACTO DE PESTAÑAS (Nombre en el HTML vs GID de Google)
    SHEETS: {
        'Componentes': '0',
        'Stock_Almacen': '1219687958',
        'Kits_Consolas': '469549997',
        'Variantes_LCSC': '1185379945',
        'Variantes_AliExpress': '566853215',
        'Variantes_TME': '1904539601',
        'Gastos_Extra': '1432868169',
        'Sustituciones': '1420594919' // NUEVO
    },

    APP_NAME: 'Retro Components Dashboard',
    MONEDA: '€',
    MAX_TABLE_ROWS: 100
};

export default ENV;
