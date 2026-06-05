const db = require('../config/db');
const { slugify } = require('../utils/slugify');

async function getCategoryTree() {
    const result = await db.query(`
        WITH RECURSIVE tree AS (
            SELECT id, name, slug, parent_id, department_id, 0 as level
            FROM categories
            WHERE parent_id IS NULL
            UNION ALL
            SELECT c.id, c.name, c.slug, c.parent_id, c.department_id, tree.level + 1
            FROM categories c
            JOIN tree ON c.parent_id = tree.id
        )
        SELECT * FROM tree ORDER BY level, sort_order, name;
    `);
    return result.rows;
}

async function getCategoryBySlug(slug) {
    const categoryResult = await db.query('SELECT * FROM categories WHERE slug = $1 LIMIT 1', [slug]);
    const category = categoryResult.rows[0] || null;
    if (!category) return null;

    const breadcrumbResult = await db.query(`
        WITH RECURSIVE path AS (
            SELECT id, name, slug, parent_id
            FROM categories
            WHERE id = $1
            UNION ALL
            SELECT c.id, c.name, c.slug, c.parent_id
            FROM categories c
            JOIN path p ON c.id = p.parent_id
        )
        SELECT id, name, slug FROM path;
    `, [category.id]);

    const breadcrumb = breadcrumbResult.rows.reverse();
    return { ...category, breadcrumb };
}

async function getCategoryChildren(parentId) {
    const result = await db.query(
        'SELECT * FROM categories WHERE parent_id = $1 ORDER BY sort_order, name',
        [parentId]
    );
    return result.rows;
}

async function getFeaturedCategories() {
    const result = await db.query(
        'SELECT * FROM categories WHERE is_featured = true ORDER BY sort_order, name'
    );
    return result.rows;
}

async function getCategories() {
    const result = await db.query(`
        SELECT c.*, p.name AS parent_name, d.name AS department_name
        FROM categories c
        LEFT JOIN categories p ON p.id = c.parent_id
        LEFT JOIN departments d ON d.id = c.department_id
        ORDER BY c.sort_order, c.name
    `);
    return result.rows;
}

async function getCategoryById(id) {
    const result = await db.query(
        `SELECT c.*, p.name AS parent_name, d.name AS department_name
         FROM categories c
         LEFT JOIN categories p ON p.id = c.parent_id
         LEFT JOIN departments d ON d.id = c.department_id
         WHERE c.id = $1
         LIMIT 1`,
        [id]
    );
    return result.rows[0] || null;
}

async function createCategory({ name, description, parentId, departmentId, imageUrl, isFeatured, sortOrder }) {
    const slug = slugify(name);
    const result = await db.query(
        `INSERT INTO categories (name, description, parent_id, department_id, image_url, is_featured, sort_order, slug)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [name, description || null, parentId || null, departmentId || null, imageUrl || null, isFeatured || false, sortOrder || 0, slug]
    );
    return result.rows[0];
}

async function updateCategory(id, { name, description, parentId, departmentId, imageUrl, isFeatured, sortOrder }) {
    const slug = slugify(name);
    const result = await db.query(
        `UPDATE categories
         SET name = $1,
             description = $2,
             parent_id = $3,
             department_id = $4,
             image_url = $5,
             is_featured = $6,
             sort_order = $7,
             slug = $8
         WHERE id = $9
         RETURNING *`,
        [name, description || null, parentId || null, departmentId || null, imageUrl || null, isFeatured || false, sortOrder || 0, slug, id]
    );
    return result.rows[0] || null;
}

async function deleteCategory(id) {
    await db.query('DELETE FROM categories WHERE id = $1', [id]);
    return true;
}

module.exports = {
    getCategoryTree,
    getCategoryBySlug,
    getCategoryById,
    getCategoryChildren,
    getFeaturedCategories,
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
};
