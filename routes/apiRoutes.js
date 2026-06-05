const express = require('express');
const productService = require('../services/productService');
const redisClient = require('../config/redis');

const router = express.Router();

// Helper: get category from last viewed product
async function getRecentCategory(req) {
    const recentIds = req.session?.recentlyViewed || [];
    if (recentIds.length === 0) return null;

    // Get the most recently viewed product
    const products = await productService.getRecentlyViewedProducts(recentIds.slice(0, 1));
    if (!products || products.length === 0) return null;

    const product = products[0];
    if (!product.category_id) return null;

    return {
        id: product.category_id,
        name: product.category_name || 'Category'
    };
}

router.get('/personalization/recently-viewed', async (req, res) => {
    try {
        const recentIds = req.session?.recentlyViewed || [];

        if (recentIds.length === 0) {
            return res.json({ products: [], recentCategory: null });
        }

        const [products, recentCategory] = await Promise.all([
            productService.getRecentlyViewedProducts(recentIds),
            getRecentCategory(req)
        ]);

        res.json({ products, recentCategory });
    } catch (err) {
        console.error('Personalization API Error:', err);
        res.status(500).json({ error: 'Failed to load personalized data' });
    }
});

router.post('/personalization/clear-recently-viewed', async (req, res) => {
    try {
        if (req.session) {
            req.session.recentlyViewed = [];
            await req.session.save?.();
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Clear Recently Viewed Error:', err);
        res.status(500).json({ error: 'Failed to clear recently viewed' });
    }
});

router.get('/personalization/recommendations/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const recsJson = await redisClient.get(`recs:product:${productId}`);

        if (!recsJson) {
            return res.json({ products: [] });
        }

        const recIds = JSON.parse(recsJson);
        if (!recIds || recIds.length === 0) {
            return res.json({ products: [] });
        }

        const products = await productService.getRecentlyViewedProducts(recIds);
        res.json({ products });
    } catch (err) {
        console.error('ML Recommendation API Error:', err);
        res.json({ products: [] });
    }
});

module.exports = router;