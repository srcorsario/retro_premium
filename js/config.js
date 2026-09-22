// js/config.js
const ENV = {
    // ID público de tu hoja
    SHEET_ID: '2PACX-1vQitSKxbhg-LRaczPO4vsSxS4rA9jV2N3uz7xnyLu7-ufTzWW-2Zm9arK_zL_18C84kma3xvlIua32_',
    
    // URL de tu Apps Script (nueva implementación 2026-09-22, añade soporte de Mouser)
    API_URL: 'https://script.google.com/macros/s/AKfycbxwoEKfTRp3nh68l3oF6xrL-6coRbYjGuNktFSTt6snYFCGFWcUBWG_SKzUYJtVMFSG/exec',

    // MAPEO EXACTO DE PESTAÑAS (Nombre en el HTML vs GID de Google)
    // NUEVO (2026-09-22): GID de "Variantes_Mouser" ya registrado (de su link de "Publicar en la
    // web"). Si en algún momento vuelve a devolver [] (Mouser desaparece como opción sin ningún
    // error en consola), revisa dos cosas: que este GID siga siendo el correcto, y que Archivo >
    // Compartir > Publicar en la web siga cubriendo "Todo el documento" (o esta pestaña a mano).
    SHEETS: {
        'Componentes': '0',
        'Stock_Almacen': '1219687958',
        'Kits_Consolas': '469549997',
        'Variantes_LCSC': '1185379945',
        'Variantes_AliExpress': '566853215',
        'Variantes_TME': '1904539601',
        'Variantes_Mouser': '1206071426',
        'Gastos_Extra': '1432868169',
        'Sustituciones': '1420594919' // NUEVO
    },

    APP_NAME: 'Retro Components Dashboard',
    MONEDA: '€',
    MAX_TABLE_ROWS: 100
};

export default ENV;
