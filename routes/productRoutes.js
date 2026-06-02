const express = require('express');
const productService = require('../services/productService');

const router = express.Router();

// list all products
router.get('/', async (req, res) => {
    try {
        const categoryId = req.query.category || null;
        const [products, categories] = await Promise.all([
            productService.getAllProducts(categoryId),
            productService.getCategories(),
        ]);

        res.render('products/list', {
            title: categoryId ? 'Products by Category' : 'All Products',
            products,
            categories,
            selectedCategory: categoryId,
        });
    } catch (err) {
        console.error('Product list error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load products',
        });
    }
});

// single product detail
router.get('/:id', async (req, res) => {
    try {
        const product = await productService.getProductById(req.params.id);

        if (!product) {
            return res.status(404).render('partials/error', {
                title: 'Not Found',
                message: 'Product not found',
            });
        }

        res.render('products/detail', {
            title: product.name,
            product,
        });
    } catch (err) {
        console.error('Product detail error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load product',
        });
    }
});

module.exports = router;