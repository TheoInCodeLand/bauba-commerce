require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const db = require('./config/db');

// Import route modules
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const { startCleanupJob } = require('./services/cleanupService');

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
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.cartCount = req.session.cart ? req.session.cart.reduce((sum, item) => sum + item.quantity, 0) : 0;
    next();
});

// ============================================
// Routes
// ============================================

app.use('/', authRoutes);
app.use('/products', productRoutes);
app.use('/cart', cartRoutes);
app.use('/orders', orderRoutes);
app.use('/admin', adminRoutes);
app.use('/webhooks', webhookRoutes);

// Home page — redirect to products
app.get('/', (req, res) => {
    res.redirect('/products');
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

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

startCleanupJob();