const db = require('../config/db');
const { slugify } = require('../utils/slugify');

function normalizeFilters(filters = {}) {
    if (filters === null || typeof filters !== 'object') {
        return { categoryId: filters };
    }
    return filters;
}

function isNumeric(value) {
    return /^\d+$/.test(String(value));
}

async function safeQuery(query, params = []) {
    try {
        const result = await db.query(query, params);
        return result.rows;
    } catch (err) {
        if (err.code === '42P01' || err.code === '42703') {
            return [];
        }
        throw err;
    }
}

async function getAllProducts(filters = {}) {
    filters = normalizeFilters(filters);
    const params = [];
    const clauses = [];
    let joins = '';

    if (filters.categoryId) {
        clauses.push('p.category_id = $' + (params.push(filters.categoryId) && params.length));
    }

    if (filters.brandId) {
        clauses.push('p.brand_id = $' + (params.push(filters.brandId) && params.length));
    }

    if (filters.minPrice != null) {
        clauses.push('COALESCE(p.discount_price, p.price) >= $' + (params.push(filters.minPrice) && params.length));
    }

    if (filters.maxPrice != null) {
        clauses.push('COALESCE(p.discount_price, p.price) <= $' + (params.push(filters.maxPrice) && params.length));
    }

    if (filters.minRating != null) {
        clauses.push('COALESCE(p.average_rating, 0) >= $' + (params.push(filters.minRating) && params.length));
    }

    if (filters.search) {
        clauses.push("to_tsvector('english', coalesce(p.name, '') || ' ' || coalesce(p.description, '')) @@ plainto_tsquery('english', $" + (params.push(filters.search) && params.length) + ")");
    }

    if (filters.tags) {
        joins += ' JOIN product_tags pt ON pt.product_id = p.id JOIN tags t ON t.id = pt.tag_id';
        const tagValues = Array.isArray(filters.tags) ? filters.tags : [filters.tags];
        clauses.push('t.slug = ANY($' + (params.push(tagValues) && params.length) + ')');
    }

    if (filters.includeInactive !== true) {
        clauses.push('COALESCE(p.is_active, true) = true');
    }

    const orderMap = {
        newest: 'p.created_at DESC',
        oldest: 'p.created_at ASC',
        price_asc: 'COALESCE(p.discount_price, p.price) ASC',
        price_desc: 'COALESCE(p.discount_price, p.price) DESC',
        name: 'p.name ASC',
    };

    const sort = orderMap[filters.sort] || orderMap.newest;
    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(filters.pageSize, 10) || 24));
    const limitParam = pageSize + 1;

    let query = `SELECT p.*, c.name AS category_name, b.name AS brand_name
        FROM (
            SELECT DISTINCT p.id
            FROM products p
            ${joins}`;

    if (clauses.length) {
        query += ' WHERE ' + clauses.join(' AND ');
    }

    query += ` ) AS filtered_ids
        JOIN products p ON p.id = filtered_ids.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN brands b ON p.brand_id = b.id
        ORDER BY ${sort}
        LIMIT $${params.push(limitParam) && params.length}
        OFFSET $${params.push((page - 1) * pageSize) && params.length}`;

    const result = await db.query(query, params);
    const rows = result.rows || [];
    const hasMore = rows.length > pageSize;
    const products = hasMore ? rows.slice(0, pageSize) : rows;

    return { products, page, pageSize, hasMore };
}

async function getProductBySlug(slug) {
    const result = await db.query(
        `SELECT p.*, c.name as category_name, b.name as brand_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN brands b ON p.brand_id = b.id
         WHERE p.slug = $1
         LIMIT 1`,
        [slug]
    );
    return result.rows[0] || null;
}

