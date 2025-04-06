// Configuration settings
const config = {
    // API Configuration
    api: {
        baseUrl: 'http://localhost:3000/api',
        timeout: 30000, // 30 seconds
    },

    // Feature flags
    features: {
        enableNotifications: true,
        enableRealTimeUpdates: false,
        enableOfflineMode: false
    },

    // Date format settings
    dateFormat: {
        display: 'DD MMMM YYYY',
        input: 'YYYY-MM-DD',
        timestamp: 'YYYY-MM-DD HH:mm:ss'
    },

    // Currency settings
    currency: {
        code: 'IDR',
        symbol: 'Rp',
        decimal: 2,
        separator: {
            thousand: '.',
            decimal: ','
        }
    },

    // Pagination settings
    pagination: {
        itemsPerPage: 10,
        maxPages: 5
    },

    // Toast notification settings
    notifications: {
        position: 'top-right',
        duration: 3000,
        closeButton: true
    }
};

// Export configuration
window.config = config;