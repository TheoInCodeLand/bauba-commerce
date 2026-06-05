const express = require('express');
const cartService = require('../services/cartService');

const router = express.Router();

// view cart
router.get('/', async (req, res) => {
    try {
        const cart = await cartService.getCart(req.session.cart);
        res.render('cart/cart', { title: 'Shopping Cart', cart });
    } catch (err) {
        console.error('Cart error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load cart',
        });
    }
});

// add item to cart
router.post('/add', async (req, res) => {
    const { productId, quantity = 1 } = req.body;

    try {
        req.session.cart = await cartService.addItem(
            req.session.cart,
            parseInt(productId),
            parseInt(quantity)
        );

        // Redirect back to product or cart
        const cartCount = (req.session.cart || []).reduce((s, it) => s + (it.quantity || 0), 0);

        // If JSON requested (AJAX), return JSON payload
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({ message: 'Added to cart', cartCount });
        }

        const redirectTo = req.get('Referer') || '/cart';
        res.redirect(redirectTo);

    } catch (err) {
        req.session.flashError = err.message;
        res.redirect(req.get('Referer') || '/products');
    }
});

// update quantity
router.post('/update', async (req, res) => {
    const { productId, quantity } = req.body;

    try {
        req.session.cart = await cartService.updateQuantity(
            req.session.cart,
            parseInt(productId),
            parseInt(quantity)
        );
        res.redirect('/cart');
    } catch (err) {
        req.session.flashError = err.message;
        res.redirect('/cart');
    }
});

// remove item
router.post('/remove', (req, res) => {
    const { productId } = req.body;
    req.session.cart = cartService.removeItem(req.session.cart, parseInt(productId));
    res.redirect('/cart');
});

module.exports = router;