async function getProductById(id) {
    const result = await db.query(
        `SELECT p.*, c.name as category_name, b.name as brand_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN brands b ON p.brand_id = b.id
         WHERE p.id = $1`,
        [id]
    );

    const product = result.rows[0] || null;
    if (!product) {
        return null;
    }

    const [variants, tags, relationships, variantAttributes] = await Promise.all([
        safeQuery('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY sort_order, created_at DESC', [id]),
        safeQuery(
            `SELECT t.*
             FROM tags t
             JOIN product_tags pt ON pt.tag_id = t.id
             WHERE pt.product_id = $1
             ORDER BY t.name`,
            [id]
        ),
        safeQuery(
            `SELECT r.*, rp.name AS related_name, rp.slug AS related_slug,
                    rp.image_url AS related_image, rp.price AS related_price,
                    rp.discount_price AS related_discount_price
             FROM product_relationships r
             JOIN products rp ON rp.id = r.related_product_id
             WHERE r.product_id = $1`,
            [id]
        ),
        // Load variant attribute values grouped by attribute name
        safeQuery(
            `SELECT pa.id AS attribute_id, pa.name AS attribute_name, pa.slug AS attribute_slug,
                    pa.type AS attribute_type, pa.sort_order AS attribute_sort,
                    pav.id AS value_id, pav.value, pav.color_hex, pav.sort_order AS value_sort,
                    pv.id AS variant_id
             FROM product_variants pv
             JOIN variant_attribute_values vav ON vav.variant_id = pv.id
             JOIN product_attribute_values pav ON pav.id = vav.attribute_value_id
             JOIN product_attributes pa ON pa.id = pav.attribute_id
             WHERE pv.product_id = $1 AND pv.is_active = true
             ORDER BY pa.sort_order, pav.sort_order`,
            [id]
        ),
    ]);

    // Group attributes for the variant selector UX
    const attributeGroups = {};
    for (const row of variantAttributes) {
        if (!attributeGroups[row.attribute_name]) {
            attributeGroups[row.attribute_name] = {
                id: row.attribute_id,
                name: row.attribute_name,
                slug: row.attribute_slug,
                type: row.attribute_type,
                values: [],
                seenValues: new Set(),
            };
        }
        const group = attributeGroups[row.attribute_name];
        if (!group.seenValues.has(row.value_id)) {
            group.seenValues.add(row.value_id);
            group.values.push({
                id: row.value_id,
                value: row.value,
                colorHex: row.color_hex,
            });
        }
    }
    // Clean up seenValues sets before returning
    Object.values(attributeGroups).forEach(g => delete g.seenValues);

    // Build variant-to-attributes map for JS lookup
    const variantAttributeMap = {};
    for (const row of variantAttributes) {
        if (!variantAttributeMap[row.variant_id]) {
            variantAttributeMap[row.variant_id] = [];
        }
        variantAttributeMap[row.variant_id].push(row.value_id);
    }

    return {
        ...product,
        variants,
        tags,
        relationships,
        attributeGroups: Object.values(attributeGroups),
        variantAttributeMap,
    };
}

async function createProduct(payload) {
    const {
        name,
        description,
        price,
        imageUrl,
        categoryId,
        stockQuantity,
        shortDescription,
        brandId,
        sku,
        barcode,
        discountPrice,
        costPrice,
        currency = 'ZAR',
        productType = 'physical',
        weight,
        dimensions,
        shippingRequired = true,
        isActive = true,
        isFeatured = false,
        isTrending = false,
        isNewArrival = false,
        publishedAt,
        gallery,
        videoUrl,
        seoTitle,
        seoDescription,
    } = payload;

    const slug = slugify(name);
    const result = await db.query(
        `INSERT INTO products (
            name, description, price, image_url, category_id, stock_quantity,
            slug, short_description, brand_id, sku, barcode, discount_price,
            cost_price, currency, product_type, weight, dimensions,
            shipping_required, is_active, is_featured, is_trending, is_new_arrival,
            published_at, gallery, video_url, seo_title, seo_description
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
         RETURNING *`,
        [
            name,
            description || null,
            price,
            imageUrl || null,
            categoryId || null,
            stockQuantity || 0,
            slug,
            shortDescription || null,
            brandId || null,
            sku || null,
            barcode || null,
            discountPrice || null,
            costPrice || null,
            currency,
            productType,
            weight || null,
            dimensions || null,
            shippingRequired,
            isActive,
            isFeatured,
            isTrending,
            isNewArrival,
            publishedAt || null,
            gallery || null,
            videoUrl || null,
            seoTitle || null,
            seoDescription || null,
        ]
    );
    return result.rows[0];
}

