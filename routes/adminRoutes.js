const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const productService = require('../services/productService');
const orderService = require('../services/orderService');
const brandService = require('../services/brandService');
const categoryService = require('../services/categoryService');
const tagService = require('../services/tagService');
const departmentService = require('../services/departmentService');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
    try {
        const [{ products }, orders, categories] = await Promise.all([
            productService.getAllProducts({ includeInactive: true, pageSize: 1000 }),
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
        const [{ products }, categories, brands] = await Promise.all([
            productService.getAllProducts({ includeInactive: true, pageSize: 1000 }),
            productService.getCategories(),
            brandService.getAllBrands(),
        ]);
        res.render('admin/products', {
            title: 'Manage Products',
            products,
            categories,
            brands,
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
    const [categories, categoryTree, brands] = await Promise.all([
        productService.getCategories(),
        categoryService.getCategoryTree(),
        brandService.getAllBrands(),
    ]);
    res.render('admin/product-form', {
        title: 'Add Product',
        product: null,
        categories,
        categoryTree,
        brands,
        errors: null,
    });
});

// create product
function parseDimensions(body) {
    const length = body.dimensionsLength ? parseFloat(body.dimensionsLength) : null;
    const width = body.dimensionsWidth ? parseFloat(body.dimensionsWidth) : null;
    const height = body.dimensionsHeight ? parseFloat(body.dimensionsHeight) : null;
    const unit = body.dimensionsUnit || null;

    if (length === null && width === null && height === null && !unit) {
        return null;
    }

    return { length, width, height, unit };
}

function parseGalleryInput(value) {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.map(url => String(url).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            return [];
        }

        try {
            const parsed = JSON.parse(trimmedValue);
            if (Array.isArray(parsed)) {
                return parsed.map(url => String(url).trim()).filter(Boolean);
            }
        } catch (_) {
            // not valid JSON, continue to comma-split
        }

        return trimmedValue.split(',').map(url => url.trim()).filter(Boolean);
    }

    return [];
}

function buildProductPayload(body) {
    return {
        name: body.name,
        description: body.description,
        price: parseFloat(body.price),
        shortDescription: body.shortDescription,
        imageUrl: body.imageUrl,
        categoryId: body.categoryId || null,
        stockQuantity: parseInt(body.stockQuantity, 10) || 0,
        brandId: body.brandId || null,
        sku: body.sku || null,
        barcode: body.barcode || null,
        discountPrice: body.discountPrice ? parseFloat(body.discountPrice) : null,
        costPrice: body.costPrice ? parseFloat(body.costPrice) : null,
        currency: body.currency || 'ZAR',
        productType: body.productType || 'physical',
        weight: body.weight ? parseFloat(body.weight) : null,
        dimensions: parseDimensions(body),
        shippingRequired: body.shippingRequired === 'on',
        isActive: body.isActive === 'on',
        isFeatured: body.isFeatured === 'on',
        isTrending: body.isTrending === 'on',
        isNewArrival: body.isNewArrival === 'on',
        publishedAt: body.publishedAt || null,
        gallery: parseGalleryInput(body.gallery),
        videoUrl: body.videoUrl || null,
        seoTitle: body.seoTitle || null,
        seoDescription: body.seoDescription || null,
        specifications: body.specifications ? JSON.parse(body.specifications) : {},
        variants: body.variants ? JSON.parse(body.variants) : [],
    };
}

router.post('/products', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('stockQuantity').isInt({ min: 0 }).withMessage('Stock must be 0 or more'),
], async (req, res) => {
    const errors = validationResult(req);
    const [categories, categoryTree, brands] = await Promise.all([
        productService.getCategories(),
        categoryService.getCategoryTree(),
        brandService.getAllBrands(),
    ]);

    if (!errors.isEmpty()) {
        return res.render('admin/product-form', {
            title: 'Add Product',
            product: req.body,
            categories,
            categoryTree,
            brands,
            errors: errors.array(),
        });
    }

    try {
        await productService.createProduct(buildProductPayload(req.body));
        res.redirect('/admin/products');
    } catch (err) {
        res.render('admin/product-form', {
            title: 'Add Product',
            product: req.body,
            categories,
            categoryTree,
            brands,
            errors: [{ msg: err.message }],
        });
    }
});

// edit form
router.get('/products/:id/edit', async (req, res) => {
    try {
        const [product, categories, categoryTree, brands] = await Promise.all([
            productService.getProductWithVariants(req.params.id),
            productService.getCategories(),
            categoryService.getCategoryTree(),
            brandService.getAllBrands(),
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
            categoryTree,
            brands,
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
    const [categories, categoryTree, brands] = await Promise.all([
        productService.getCategories(),
        categoryService.getCategoryTree(),
        brandService.getAllBrands(),
    ]);

    if (!errors.isEmpty()) {
        return res.render('admin/product-form', {
            title: 'Edit Product',
            product: { ...req.body, id: req.params.id },
            categories,
            categoryTree,
            brands,
            errors: errors.array(),
        });
    }

    try {
        await productService.updateProduct(req.params.id, buildProductPayload(req.body));
        res.redirect('/admin/products');
    } catch (err) {
        res.render('admin/product-form', {
            title: 'Edit Product',
            product: { ...req.body, id: req.params.id },
            categories,
            categoryTree,
            brands,
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

function buildCategoryPayload(body) {
    return {
        name: body.name,
        description: body.description,
        parentId: body.parentId || null,
        departmentId: body.departmentId || null,
        imageUrl: body.imageUrl || null,
        isFeatured: body.isFeatured === 'on',
        sortOrder: parseInt(body.sortOrder, 10) || 0,
    };
}

function buildBrandPayload(body) {
    return {
        name: body.name,
        logoUrl: body.logoUrl || null,
        description: body.description || null,
        isActive: body.isActive === 'on',
    };
}

function buildTagPayload(body) {
    return {
        name: body.name,
        type: body.type || 'general',
    };
}

function buildDepartmentPayload(body) {
    return {
        name: body.name,
        description: body.description,
        imageUrl: body.imageUrl || null,
        sortOrder: parseInt(body.sortOrder, 10) || 0,
        isActive: body.isActive === 'on',
    };
}

router.get('/categories', async (req, res) => {
    try {
        const [categories, departments] = await Promise.all([
            categoryService.getCategories(),
            departmentService.getAllDepartments(),
        ]);
        res.render('admin/categories/index', {
            title: 'Manage Categories',
            categories,
            departments,
            errors: null,
        });
    } catch (err) {
        console.error('Admin categories error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load categories',
        });
    }
});

router.get('/categories/new', async (req, res) => {
    try {
        const [categories, categoryTree, departments] = await Promise.all([
            categoryService.getCategories(),
            categoryService.getCategoryTree(),
            departmentService.getAllDepartments(),
        ]);
        res.render('admin/categories/form', {
            title: 'Add Category',
            category: null,
            categories,
            categoryTree,
            departments,
            errors: null,
        });
    } catch (err) {
        console.error('Admin category form error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load category form',
        });
    }
});

router.post('/categories', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('sortOrder').optional({ checkFalsy: true }).isInt({ min: 0 }).withMessage('Sort order must be a positive integer'),
], async (req, res) => {
    const errors = validationResult(req);
    const [categories, categoryTree, departments] = await Promise.all([
        categoryService.getCategories(),
        categoryService.getCategoryTree(),
        departmentService.getAllDepartments(),
    ]);

    if (!errors.isEmpty()) {
        return res.render('admin/categories/form', {
            title: 'Add Category',
            category: req.body,
            categories,
            categoryTree,
            departments,
            errors: errors.array(),
        });
    }

    try {
        await categoryService.createCategory(buildCategoryPayload(req.body));
        res.redirect('/admin/categories');
    } catch (err) {
        res.render('admin/categories/form', {
            title: 'Add Category',
            category: req.body,
            categories,
            categoryTree,
            departments,
            errors: [{ msg: err.message }],
        });
    }
});

router.get('/categories/:id/edit', async (req, res) => {
    try {
        const [category, categories, categoryTree, departments] = await Promise.all([
            categoryService.getCategoryById(req.params.id),
            categoryService.getCategories(),
            categoryService.getCategoryTree(),
            departmentService.getAllDepartments(),
        ]);

        if (!category) {
            return res.status(404).render('partials/error', {
                title: 'Not Found',
                message: 'Category not found',
            });
        }

        res.render('admin/categories/form', {
            title: 'Edit Category',
            category,
            categories,
            categoryTree,
            departments,
            errors: null,
        });
    } catch (err) {
        console.error('Admin category edit error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load category edit form',
        });
    }
});

router.post('/categories/:id', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('sortOrder').optional({ checkFalsy: true }).isInt({ min: 0 }).withMessage('Sort order must be a positive integer'),
], async (req, res) => {
    const errors = validationResult(req);
    const [categories, categoryTree, departments] = await Promise.all([
        categoryService.getCategories(),
        categoryService.getCategoryTree(),
        departmentService.getAllDepartments(),
    ]);

    if (!errors.isEmpty()) {
        return res.render('admin/categories/form', {
            title: 'Edit Category',
            category: { ...req.body, id: req.params.id },
            categories,
            categoryTree,
            departments,
            errors: errors.array(),
        });
    }

    try {
        await categoryService.updateCategory(req.params.id, buildCategoryPayload(req.body));
        res.redirect('/admin/categories');
    } catch (err) {
        res.render('admin/categories/form', {
            title: 'Edit Category',
            category: { ...req.body, id: req.params.id },
            categories,
            categoryTree,
            departments,
            errors: [{ msg: err.message }],
        });
    }
});

router.post('/categories/:id/delete', async (req, res) => {
    try {
        await categoryService.deleteCategory(req.params.id);
        res.redirect('/admin/categories');
    } catch (err) {
        res.status(400).render('partials/error', {
            title: 'Error',
            message: err.message,
        });
    }
});

router.get('/brands', async (req, res) => {
    try {
        const brands = await brandService.getBrandsWithProductCount();
        res.render('admin/brands/index', {
            title: 'Manage Brands',
            brands,
        });
    } catch (err) {
        console.error('Admin brands error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load brands',
        });
    }
});

router.get('/brands/new', (req, res) => {
    res.render('admin/brands/form', {
        title: 'Add Brand',
        brand: null,
        errors: null,
    });
});

router.post('/brands', [
    body('name').trim().notEmpty().withMessage('Name is required'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('admin/brands/form', {
            title: 'Add Brand',
            brand: req.body,
            errors: errors.array(),
        });
    }

    try {
        await brandService.createBrand(buildBrandPayload(req.body));
        res.redirect('/admin/brands');
    } catch (err) {
        res.render('admin/brands/form', {
            title: 'Add Brand',
            brand: req.body,
            errors: [{ msg: err.message }],
        });
    }
});

router.get('/brands/:id/edit', async (req, res) => {
    try {
        const brand = await brandService.getBrandById(req.params.id);
        if (!brand) {
            return res.status(404).render('partials/error', {
                title: 'Not Found',
                message: 'Brand not found',
            });
        }
        res.render('admin/brands/form', {
            title: 'Edit Brand',
            brand,
            errors: null,
        });
    } catch (err) {
        console.error('Admin brand edit error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load brand edit form',
        });
    }
});

router.post('/brands/:id', [
    body('name').trim().notEmpty().withMessage('Name is required'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('admin/brands/form', {
            title: 'Edit Brand',
            brand: { ...req.body, id: req.params.id },
            errors: errors.array(),
        });
    }

    try {
        await brandService.updateBrand(req.params.id, buildBrandPayload(req.body));
        res.redirect('/admin/brands');
    } catch (err) {
        res.render('admin/brands/form', {
            title: 'Edit Brand',
            brand: { ...req.body, id: req.params.id },
            errors: [{ msg: err.message }],
        });
    }
});

router.post('/brands/:id/delete', async (req, res) => {
    try {
        await brandService.deleteBrand(req.params.id);
        res.redirect('/admin/brands');
    } catch (err) {
        res.status(400).render('partials/error', {
            title: 'Error',
            message: err.message,
        });
    }
});

router.get('/tags', async (req, res) => {
    try {
        const tags = await tagService.getAllTags();
        res.render('admin/tags/index', {
            title: 'Manage Tags',
            tags,
        });
    } catch (err) {
        console.error('Admin tags error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load tags',
        });
    }
});

router.get('/tags/new', (req, res) => {
    res.render('admin/tags/form', {
        title: 'Add Tag',
        tag: null,
        errors: null,
    });
});

router.post('/tags', [
    body('name').trim().notEmpty().withMessage('Name is required'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('admin/tags/form', {
            title: 'Add Tag',
            tag: req.body,
            errors: errors.array(),
        });
    }

    try {
        await tagService.createTag(buildTagPayload(req.body));
        res.redirect('/admin/tags');
    } catch (err) {
        res.render('admin/tags/form', {
            title: 'Add Tag',
            tag: req.body,
            errors: [{ msg: err.message }],
        });
    }
});

router.get('/tags/:id/edit', async (req, res) => {
    try {
        const tag = await tagService.getTagById(req.params.id);
        if (!tag) {
            return res.status(404).render('partials/error', {
                title: 'Not Found',
                message: 'Tag not found',
            });
        }
        res.render('admin/tags/form', {
            title: 'Edit Tag',
            tag,
            errors: null,
        });
    } catch (err) {
        console.error('Admin tag edit error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load tag edit form',
        });
    }
});

