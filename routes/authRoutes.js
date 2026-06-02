const express = require('express');
const { body, validationResult } = require('express-validator');
const authService = require('../services/authService');
const { requireAuth, redirectIfAuthenticated } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/register', redirectIfAuthenticated, (req, res) => {
    res.render('auth/register', { title: 'Register', errors: null, formData: {} });
});

// handle registration
router.post('/register', [
    redirectIfAuthenticated,
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('confirmPassword').custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error('Passwords do not match');
        }
        return true;
    }),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('auth/register', {
            title: 'Register',
            errors: errors.array(),
            formData: req.body,
        });
    }

    try {
        const user = await authService.register(req.body.email, req.body.password);

        // Auto-login after register
        req.session.user = { id: user.id, email: user.email, is_admin: user.is_admin };

        const redirectTo = req.session.returnTo || '/products';
        delete req.session.returnTo;
        res.redirect(redirectTo);

    } catch (err) {
        res.render('auth/register', {
            title: 'Register',
            errors: [{ msg: err.message }],
            formData: req.body,
        });
    }
});

router.get('/login', redirectIfAuthenticated, (req, res) => {
    res.render('auth/login', { title: 'Login', error: null, email: '' });
});

// handle login
router.post('/login', redirectIfAuthenticated, async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await authService.login(email, password);

        if (!user) {
            return res.render('auth/login', {
                title: 'Login',
                error: 'Invalid email or password',
                email,
            });
        }

        req.session.user = user;

        const redirectTo = req.session.returnTo || '/products';
        delete req.session.returnTo;
        res.redirect(redirectTo);

    } catch (err) {
        res.render('auth/login', {
            title: 'Login',
            error: 'An error occurred. Please try again.',
            email,
        });
    }
});

// logout
router.post('/logout', requireAuth, (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        res.redirect('/products');
    });
});

module.exports = router;