async function updateProduct(id, payload) {
    const {
        name,
        description,
        price,
        imageUrl,
        categoryId,
        stockQuantity,
        shortDescription,
        brandId,
        sku,
        barcode,
        discountPrice,
        costPrice,
        currency,
        productType,
        weight,
        dimensions,
        shippingRequired,
        isActive,
        isFeatured,
        isTrending,
        isNewArrival,
        publishedAt,
        gallery,
        videoUrl,
        seoTitle,
        seoDescription,
    } = payload;

    const slug = name ? slugify(name) : null;
    const result = await db.query(
        `UPDATE products
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             price = COALESCE($3, price),
             image_url = COALESCE($4, image_url),
             category_id = COALESCE($5, category_id),
             stock_quantity = COALESCE($6, stock_quantity),
             slug = COALESCE($7, slug),
             short_description = COALESCE($8, short_description),
             brand_id = COALESCE($9, brand_id),
             sku = COALESCE($10, sku),
             barcode = COALESCE($11, barcode),
             discount_price = COALESCE($12, discount_price),
             cost_price = COALESCE($13, cost_price),
             currency = COALESCE($14, currency),
             product_type = COALESCE($15, product_type),
             weight = COALESCE($16, weight),
             dimensions = COALESCE($17, dimensions),
             shipping_required = COALESCE($18, shipping_required),
             is_active = COALESCE($19, is_active),
             is_featured = COALESCE($20, is_featured),
             is_trending = COALESCE($21, is_trending),
             is_new_arrival = COALESCE($22, is_new_arrival),
             published_at = COALESCE($23, published_at),
             gallery = COALESCE($24, gallery),
             video_url = COALESCE($25, video_url),
             seo_title = COALESCE($26, seo_title),
             seo_description = COALESCE($27, seo_description),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $28
         RETURNING *`,
        [
            name || null,
            description || null,
            price || null,
            imageUrl || null,
            categoryId || null,
            stockQuantity || null,
            slug,
            shortDescription || null,
            brandId || null,
            sku || null,
            barcode || null,
            discountPrice || null,
            costPrice || null,
            currency || null,
            productType || null,
            weight || null,
            dimensions || null,
            shippingRequired || null,
            isActive || null,
            isFeatured || null,
            isTrending || null,
            isNewArrival || null,
            publishedAt || null,
            gallery || null,
            videoUrl || null,
            seoTitle || null,
            seoDescription || null,
            id,
        ]
    );
    return result.rows[0] || null;
}

async function deleteProduct(id) {
    const orderCheck = await db.query('SELECT id FROM order_items WHERE product_id = $1 LIMIT 1', [id]);
    if (orderCheck.rows.length > 0) {
        throw new Error('Cannot delete product that has been ordered');
    }
    await db.query('DELETE FROM products WHERE id = $1', [id]);
    return true;
}

async function incrementViews(productId) {
    await db.query('UPDATE products SET total_views = COALESCE(total_views, 0) + 1 WHERE id = $1', [productId]);
}

async function getFeaturedProducts(limit = 12) {
    const result = await db.query(
        `SELECT * FROM products
         WHERE COALESCE(is_active, true) = true
           AND is_featured = true
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
    );
    return result.rows;
}

async function getTrendingProducts(limit = 12) {
    const result = await db.query(
        `SELECT * FROM products
         WHERE COALESCE(is_active, true) = true
           AND is_trending = true
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
    );
    return result.rows;
}

