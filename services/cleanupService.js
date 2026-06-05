const orderService = require('./orderService');

/**
 * Start background cleanup interval
 * Runs every minute to expire old reservations
 */
function startCleanupJob() {
    // Run immediately on startup
    runCleanup();

    // Then every 60 seconds
    setInterval(runCleanup, 60000);

    console.log('🧹Background cleanup job started (every 60s)');
}

async function runCleanup() {
    try {
        const expiredCount = await orderService.expireAbandonedOrders();
        if (expiredCount > 0) {
            console.log(`Expired ${expiredCount} abandoned orders and released stock`);
        }
    } catch (err) {
        console.error('Cleanup job error:', err);
    }
}

module.exports = { startCleanupJob };