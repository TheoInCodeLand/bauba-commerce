const db = require('../config/db');
const { slugify } = require('../utils/slugify');

async function getAllBrands() {
    const result = await db.query('SELECT * FROM brands ORDER BY name');
    return result.rows;
}

async function getBrandBySlug(slug) {
    const result = await db.query('SELECT * FROM brands WHERE slug = $1 LIMIT 1', [slug]);
    return result.rows[0] || null;
}

async function createBrand({ name, logoUrl, description, isActive }) {
    const slug = slugify(name);
    const result = await db.query(
        `INSERT INTO brands (name, slug, logo_url, description, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [name, slug, logoUrl || null, description || null, isActive !== false]
    );
    return result.rows[0];
}

async function updateBrand(id, { name, logoUrl, description, isActive }) {
    const slug = slugify(name);
    const result = await db.query(
        `UPDATE brands
         SET name = $1,
             slug = $2,
             logo_url = $3,
             description = $4,
             is_active = $5
         WHERE id = $6
         RETURNING *`,
        [name, slug, logoUrl || null, description || null, isActive !== false, id]
    );
    return result.rows[0] || null;
}

async function getBrandById(id) {
    const result = await db.query('SELECT * FROM brands WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] || null;
}

async function deleteBrand(id) {
    await db.query('DELETE FROM brands WHERE id = $1', [id]);
    return true;
}

async function getBrandsWithProductCount() {
    const result = await db.query(`
        SELECT b.*, COUNT(p.id) AS product_count
        FROM brands b
        LEFT JOIN products p ON p.brand_id = b.id
        GROUP BY b.id
        ORDER BY product_count DESC, b.name
    `);
    return result.rows;
}

module.exports = {
    getAllBrands,
    getBrandBySlug,
    getBrandById,
    createBrand,
    updateBrand,
    deleteBrand,
    getBrandsWithProductCount,
};
