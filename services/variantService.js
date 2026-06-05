const db = require('../config/db');

async function getVariantsByProduct(productId) {
    const result = await db.query(
        `SELECT * FROM product_variants WHERE product_id = $1 AND is_active = true ORDER BY sort_order, created_at DESC`,
        [productId]
    );
    return result.rows;
}

async function createVariant({ productId, sku, barcode, priceOverride, costPrice, stockQuantity, lowStockThreshold, weight, imageUrl, isActive, sortOrder }) {
    const result = await db.query(
        `INSERT INTO product_variants (
            product_id, sku, barcode, price_override, cost_price,
            stock_quantity, low_stock_threshold, weight, image_url, is_active, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
            productId,
            sku || null,
            barcode || null,
            priceOverride || null,
            costPrice || null,
            stockQuantity || 0,
            lowStockThreshold || 5,
            weight || null,
            imageUrl || null,
            isActive !== false,
            sortOrder || 0,
        ]
    );
    return result.rows[0];
}

async function updateVariant(id, { sku, barcode, priceOverride, costPrice, stockQuantity, lowStockThreshold, weight, imageUrl, isActive, sortOrder }) {
    const result = await db.query(
        `UPDATE product_variants
         SET sku = $1,
             barcode = $2,
             price_override = $3,
             cost_price = $4,
             stock_quantity = $5,
             low_stock_threshold = $6,
             weight = $7,
             image_url = $8,
             is_active = $9,
             sort_order = $10
         WHERE id = $11
         RETURNING *`,
        [
            sku || null,
            barcode || null,
            priceOverride || null,
            costPrice || null,
            stockQuantity || 0,
            lowStockThreshold || 5,
            weight || null,
            imageUrl || null,
            isActive !== false,
            sortOrder || 0,
            id,
        ]
    );
    return result.rows[0] || null;
}

async function deleteVariant(id) {
    await db.query('DELETE FROM product_variants WHERE id = $1', [id]);
    return true;
}

async function getVariantByAttributes(productId, attributeValueIds = []) {
    if (!Array.isArray(attributeValueIds) || attributeValueIds.length === 0) {
        return null;
    }

    const result = await db.query(
        `SELECT pv.*
         FROM product_variants pv
         JOIN variant_attribute_values vav ON vav.variant_id = pv.id
         WHERE pv.product_id = $1
           AND vav.attribute_value_id = ANY($2)
         GROUP BY pv.id
         HAVING COUNT(DISTINCT vav.attribute_value_id) = $3
         LIMIT 1`,
        [productId, attributeValueIds, attributeValueIds.length]
    );
    return result.rows[0] || null;
}

module.exports = {
    getVariantsByProduct,
    createVariant,
    updateVariant,
    deleteVariant,
    getVariantByAttributes,
};
