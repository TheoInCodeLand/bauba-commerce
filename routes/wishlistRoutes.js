const express = require('express');
const wishlistService = require('../services/wishlistService');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// View wishlist page
router.get('/', requireAuth, async (req, res) => {
    try {
        const items = await wishlistService.getWishlist(req.session.user.id);
        res.render('wishlist/wishlist', {
            title: 'My Wishlist',
            items,
        });
    } catch (err) {
        console.error('Wishlist error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load wishlist',
        });
    }
});

// Toggle wishlist item (add/remove)
router.post('/toggle', requireAuth, async (req, res) => {
    const { productId } = req.body;

    try {
        const result = await wishlistService.toggleWishlist(
            req.session.user.id,
            parseInt(productId)
        );
        const wishlistCount = await wishlistService.getWishlistCount(req.session.user.id);

        // AJAX response
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({
                added: result.added,
                message: result.added ? 'Added to wishlist' : 'Removed from wishlist',
                wishlistCount,
            });
        }

        res.redirect(req.get('Referer') || '/wishlist');
    } catch (err) {
        console.error('Wishlist toggle error:', err);
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(500).json({ error: 'Unable to update wishlist' });
        }
        res.redirect(req.get('Referer') || '/products');
    }
});

module.exports = router;
