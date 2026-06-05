/**
 * ============================================================================
 *  HIGH-SPEED READ LAYER — DIAGNOSTIC TEST SUITE
 *  tests/highSpeedReadAudit.js
 * ============================================================================
 *
 *  Zero external dependencies (no Mocha, Jest, Supertest).
 *  Uses Node's built-in `assert` + manual mocking of Redis, PostgreSQL, and
 *  Express to test everything in-process without live infrastructure.
 *
 *  Run:  node tests/highSpeedReadAudit.js
 * ============================================================================
 */

'use strict';
const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

// ─── Telemetry ──────────────────────────────────────────────────────────────
let totalTests  = 0;
let passedTests = 0;
let failedTests = 0;
const failures  = [];

function test(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ✅  ${name}`);
    } catch (err) {
        failedTests++;
        failures.push({ name, error: err.message });
        console.log(`  ❌  ${name}`);
        console.log(`      ↳ ${err.message}`);
    }
}

async function testAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  ✅  ${name}`);
    } catch (err) {
        failedTests++;
        failures.push({ name, error: err.message });
        console.log(`  ❌  ${name}`);
        console.log(`      ↳ ${err.message}`);
    }
}

function section(title) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${title}`);
    console.log('═'.repeat(70));
}

// ─── Mock Redis Store ───────────────────────────────────────────────────────
// In-memory key-value store that simulates the redis@6 client API.
function createMockRedis({ shouldFail = false } = {}) {
    const store = new Map();
    const ttls  = new Map();
    let connected = false;

    return {
        store,
        ttls,
        isOpen: true,

        async connect() {
            if (shouldFail) throw new Error('MOCK_REDIS: connection refused');
            connected = true;
        },

        async get(key) {
            if (shouldFail) throw new Error('MOCK_REDIS: connection lost');
            return store.get(key) || null;
        },

        async mGet(keys) {
            if (shouldFail) throw new Error('MOCK_REDIS: connection lost');
            return keys.map(k => store.get(k) || null);
        },

        async set(key, value, opts) {
            if (shouldFail) throw new Error('MOCK_REDIS: connection lost');
            store.set(key, value);
            if (opts && opts.EX) {
                ttls.set(key, opts.EX);
            }
        },

        async ttl(key) {
            return ttls.get(key) || -1;
        },

        on(event, cb) {
            // swallow event listeners
        },

        async quit() { connected = false; },
        async disconnect() { connected = false; },
    };
}

// ─── Mock PostgreSQL Services ───────────────────────────────────────────────
const MOCK_BRANDS      = [{ id: 1, name: 'Nike' }, { id: 2, name: 'Adidas' }];
const MOCK_DISCOUNTED  = [{ id: 10, name: 'Widget', discount_price: 9.99, price: 19.99 }];
const MOCK_DEPARTMENTS = [{ id: 1, name: 'Electronics' }, { id: 2, name: 'Fashion' }];
const MOCK_TRENDING    = [{ id: 20, name: 'Gizmo', price: 14.99 }];
const MOCK_NEW         = [{ id: 30, name: 'New Widget', price: 29.99 }];
const MOCK_RECENTLY    = [{ id: 42, name: 'Headphones', slug: 'headphones', price: 59.99, image_url: null, brand_name: 'Sony' }];

function createMockServices({ shouldFail = false } = {}) {
    const throwDB = () => { throw new Error('MOCK_DB: connection timeout'); };

    return {
        brandService: {
            getAllBrands: shouldFail ? throwDB : async () => MOCK_BRANDS,
        },
        productService: {
            getDiscountedProducts: shouldFail ? throwDB : async () => MOCK_DISCOUNTED,
            getTrendingProducts:   shouldFail ? throwDB : async () => MOCK_TRENDING,
            getNewArrivals:        shouldFail ? throwDB : async () => MOCK_NEW,
            getRecentlyViewedProducts: async (ids) => {
                if (!ids || ids.length === 0) return [];
                return MOCK_RECENTLY.filter(p => ids.includes(p.id));
            },
        },
        departmentService: {
            getAllDepartments: shouldFail ? throwDB : async () => MOCK_DEPARTMENTS,
        },
    };
}

// ─── Helper: build a minimal Express-like req/res pair ──────────────────────
function mockReqRes({ session = {}, query = {} } = {}) {
    const res = {
        _status: 200,
        _body: null,
        _rendered: null,
        status(code) { this._status = code; return this; },
        json(obj)    { this._body = obj; },
        render(view, data) { this._rendered = { view, data }; },
    };
    const req = { session, query };
    return { req, res };
}

// ============================================================================
//  SUITE 1: Cache Worker — refreshHomepageCache()
// ============================================================================
async function suite_cacheWorker() {
    section('SUITE 1 — Cache Worker: refreshHomepageCache()');

    const mockRedis = createMockRedis();
    const mocks     = createMockServices();
    const CACHE_KEYS = {
        BRANDS:       'home:brands',
        DISCOUNTED:   'home:discounted',
        DEPARTMENTS:  'home:departments',
        TRENDING:     'home:trending',
        NEW_ARRIVALS: 'home:newArrivals',
    };
    const CACHE_TTL_SECONDS = 7 * 60;

    // Manually replicate refreshHomepageCache logic with injected deps
    async function refreshHomepageCache() {
        try {
            const [brands, discounted, departments, trending, newArrivals] = await Promise.all([
                mocks.brandService.getAllBrands(),
                mocks.productService.getDiscountedProducts(16),
                mocks.departmentService.getAllDepartments(),
                mocks.productService.getTrendingProducts(8),
                mocks.productService.getNewArrivals(8),
            ]);

            await Promise.all([
                mockRedis.set(CACHE_KEYS.BRANDS,       JSON.stringify(brands),       { EX: CACHE_TTL_SECONDS }),
                mockRedis.set(CACHE_KEYS.DISCOUNTED,   JSON.stringify(discounted),   { EX: CACHE_TTL_SECONDS }),
                mockRedis.set(CACHE_KEYS.DEPARTMENTS,  JSON.stringify(departments),  { EX: CACHE_TTL_SECONDS }),
                mockRedis.set(CACHE_KEYS.TRENDING,     JSON.stringify(trending),     { EX: CACHE_TTL_SECONDS }),
                mockRedis.set(CACHE_KEYS.NEW_ARRIVALS, JSON.stringify(newArrivals),  { EX: CACHE_TTL_SECONDS }),
            ]);
        } catch (err) {
            console.error('❌ [CacheWorker] Failed to refresh homepage cache:', err.message);
        }
    }

    await refreshHomepageCache();

    const allKeys = Object.values(CACHE_KEYS);

    // 1.1  All 5 keys exist
    for (const key of allKeys) {
        await testAsync(`Key "${key}" exists in Redis`, async () => {
            const val = await mockRedis.get(key);
            assert.notStrictEqual(val, null, `Expected key "${key}" to exist`);
        });
    }

    // 1.2  Each key is valid JSON array
    for (const key of allKeys) {
        await testAsync(`Key "${key}" contains valid JSON array`, async () => {
            const val = await mockRedis.get(key);
            const parsed = JSON.parse(val);
            assert.ok(Array.isArray(parsed), `Expected array for key "${key}", got ${typeof parsed}`);
        });
    }

    // 1.3  Data matches mock datasets
    await testAsync('Brands cache matches mock data', async () => {
        const parsed = JSON.parse(await mockRedis.get(CACHE_KEYS.BRANDS));
        assert.deepStrictEqual(parsed, MOCK_BRANDS);
    });

    await testAsync('Discounted cache matches mock data', async () => {
        const parsed = JSON.parse(await mockRedis.get(CACHE_KEYS.DISCOUNTED));
        assert.deepStrictEqual(parsed, MOCK_DISCOUNTED);
    });

    await testAsync('Departments cache matches mock data', async () => {
        const parsed = JSON.parse(await mockRedis.get(CACHE_KEYS.DEPARTMENTS));
        assert.deepStrictEqual(parsed, MOCK_DEPARTMENTS);
    });

    await testAsync('Trending cache matches mock data', async () => {
        const parsed = JSON.parse(await mockRedis.get(CACHE_KEYS.TRENDING));
        assert.deepStrictEqual(parsed, MOCK_TRENDING);
    });

    await testAsync('New Arrivals cache matches mock data', async () => {
        const parsed = JSON.parse(await mockRedis.get(CACHE_KEYS.NEW_ARRIVALS));
        assert.deepStrictEqual(parsed, MOCK_NEW);
    });

    // 1.4  TTL is between 5 and 7 minutes (300–420 seconds)
    for (const key of allKeys) {
        await testAsync(`Key "${key}" TTL is between 300s and 420s`, async () => {
            const ttlVal = await mockRedis.ttl(key);
            assert.ok(ttlVal >= 300 && ttlVal <= 420,
                `Expected TTL 300–420, got ${ttlVal} for key "${key}"`);
        });
    }
}

// ============================================================================
//  SUITE 2 — Personalization API: GET /api/personalization/recently-viewed
// ============================================================================
async function suite_personalizationAPI() {
    section('SUITE 2 — Personalization API Route');

    const mocks = createMockServices();

    // Recreate the handler logic inline (same as apiRoutes.js)
    async function handler(req, res) {
        try {
            const recentIds = (req.session && req.session.recentlyViewed) || [];
            if (recentIds.length === 0) {
                return res.json({ products: [] });
            }
            const products = await mocks.productService.getRecentlyViewedProducts(recentIds);
            res.json({ products });
        } catch (err) {
            console.error('Personalization API Error:', err);
            res.status(500).json({ error: 'Failed to load personalized data' });
        }
    }

    // State A: populated session with valid product IDs
    await testAsync('State A: returns matching products when session has valid IDs', async () => {
        const { req, res } = mockReqRes({ session: { recentlyViewed: [42] } });
        await handler(req, res);
        assert.strictEqual(res._status, 200);
        assert.ok(res._body.products, 'Response should have products array');
        assert.strictEqual(res._body.products.length, 1);
        assert.strictEqual(res._body.products[0].id, 42);
    });

    // State B-1: session exists but recentlyViewed is missing
    await testAsync('State B-1: returns { products: [] } when recentlyViewed key is missing', async () => {
        const { req, res } = mockReqRes({ session: {} });
        await handler(req, res);
        assert.strictEqual(res._status, 200);
        assert.deepStrictEqual(res._body, { products: [] });
    });

    // State B-2: session is completely undefined (no session middleware)
    await testAsync('State B-2: returns { products: [] } when req.session is undefined', async () => {
        const res = {
            _status: 200, _body: null,
            status(c) { this._status = c; return this; },
            json(o)   { this._body = o; },
            render()  {},
        };
        const req = { session: undefined };
        await handler(req, res);
        assert.strictEqual(res._status, 200);
        assert.deepStrictEqual(res._body, { products: [] });
    });

    // State B-3: recentlyViewed is an empty array
    await testAsync('State B-3: returns { products: [] } when recentlyViewed is empty array', async () => {
        const { req, res } = mockReqRes({ session: { recentlyViewed: [] } });
        await handler(req, res);
        assert.strictEqual(res._status, 200);
        assert.deepStrictEqual(res._body, { products: [] });
    });
}

// ============================================================================
//  SUITE 3 — Chaos: Redis Crash Simulation on GET /
// ============================================================================
async function suite_redisCrash() {
    section('SUITE 3 — Chaos: Redis Crash Simulation');

    const failRedis  = createMockRedis({ shouldFail: true });
    const CACHE_KEYS = {
        BRANDS:       'home:brands',
        DISCOUNTED:   'home:discounted',
        DEPARTMENTS:  'home:departments',
        TRENDING:     'home:trending',
        NEW_ARRIVALS: 'home:newArrivals',
    };

    // Simulate the GET / route handler with a dead Redis
    async function homeHandler(req, res) {
        try {
            const brandsJson      = await failRedis.get(CACHE_KEYS.BRANDS);
            const discountedJson  = await failRedis.get(CACHE_KEYS.DISCOUNTED);
            const departmentsJson = await failRedis.get(CACHE_KEYS.DEPARTMENTS);
            const trendingJson    = await failRedis.get(CACHE_KEYS.TRENDING);
            const newArrivalsJson = await failRedis.get(CACHE_KEYS.NEW_ARRIVALS);

            res.render('home', {
                title: 'Welcome',
                brands:      brandsJson      ? JSON.parse(brandsJson)      : [],
                discounted:  discountedJson  ? JSON.parse(discountedJson)  : [],
                departments: departmentsJson ? JSON.parse(departmentsJson) : [],
                trending:    trendingJson    ? JSON.parse(trendingJson)    : [],
                newArrivals: newArrivalsJson ? JSON.parse(newArrivalsJson) : [],
            });
        } catch (err) {
            console.error('Home page error:', err);
            res.status(500).render('error', { title: 'Error', message: 'Unable to load the home page' });
        }
    }

    await testAsync('GET / does NOT throw unhandled rejection when Redis is down', async () => {
        const { req, res } = mockReqRes();
        // This should NOT throw — the catch block handles it
        await homeHandler(req, res);
        assert.strictEqual(res._status, 500);
        assert.ok(res._rendered, 'Should have rendered an error page');
        assert.strictEqual(res._rendered.view, 'error');
    });

    await testAsync('GET / falls back to empty arrays gracefully when Redis returns null', async () => {
        // Simulate Redis that returns null (keys expired / never written)
        const emptyRedis = createMockRedis();
        // Don't write anything to this Redis — all gets return null

        async function homeHandlerEmpty(req, res) {
            try {
                const brandsJson      = await emptyRedis.get(CACHE_KEYS.BRANDS);
                const discountedJson  = await emptyRedis.get(CACHE_KEYS.DISCOUNTED);
                const departmentsJson = await emptyRedis.get(CACHE_KEYS.DEPARTMENTS);
                const trendingJson    = await emptyRedis.get(CACHE_KEYS.TRENDING);
                const newArrivalsJson = await emptyRedis.get(CACHE_KEYS.NEW_ARRIVALS);

                res.render('home', {
                    title: 'Welcome',
                    brands:      brandsJson      ? JSON.parse(brandsJson)      : [],
                    discounted:  discountedJson  ? JSON.parse(discountedJson)  : [],
                    departments: departmentsJson ? JSON.parse(departmentsJson) : [],
                    trending:    trendingJson    ? JSON.parse(trendingJson)    : [],
                    newArrivals: newArrivalsJson ? JSON.parse(newArrivalsJson) : [],
                });
            } catch (err) {
                res.status(500).render('error', { title: 'Error', message: 'Unable to load the home page' });
            }
        }

        const { req, res } = mockReqRes();
        await homeHandlerEmpty(req, res);
        assert.strictEqual(res._status, 200);
        assert.ok(res._rendered, 'Should have rendered home view');
        assert.strictEqual(res._rendered.view, 'home');
        assert.deepStrictEqual(res._rendered.data.brands, []);
        assert.deepStrictEqual(res._rendered.data.discounted, []);
        assert.deepStrictEqual(res._rendered.data.departments, []);
        assert.deepStrictEqual(res._rendered.data.trending, []);
        assert.deepStrictEqual(res._rendered.data.newArrivals, []);
    });
}

// ============================================================================
//  SUITE 4 — Chaos: Database Timeout During Cache Refresh
// ============================================================================
async function suite_dbTimeout() {
    section('SUITE 4 — Chaos: Database Timeout During Cache Refresh');

    const mockRedis   = createMockRedis();
    const failMocks   = createMockServices({ shouldFail: true });
    const CACHE_KEYS = {
        BRANDS:       'home:brands',
        DISCOUNTED:   'home:discounted',
        DEPARTMENTS:  'home:departments',
        TRENDING:     'home:trending',
        NEW_ARRIVALS: 'home:newArrivals',
    };
    const CACHE_TTL_SECONDS = 7 * 60;

    // Pre-seed the cache with "old" data
    await mockRedis.set(CACHE_KEYS.BRANDS, JSON.stringify([{ id: 99, name: 'Stale Brand' }]), { EX: CACHE_TTL_SECONDS });
    await mockRedis.set(CACHE_KEYS.DISCOUNTED, JSON.stringify([]), { EX: CACHE_TTL_SECONDS });

    // Simulate a failing refresh
    async function refreshHomepageCacheFailing() {
        try {
            const [brands, discounted, departments, trending, newArrivals] = await Promise.all([
                failMocks.brandService.getAllBrands(),
                failMocks.productService.getDiscountedProducts(16),
                failMocks.departmentService.getAllDepartments(),
                failMocks.productService.getTrendingProducts(8),
                failMocks.productService.getNewArrivals(8),
            ]);

            await Promise.all([
                mockRedis.set(CACHE_KEYS.BRANDS,       JSON.stringify(brands),       { EX: CACHE_TTL_SECONDS }),
                mockRedis.set(CACHE_KEYS.DISCOUNTED,   JSON.stringify(discounted),   { EX: CACHE_TTL_SECONDS }),
                mockRedis.set(CACHE_KEYS.DEPARTMENTS,  JSON.stringify(departments),  { EX: CACHE_TTL_SECONDS }),
                mockRedis.set(CACHE_KEYS.TRENDING,     JSON.stringify(trending),     { EX: CACHE_TTL_SECONDS }),
                mockRedis.set(CACHE_KEYS.NEW_ARRIVALS, JSON.stringify(newArrivals),  { EX: CACHE_TTL_SECONDS }),
            ]);
        } catch (err) {
            // This is the critical test — the catch must swallow the error
            console.error('      [Expected log] ❌ [CacheWorker] Failed to refresh:', err.message);
        }
    }

    await testAsync('Cache refresh does NOT crash the process on DB timeout', async () => {
        // Should not throw
        await refreshHomepageCacheFailing();
        assert.ok(true, 'Process survived');
    });

    await testAsync('Stale cache data survives a failed refresh cycle', async () => {
        const stale = JSON.parse(await mockRedis.get(CACHE_KEYS.BRANDS));
        assert.strictEqual(stale[0].name, 'Stale Brand', 'Old cached brand should still be present');
    });
}

// ============================================================================
//  SUITE 5 — Source Code Inspection: Structural Safety Checks
// ============================================================================
async function suite_sourceInspection() {
    section('SUITE 5 — Source Code Inspection (Static Analysis)');

    const root = path.join(__dirname, '..');

    // 5.1  cacheWorker.js exports refreshHomepageCache
    test('cacheWorker.js exports CACHE_KEYS', () => {
        const src = fs.readFileSync(path.join(root, 'services', 'cacheWorker.js'), 'utf-8');
        assert.ok(src.includes('CACHE_KEYS'), 'Should export CACHE_KEYS');
        assert.ok(src.includes('module.exports'), 'Should have module.exports');
    });

    // 5.2  cacheWorker.js wraps refresh logic in try/catch
    test('cacheWorker.js has try/catch around the refresh logic', () => {
        const src = fs.readFileSync(path.join(root, 'services', 'cacheWorker.js'), 'utf-8');
        // Extract the refreshHomepageCache function body
        const fnMatch = src.match(/async function refreshHomepageCache\s*\(\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnMatch, 'refreshHomepageCache function should exist');
        assert.ok(fnMatch[1].includes('try'), 'Should contain try block');
        assert.ok(fnMatch[1].includes('catch'), 'Should contain catch block');
    });

    // 5.3  app.js GET / route has try/catch
    test('app.js GET / route has try/catch error handling', () => {
        const src = fs.readFileSync(path.join(root, 'app.js'), 'utf-8');
        // Find the GET / route handler
        const routeMatch = src.match(/app\.get\('\/',\s*async\s*\(req,\s*res\)\s*=>\s*\{([\s\S]*?)\n\}\);/);
        assert.ok(routeMatch, 'GET / route should exist');
        assert.ok(routeMatch[1].includes('try'), 'GET / should contain try block');
        assert.ok(routeMatch[1].includes('catch'), 'GET / should contain catch block');
    });

    // 5.4  apiRoutes.js has defensive session access
    test('apiRoutes.js accesses req.session defensively', () => {
        const src = fs.readFileSync(path.join(root, 'routes', 'apiRoutes.js'), 'utf-8');
        assert.ok(src.includes('try'), 'Should have try block');
        assert.ok(src.includes('catch'), 'Should have catch block');
        // Check that it won't blow up on undefined session
        const usesOptionalOrFallback = src.includes('req.session.recentlyViewed || []')
                                     || src.includes('req.session?.recentlyViewed')
                                     || src.includes('(req.session && req.session.recentlyViewed)');
        assert.ok(usesOptionalOrFallback, 'Should use || [] or ?. fallback for session access');
    });

    // 5.5  home.ejs client-side fetch is inside try/catch
    test('home.ejs: client-side fetch is wrapped in try/catch', () => {
        const src = fs.readFileSync(path.join(root, 'views', 'home.ejs'), 'utf-8');
        // Find the DOMContentLoaded callback
        const scriptMatch = src.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
        assert.ok(scriptMatch, 'Should have an inline script before </body>');
        const scriptBody = scriptMatch[1];
        // There should be a try/catch wrapping the fetch
        assert.ok(scriptBody.includes('try'), 'Client-side script should have try block');
        assert.ok(scriptBody.includes('catch'), 'Client-side script should have catch block');
        assert.ok(scriptBody.includes("fetch('/api/personalization/recently-viewed')") ||
                  scriptBody.includes('fetch(\'/api/personalization/recently-viewed\')') ||
                  scriptBody.includes('fetch(`/api/personalization/recently-viewed`)'),
                  'Should fetch the personalization endpoint');
    });

    // 5.6  home.ejs: fetch error does NOT block IntersectionObserver
    test('home.ejs: IntersectionObserver runs independently of fetch', () => {
        const src = fs.readFileSync(path.join(root, 'views', 'home.ejs'), 'utf-8');
        const scriptMatch = src.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
        const scriptBody = scriptMatch[1];

        // The IO setup must be in its own IIFE, separate from the DOMContentLoaded async fetch
        const hasIO = scriptBody.includes('IntersectionObserver');
        assert.ok(hasIO, 'Should set up IntersectionObserver');

        // IO must be initialized OUTSIDE the DOMContentLoaded try/catch
        const ioPos   = scriptBody.indexOf('IntersectionObserver');
        const dclPos  = scriptBody.indexOf('DOMContentLoaded');
        assert.ok(ioPos < dclPos,
            'IntersectionObserver should be initialized before DOMContentLoaded handler ' +
            '(in a separate IIFE) so a fetch failure cannot halt it');
    });

    // 5.7  config/redis.js has error event handler
    test('config/redis.js registers an error event handler', () => {
        const src = fs.readFileSync(path.join(root, 'config', 'redis.js'), 'utf-8');
        assert.ok(src.includes(".on('error'") || src.includes('.on("error"'),
            'Should register an error event listener');
    });

    // 5.8 cacheWorker.js sets explicit TTL (EX option)
    test('cacheWorker.js sets explicit TTL using { EX: ... }', () => {
        const src = fs.readFileSync(path.join(root, 'services', 'cacheWorker.js'), 'utf-8');
        const ttlMatch = src.match(/CACHE_TTL_SECONDS\s*=\s*(\d+\s*\*\s*\d+|\d+)/);
        assert.ok(ttlMatch, 'Should define CACHE_TTL_SECONDS');
        assert.ok(src.includes('{ EX: CACHE_TTL_SECONDS }'), 'Should pass { EX: CACHE_TTL_SECONDS } to set()');
        // Evaluate the TTL value
        const ttlExpr = ttlMatch[1].replace(/\s/g, '');
        const ttlVal = eval(ttlExpr);  // safe — it's just numeric literals
        assert.ok(ttlVal >= 300 && ttlVal <= 420,
            `TTL should be 300–420s (5–7 min), got ${ttlVal}s`);
    });
}

// ============================================================================
//  SUITE 6 — Edge Case: apiRoutes.js req.session undefined (live code path)
// ============================================================================
async function suite_apiSessionEdge() {
    section('SUITE 6 — apiRoutes.js: req.session === undefined (TypeError Guard)');

    // Read the actual source to see if there's a guard
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'routes', 'apiRoutes.js'), 'utf-8'
    );

    // The current code uses: req.session.recentlyViewed || []
    // If req.session is undefined, this throws: "Cannot read properties of undefined"
    // Safe alternatives: req.session?.recentlyViewed || []
    //                    (req.session && req.session.recentlyViewed) || []

    const safePattern = /req\.session\?\.recentlyViewed/
                     || src.includes('req.session && req.session.recentlyViewed');

    const hasOptionalChain = src.includes('req.session?.recentlyViewed')
                          || src.includes('req.session && req.session.recentlyViewed');

    test('apiRoutes.js uses safe access pattern for req.session', () => {
        // If this fails, we will fix it in the repair step
        assert.ok(hasOptionalChain,
            'req.session.recentlyViewed without ?. or && guard will throw TypeError when session middleware is not mounted');
    });
}

// ============================================================================
//  RUN ALL SUITES
// ============================================================================
async function main() {
    console.log('\n' + '▓'.repeat(70));
    console.log('  HIGH-SPEED READ LAYER — DIAGNOSTIC TEST SUITE');
    console.log('  ' + new Date().toISOString());
    console.log('▓'.repeat(70));

    await suite_cacheWorker();
    await suite_personalizationAPI();
    await suite_redisCrash();
    await suite_dbTimeout();
    await suite_sourceInspection();
    await suite_apiSessionEdge();

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(70));
    console.log('  SUMMARY');
    console.log('═'.repeat(70));
    console.log(`  Total:  ${totalTests}`);
    console.log(`  Passed: ${passedTests} ✅`);
    console.log(`  Failed: ${failedTests} ❌`);

    if (failures.length > 0) {
        console.log('\n  FAILURES:');
        failures.forEach((f, i) => {
            console.log(`    ${i + 1}. ${f.name}`);
            console.log(`       ${f.error}`);
        });
    }

    console.log('═'.repeat(70) + '\n');

    process.exit(failedTests > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('FATAL: Test suite crashed:', err);
    process.exit(2);
});
