const express = require('express');
const productService = require('../services/productService');
const wishlistService = require('../services/wishlistService');
const reviewService = require('../services/reviewService');
const variantService = require('../services/variantService');

const router = express.Router();

function isNumeric(value) {
    return /^\d+$/.test(String(value));
}

// list all products
router.get('/', async (req, res) => {
    try {
        // build filters from query string
        const filters = {};
        if (req.query.category) filters.categoryId = parseInt(req.query.category, 10) || req.query.category;
        if (req.query.brand) filters.brandId = parseInt(req.query.brand, 10) || req.query.brand;
        if (req.query.search) filters.search = req.query.search;
        if (req.query.tags) filters.tags = req.query.tags;
        if (req.query.minPrice) filters.minPrice = Number(req.query.minPrice);
        if (req.query.maxPrice) filters.maxPrice = Number(req.query.maxPrice);
        if (req.query.sort) filters.sort = req.query.sort;
        if (req.query.page) filters.page = parseInt(req.query.page, 10);
        if (req.query.pageSize) filters.pageSize = parseInt(req.query.pageSize, 10);
        if (req.query.minRating) filters.minRating = Number(req.query.minRating);

        const userId = req.session.user ? req.session.user.id : null;

        const [result, categories, brands, wishlistIds] = await Promise.all([
            productService.getAllProducts(filters),
            productService.getCategories(),
            productService.getBrands(),
            wishlistService.getWishlistProductIds(userId),
        ]);

        const { products, page, pageSize, hasMore } = result;

        // Track last browsed category for the home page
        if (req.query.category && categories.length) {
            const cat = categories.find(c => String(c.id) === String(req.query.category) || c.slug === req.query.category);
            if (cat) req.session.recentCategory = { id: cat.id, name: cat.name, slug: cat.slug };
        }

        res.render('products/list', {
            title: req.query.search ? `Search: ${req.query.search}` : (req.query.category ? 'Products by Category' : 'All Products'),
            products,
            categories,
            brands,
            selectedCategory: req.query.category || null,
            filters: req.query,
            page,
            pageSize,
            hasMore,
            wishlistIds,
        });
    } catch (err) {
        console.error('Product list error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load products',
        });
    }
});

// single product detail (slug or numeric id fallback)
router.get('/:identifier', async (req, res) => {
    try {
        const identifier = req.params.identifier;
        let product = await productService.getProductBySlug(identifier);

        if (!product && isNumeric(identifier)) {
            product = await productService.getProductById(parseInt(identifier, 10));
        }

        if (!product) {
            return res.status(404).render('partials/error', {
                title: 'Not Found',
                message: 'Product not found',
            });
        }

        // If we got product by slug, we need the full detail (with variants, etc.)
        if (!product.variants) {
            product = await productService.getProductById(product.id);
        }

        const userId = req.session.user ? req.session.user.id : null;

        const [reviews, reviewStats, relatedProducts, wishlistIds, hasReviewed] = await Promise.all([
            reviewService.getReviewsByProduct(product.id),
            reviewService.getReviewStats(product.id),
            productService.getRelatedProducts(product.id, product.category_id, 6),
            wishlistService.getWishlistProductIds(userId),
            reviewService.hasUserReviewed(userId, product.id),
        ]);

        // Track recently viewed products in session (max 8, most-recent-first)
        const viewed = req.session.recentlyViewed || [];
        const filtered = viewed.filter(id => id !== product.id);
        req.session.recentlyViewed = [product.id, ...filtered].slice(0, 8);

        // Increment views in background (fire-and-forget)
        productService.incrementViews(product.id).catch(() => {});

        res.render('products/detail', {
            title: product.name,
            product,
            reviews,
            reviewStats,
            relatedProducts,
            wishlistIds,
            hasReviewed,
        });
    } catch (err) {
        console.error('Product detail error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load product',
        });
    }
});

// product JSON (for quick-view / AJAX)
router.get('/:identifier/json', async (req, res) => {
    try {
        const identifier = req.params.identifier;
        let product = await productService.getProductBySlug(identifier);

        if (!product && isNumeric(identifier)) {
            product = await productService.getProductById(parseInt(identifier, 10));
        }

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json({ product });
    } catch (err) {
        console.error('Product JSON error:', err);
        res.status(500).json({ error: 'Unable to load product' });
    }
});

// Variant lookup by attribute values (AJAX)
router.get('/:id/variant', async (req, res) => {
    try {
        const productId = parseInt(req.params.id);
        const valueIds = req.query.values
            ? (Array.isArray(req.query.values) ? req.query.values : [req.query.values]).map(Number)
            : [];

        if (valueIds.length === 0) {
            return res.status(400).json({ error: 'No attribute values provided' });
        }

        const variant = await variantService.getVariantByAttributes(productId, valueIds);

        if (!variant) {
            return res.json({ variant: null, message: 'No matching variant found' });
        }

        res.json({ variant });
    } catch (err) {
        console.error('Variant lookup error:', err);
        res.status(500).json({ error: 'Unable to look up variant' });
    }
});

module.exports = router;