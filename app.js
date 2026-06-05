require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const db = require('./config/db');
const redisClient = require('./config/redis');

// Import route modules
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const { startCleanupJob } = require('./services/cleanupService');
const { startCacheWorker, CACHE_KEYS } = require('./services/cacheWorker');
const { startOrderWorker } = require('./services/orderWorker');
const wishlistService = require('./services/wishlistService');
const productService = require('./services/productService');
const brandService = require('./services/brandService');
const departmentService = require('./services/departmentService');
const { startMLWorker } = require('./services/mlWorker');
const apiRoutes = require('./routes/apiRoutes');
// const { syncProductsToSearch } = require('./services/searchSync');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// EJS templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session middleware with PostgreSQL store
// Sessions persist across server restarts and are stored in the DB
app.use(
    session({
        store: new pgSession({
            pool: db.pool,              // Use our existing pool
            tableName: 'session',       // Matches schema.sql
            createTableIfMissing: false, // We already created it in schema.sql
        }),
        secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24, // 24 hours
            secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
            httpOnly: true, // Prevent XSS access to cookie
        },
    })
);

// Make user session available to all EJS templates
app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.cartCount = req.session.cart ? req.session.cart.reduce((sum, item) => sum + item.quantity, 0) : 0;

    // Wishlist count for logged-in users
    if (req.session.user) {
        try {
            res.locals.wishlistCount = await wishlistService.getWishlistCount(req.session.user.id);
        } catch (err) {
            res.locals.wishlistCount = 0;
        }
    } else {
        res.locals.wishlistCount = 0;
    }

    next();
});

// ============================================
// Routes
// ============================================

app.use('/', authRoutes);
app.use('/products', productRoutes);
app.use('/products', reviewRoutes);
app.use('/cart', cartRoutes);
app.use('/orders', orderRoutes);
app.use('/admin', adminRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/wishlist', wishlistRoutes);
app.use('/api', apiRoutes);

// Home page — rich landing page
// Global datasets (brands, products, departments) are served from the Redis
// cache populated by cacheWorker.js.  Only session-specific data (recently
// viewed products, recent category) still hits PostgreSQL here.
app.get('/', async (req, res) => {
    try {
        const brandsJson = await redisClient.get(CACHE_KEYS.BRANDS);
        const discountedJson = await redisClient.get(CACHE_KEYS.DISCOUNTED);
        const departmentsJson = await redisClient.get(CACHE_KEYS.DEPARTMENTS);
        const trendingJson = await redisClient.get(CACHE_KEYS.TRENDING);
        const newArrivalsJson = await redisClient.get(CACHE_KEYS.NEW_ARRIVALS);

        res.render('home', {
            title: 'Welcome',
            brands: brandsJson ? JSON.parse(brandsJson) : [],
            discounted: discountedJson ? JSON.parse(discountedJson) : [],
            departments: departmentsJson ? JSON.parse(departmentsJson) : [],
            trending: trendingJson ? JSON.parse(trendingJson) : [],
            newArrivals: newArrivalsJson ? JSON.parse(newArrivalsJson) : []
            // recentlyViewed and recentCategory are completely removed from here
        });
    } catch (err) {
        console.error('Home page error:', err);
        res.status(500).render('error', { title: 'Error', message: 'Unable to load the home page' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('partials/error', {
        title: 'Page Not Found',
        message: 'The page you requested does not exist.'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).render('partials/error', {
        title: 'Server Error',
        message: process.env.NODE_ENV === 'production'
            ? 'Something went wrong.'
            : err.message
    });
});

app.listen(PORT, async () => {
    console.log(`bauba running on http://localhost:${PORT}`);

    // Connect to Redis then boot background workers
    await redisClient.connect();
    startCleanupJob();
    startCacheWorker();
    startOrderWorker();
    startMLWorker();
});

// syncProductsToSearch();