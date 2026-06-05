const db = require('../config/db');
const { slugify } = require('../utils/slugify');

async function getAllTags() {
    const result = await db.query('SELECT * FROM tags ORDER BY name');
    return result.rows;
}

async function getTagsByType(type) {
    const query = type ? 'SELECT * FROM tags WHERE type = $1 ORDER BY name' : 'SELECT * FROM tags ORDER BY name';
    const result = await db.query(query, type ? [type] : []);
    return result.rows;
}

async function createTag({ name, type }) {
    const slug = slugify(name);
    const result = await db.query(
        `INSERT INTO tags (name, slug, type)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [name, slug, type || 'general']
    );
    return result.rows[0];
}

async function getTagById(id) {
    const result = await db.query('SELECT * FROM tags WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] || null;
}

async function updateTag(id, { name, type }) {
    const slug = slugify(name);
    const result = await db.query(
        `UPDATE tags
         SET name = $1,
             slug = $2,
             type = $3
         WHERE id = $4
         RETURNING *`,
        [name, slug, type || 'general', id]
    );
    return result.rows[0] || null;
}

async function deleteTag(id) {
    await db.query('DELETE FROM tags WHERE id = $1', [id]);
    return true;
}

async function addTagsToProduct(productId, tagIds = []) {
    if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return [];
    }
    const inserts = tagIds.map((tagId) => `(${productId}, ${tagId})`).join(',');
    await db.query(`INSERT INTO product_tags (product_id, tag_id) VALUES ${inserts} ON CONFLICT DO NOTHING`);
    return getAllTagsForProduct(productId);
}

async function removeTagFromProduct(productId, tagId) {
    await db.query('DELETE FROM product_tags WHERE product_id = $1 AND tag_id = $2', [productId, tagId]);
    return true;
}

async function getAllTagsForProduct(productId) {
    const result = await db.query(
        `SELECT t.*
         FROM tags t
         JOIN product_tags pt ON pt.tag_id = t.id
         WHERE pt.product_id = $1
         ORDER BY t.name`,
        [productId]
    );
    return result.rows;
}

async function getProductsByTag(tagSlug, limit = 24) {
    const result = await db.query(
        `SELECT p.*
         FROM products p
         JOIN product_tags pt ON pt.product_id = p.id
         JOIN tags t ON t.id = pt.tag_id
         WHERE t.slug = $1
         ORDER BY p.created_at DESC
         LIMIT $2`,
        [tagSlug, limit]
    );
    return result.rows;
}

module.exports = {
    getAllTags,
    getTagsByType,
    createTag,
    getTagById,
    deleteTag,
    addTagsToProduct,
    removeTagFromProduct,
    getProductsByTag,
    getAllTagsForProduct,
};
