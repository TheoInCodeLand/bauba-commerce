const db = require('../config/db');

/**
 * Get all products with optional category filter
 */
async function getAllProducts(categoryId = null) {
    let query = `
    SELECT p.*, c.name as category_name 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id
  `;
    const params = [];

    if (categoryId) {
        query += ' WHERE p.category_id = $1';
        params.push(categoryId);
    }

    query += ' ORDER BY p.created_at DESC';

    const result = await db.query(query, params);
    return result.rows;
}

/**
 * Get single product by ID
 */
async function getProductById(id) {
    const result = await db.query(
        `SELECT p.*, c.name as category_name 
     FROM products p 
     LEFT JOIN categories c ON p.category_id = c.id 
     WHERE p.id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

/**
 * Create new product (admin only)
 */
async function createProduct({ name, description, price, imageUrl, categoryId, stockQuantity }) {
    const result = await db.query(
        `INSERT INTO products (name, description, price, image_url, category_id, stock_quantity) 
     VALUES ($1, $2, $3, $4, $5, $6) 
     RETURNING *`,
        [name, description, price, imageUrl, categoryId || null, stockQuantity || 0]
    );
    return result.rows[0];
}

/**
 * Update product (admin only)
 */
async function updateProduct(id, { name, description, price, imageUrl, categoryId, stockQuantity }) {
    const result = await db.query(
        `UPDATE products 
     SET name = $1, description = $2, price = $3, image_url = $4, 
         category_id = $5, stock_quantity = $6, updated_at = CURRENT_TIMESTAMP
     WHERE id = $7 
     RETURNING *`,
        [name, description, price, imageUrl, categoryId || null, stockQuantity || 0, id]
    );
    return result.rows[0] || null;
}

/**
 * Delete product (admin only)
 */
async function deleteProduct(id) {
    // Check if product exists in any order_items (can't delete if ordered)
    const orderCheck = await db.query(
        'SELECT id FROM order_items WHERE product_id = $1 LIMIT 1',
        [id]
    );

    if (orderCheck.rows.length > 0) {
        throw new Error('Cannot delete product that has been ordered');
    }

    await db.query('DELETE FROM products WHERE id = $1', [id]);
    return true;
}

/**
 * Get all categories for filtering/admin forms
 */
async function getCategories() {
    const result = await db.query('SELECT * FROM categories ORDER BY name');
    return result.rows;
}

module.exports = {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getCategories,
};