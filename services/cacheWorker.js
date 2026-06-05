const redisClient = require('../config/redis');
const brandService = require('./brandService');
const productService = require('./productService');
const departmentService = require('./departmentService');

// Redis key constants — single source of truth for cache keys
const CACHE_KEYS = {
    BRANDS:       'home:brands',
    DISCOUNTED:   'home:discounted',
    DEPARTMENTS:  'home:departments',
    TRENDING:     'home:trending',
    NEW_ARRIVALS: 'home:newArrivals',
};

// TTL slightly longer than the refresh interval so data is never absent
// between a potential failed refresh and the next successful one.
const CACHE_TTL_SECONDS = 7 * 60; // 7 minutes

/**
 * Fetches all global homepage datasets from PostgreSQL and writes them
 * to Redis as JSON strings.  Runs on startup and then every 5 minutes.
 */
async function refreshHomepageCache() {
    console.log('🔄 [CacheWorker] Refreshing homepage cache...');
    try {
        const [brands, discounted, departments, trending, newArrivals] = await Promise.all([
            brandService.getAllBrands(),
            productService.getDiscountedProducts(16),
            departmentService.getAllDepartments(),
            productService.getTrendingProducts(8),
            productService.getNewArrivals(8),
        ]);

        // Write all keys in a single pipeline for efficiency
        await Promise.all([
            redisClient.set(CACHE_KEYS.BRANDS,       JSON.stringify(brands),       { EX: CACHE_TTL_SECONDS }),
            redisClient.set(CACHE_KEYS.DISCOUNTED,   JSON.stringify(discounted),   { EX: CACHE_TTL_SECONDS }),
            redisClient.set(CACHE_KEYS.DEPARTMENTS,  JSON.stringify(departments),  { EX: CACHE_TTL_SECONDS }),
            redisClient.set(CACHE_KEYS.TRENDING,     JSON.stringify(trending),     { EX: CACHE_TTL_SECONDS }),
            redisClient.set(CACHE_KEYS.NEW_ARRIVALS, JSON.stringify(newArrivals),  { EX: CACHE_TTL_SECONDS }),
        ]);

        console.log(`✅ [CacheWorker] Homepage cache refreshed at ${new Date().toISOString()}`);
    } catch (err) {
        // Log but never crash the worker — stale cache is better than no cache
        console.error('❌ [CacheWorker] Failed to refresh homepage cache:', err.message);
    }
}

/**
 * Initialise the cache worker:
 *   1. Run an immediate warm-up so the cache is hot before the first request.
 *   2. Schedule a refresh every 5 minutes (300 000 ms).
 */
function startCacheWorker() {
    // Warm the cache immediately on startup
    refreshHomepageCache();

    // Then refresh every 5 minutes
    setInterval(refreshHomepageCache, 5 * 60 * 1000);

    console.log('🚀 [CacheWorker] Homepage cache worker started (refresh every 5 min)');
}

module.exports = { startCacheWorker, CACHE_KEYS };