router.post('/tags/:id', [
    body('name').trim().notEmpty().withMessage('Name is required'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('admin/tags/form', {
            title: 'Edit Tag',
            tag: { ...req.body, id: req.params.id },
            errors: errors.array(),
        });
    }

    try {
        await tagService.updateTag(req.params.id, buildTagPayload(req.body));
        res.redirect('/admin/tags');
    } catch (err) {
        res.render('admin/tags/form', {
            title: 'Edit Tag',
            tag: { ...req.body, id: req.params.id },
            errors: [{ msg: err.message }],
        });
    }
});

router.post('/tags/:id/delete', async (req, res) => {
    try {
        await tagService.deleteTag(req.params.id);
        res.redirect('/admin/tags');
    } catch (err) {
        res.status(400).render('partials/error', {
            title: 'Error',
            message: err.message,
        });
    }
});

router.get('/departments', async (req, res) => {
    try {
        const departments = await departmentService.getAllDepartments();
        res.render('admin/departments/index', {
            title: 'Manage Departments',
            departments,
        });
    } catch (err) {
        console.error('Admin departments error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load departments',
        });
    }
});

router.get('/departments/new', (req, res) => {
    res.render('admin/departments/form', {
        title: 'Add Department',
        department: null,
        errors: null,
    });
});

