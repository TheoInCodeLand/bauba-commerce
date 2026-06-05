const db = require('../config/db');
const { slugify } = require('../utils/slugify');

async function getAllAttributes() {
    const result = await db.query('SELECT * FROM product_attributes ORDER BY sort_order, name');
    return result.rows;
}

async function getAttributeBySlug(slug) {
    const result = await db.query('SELECT * FROM product_attributes WHERE slug = $1 LIMIT 1', [slug]);
    return result.rows[0] || null;
}

async function createAttribute({ name, type, sortOrder }) {
    const slug = slugify(name);
    const result = await db.query(
        `INSERT INTO product_attributes (name, slug, type, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [name, slug, type || 'text', sortOrder || 0]
    );
    return result.rows[0];
}

async function updateAttribute(id, { name, type, sortOrder }) {
    const slug = slugify(name);
    const result = await db.query(
        `UPDATE product_attributes
         SET name = $1,
             slug = $2,
             type = $3,
             sort_order = $4
         WHERE id = $5
         RETURNING *`,
        [name, slug, type || 'text', sortOrder || 0, id]
    );
    return result.rows[0] || null;
}

async function deleteAttribute(id) {
    await db.query('DELETE FROM product_attributes WHERE id = $1', [id]);
    return true;
}

async function getValuesForAttribute(attributeId) {
    const result = await db.query(
        'SELECT * FROM product_attribute_values WHERE attribute_id = $1 ORDER BY sort_order, value',
        [attributeId]
    );
    return result.rows;
}

async function createAttributeValue({ attributeId, value, colorHex, sortOrder }) {
    const result = await db.query(
        `INSERT INTO product_attribute_values (attribute_id, value, color_hex, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [attributeId, value, colorHex || null, sortOrder || 0]
    );
    return result.rows[0];
}

async function updateAttributeValue(id, { value, colorHex, sortOrder }) {
    const result = await db.query(
        `UPDATE product_attribute_values
         SET value = $1,
             color_hex = $2,
             sort_order = $3
         WHERE id = $4
         RETURNING *`,
        [value, colorHex || null, sortOrder || 0, id]
    );
    return result.rows[0] || null;
}

async function deleteAttributeValue(id) {
    await db.query('DELETE FROM product_attribute_values WHERE id = $1', [id]);
    return true;
}

module.exports = {
    getAllAttributes,
    getAttributeBySlug,
    createAttribute,
    updateAttribute,
    deleteAttribute,
    getValuesForAttribute,
    createAttributeValue,
    updateAttributeValue,
    deleteAttributeValue,
};
