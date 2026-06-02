const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const productService = require('../services/productService');
const orderService = require('../services/orderService');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
    try {
        const [products, orders, categories] = await Promise.all([
            productService.getAllProducts(),
            orderService.getAllOrders(),
            productService.getCategories(),
        ]);

        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            products,
            orders,
            categories,
            productCount: products.length,
            orderCount: orders.length,
        });
    } catch (err) {
        console.error('Admin dashboard error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load dashboard',
        });
    }
});

// manage products
router.get('/products', async (req, res) => {
    try {
        const products = await productService.getAllProducts();
        const categories = await productService.getCategories();
        res.render('admin/products', {
            title: 'Manage Products',
            products,
            categories,
        });
    } catch (err) {
        console.error('Admin products error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load products',
        });
    }
});

// add product form
router.get('/products/new', async (req, res) => {
    const categories = await productService.getCategories();
    res.render('admin/product-form', {
        title: 'Add Product',
        product: null,
        categories,
        errors: null,
    });
});

// create product
router.post('/products', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('stockQuantity').isInt({ min: 0 }).withMessage('Stock must be 0 or more'),
], async (req, res) => {
    const errors = validationResult(req);
    const categories = await productService.getCategories();

    if (!errors.isEmpty()) {
        return res.render('admin/product-form', {
            title: 'Add Product',
            product: req.body,
            categories,
            errors: errors.array(),
        });
    }

    try {
        await productService.createProduct({
            name: req.body.name,
            description: req.body.description,
            price: parseFloat(req.body.price),
            imageUrl: req.body.imageUrl,
            categoryId: req.body.categoryId || null,
            stockQuantity: parseInt(req.body.stockQuantity),
        });
        res.redirect('/admin/products');
    } catch (err) {
        res.render('admin/product-form', {
            title: 'Add Product',
            product: req.body,
            categories,
            errors: [{ msg: err.message }],
        });
    }
});

// edit form
router.get('/products/:id/edit', async (req, res) => {
    try {
        const [product, categories] = await Promise.all([
            productService.getProductById(req.params.id),
            productService.getCategories(),
        ]);

        if (!product) {
            return res.status(404).render('partials/error', {
                title: 'Not Found',
                message: 'Product not found',
            });
        }

        res.render('admin/product-form', {
            title: 'Edit Product',
            product,
            categories,
            errors: null,
        });
    } catch (err) {
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load product',
        });
    }
});

// update product
router.post('/products/:id', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('stockQuantity').isInt({ min: 0 }).withMessage('Stock must be 0 or more'),
], async (req, res) => {
    const errors = validationResult(req);
    const categories = await productService.getCategories();

    if (!errors.isEmpty()) {
        return res.render('admin/product-form', {
            title: 'Edit Product',
            product: { ...req.body, id: req.params.id },
            categories,
            errors: errors.array(),
        });
    }

    try {
        await productService.updateProduct(req.params.id, {
            name: req.body.name,
            description: req.body.description,
            price: parseFloat(req.body.price),
            imageUrl: req.body.imageUrl,
            categoryId: req.body.categoryId || null,
            stockQuantity: parseInt(req.body.stockQuantity),
        });
        res.redirect('/admin/products');
    } catch (err) {
        res.render('admin/product-form', {
            title: 'Edit Product',
            product: { ...req.body, id: req.params.id },
            categories,
            errors: [{ msg: err.message }],
        });
    }
});

// delete product
router.post('/products/:id/delete', async (req, res) => {
    try {
        await productService.deleteProduct(req.params.id);
        res.redirect('/admin/products');
    } catch (err) {
        res.status(400).render('partials/error', {
            title: 'Error',
            message: err.message,
        });
    }
});

module.exports = router;