router.post('/departments', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('sortOrder').optional({ checkFalsy: true }).isInt({ min: 0 }).withMessage('Sort order must be a positive integer'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('admin/departments/form', {
            title: 'Add Department',
            department: req.body,
            errors: errors.array(),
        });
    }

    try {
        await departmentService.createDepartment(buildDepartmentPayload(req.body));
        res.redirect('/admin/departments');
    } catch (err) {
        res.render('admin/departments/form', {
            title: 'Add Department',
            department: req.body,
            errors: [{ msg: err.message }],
        });
    }
});

router.get('/departments/:id/edit', async (req, res) => {
    try {
        const department = await departmentService.getDepartmentById(req.params.id);
        if (!department) {
            return res.status(404).render('partials/error', {
                title: 'Not Found',
                message: 'Department not found',
            });
        }
        res.render('admin/departments/form', {
            title: 'Edit Department',
            department,
            errors: null,
        });
    } catch (err) {
        console.error('Admin department edit error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load department edit form',
        });
    }
});

router.post('/departments/:id', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('sortOrder').optional({ checkFalsy: true }).isInt({ min: 0 }).withMessage('Sort order must be a positive integer'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('admin/departments/form', {
            title: 'Edit Department',
            department: { ...req.body, id: req.params.id },
            errors: errors.array(),
        });
    }

    try {
        await departmentService.updateDepartment(req.params.id, buildDepartmentPayload(req.body));
        res.redirect('/admin/departments');
    } catch (err) {
        res.render('admin/departments/form', {
            title: 'Edit Department',
            department: { ...req.body, id: req.params.id },
            errors: [{ msg: err.message }],
        });
    }
});

router.post('/departments/:id/delete', async (req, res) => {
    try {
        await departmentService.deleteDepartment(req.params.id);
        res.redirect('/admin/departments');
    } catch (err) {
        res.status(400).render('partials/error', {
            title: 'Error',
            message: err.message,
        });
    }
});

module.exports = router;