async function getNewArrivals(limit = 12) {
    const result = await db.query(
        `SELECT * FROM products
         WHERE COALESCE(is_active, true) = true
           AND is_new_arrival = true
         ORDER BY published_at DESC NULLS LAST, created_at DESC
         LIMIT $1`,
        [limit]
    );
    return result.rows;
}

async function getCategories() {
    const result = await db.query('SELECT * FROM categories ORDER BY name');
    return result.rows;
}

async function getBrands() {
    try {
        const result = await db.query('SELECT * FROM brands WHERE COALESCE(is_active, true) = true ORDER BY name');
        return result.rows;
    } catch (err) {
        return [];
    }
}

async function getRelatedProducts(productId, categoryId, limit = 6) {
    // 1. Manually-set relationships
    const manual = await safeQuery(
        `SELECT p.*, c.name AS category_name
         FROM product_relationships r
         JOIN products p ON p.id = r.related_product_id
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE r.product_id = $1
           AND COALESCE(p.is_active, true) = true
         ORDER BY p.created_at DESC
         LIMIT $2`,
        [productId, limit]
    );

    if (manual.length >= limit) {
        return manual.slice(0, limit);
    }

    // 2. Same-category products
    const excludeIds = [productId, ...manual.map(p => p.id)];
    let remaining = limit - manual.length;

    let categoryProducts = [];
    if (categoryId) {
        categoryProducts = await safeQuery(
            `SELECT p.*, c.name AS category_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.category_id = $1
               AND p.id != ALL($2)
               AND COALESCE(p.is_active, true) = true
             ORDER BY p.total_views DESC NULLS LAST, p.created_at DESC
             LIMIT $3`,
            [categoryId, excludeIds, remaining]
        );
    }

    const combined = [...manual, ...categoryProducts];
    remaining = limit - combined.length;

    // 3. Fallback: trending/featured products
    if (remaining > 0) {
        const allIds = combined.map(p => p.id).concat([productId]);
        const fallback = await safeQuery(
            `SELECT p.*, c.name AS category_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             WHERE p.id != ALL($1)
               AND COALESCE(p.is_active, true) = true
             ORDER BY p.is_trending DESC, p.is_featured DESC, p.total_views DESC NULLS LAST
             LIMIT $2`,
            [allIds, remaining]
        );
        combined.push(...fallback);
    }

    return combined.slice(0, limit);
}

async function getDiscountedProducts(limit = 16) {
    const result = await db.query(
        `SELECT p.*, c.name AS category_name, b.name AS brand_name,
                (p.price - COALESCE(p.discount_price, p.price)) AS saving,
                ROUND(
                    ((p.price - COALESCE(p.discount_price, p.price)) / NULLIF(p.price, 0)) * 100
                ) AS discount_pct
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN brands b ON p.brand_id = b.id
         WHERE p.discount_price IS NOT NULL
           AND p.discount_price < p.price
           AND COALESCE(p.is_active, true) = true
         ORDER BY saving DESC, p.created_at DESC
         LIMIT $1`,
        [limit]
    );
    return result.rows;
}

async function getRecentlyViewedProducts(ids = []) {
    if (!ids || ids.length === 0) return [];
    // Preserve the order of the IDs array (most recent first)
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const result = await db.query(
        `SELECT p.*, c.name AS category_name, b.name AS brand_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN brands b ON p.brand_id = b.id
         WHERE p.id IN (${placeholders})
           AND COALESCE(p.is_active, true) = true`,
        ids
    );
    // Re-sort to match the requested order
    const map = Object.fromEntries(result.rows.map(r => [r.id, r]));
    return ids.map(id => map[id]).filter(Boolean);
}

module.exports = {
    getAllProducts,
    getProductById,
    getProductBySlug,
    createProduct,
    updateProduct,
    deleteProduct,
    incrementViews,
    getFeaturedProducts,
    getTrendingProducts,
    getNewArrivals,
    getCategories,
    getBrands,
    getRelatedProducts,
    getDiscountedProducts,
    getRecentlyViewedProducts,
};