const express = require('express');
const productService = require('../services/productService');

const router = express.Router();

router.get('/personalization/recently-viewed', async (req, res) => {
    try {
        const recentIds = req.session?.recentlyViewed || [];

        if (recentIds.length === 0) {
            return res.json({ products: [] });
        }

        const products = await productService.getRecentlyViewedProducts(recentIds);
        res.json({ products });
    } catch (err) {
        console.error('Personalization API Error:', err);
        res.status(500).json({ error: 'Failed to load personalized data' });
    }
});

module.exports = router;