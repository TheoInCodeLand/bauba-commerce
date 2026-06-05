const db = require('../config/db');
const { meiliClient } = require('../config/meilisearch');

const INDEX_NAME = 'products';

/**
 * Fetch every product from PostgreSQL (with category, brand, and tags)
 * and push them into the Meilisearch `products` index.
 *
 * This is designed to be called:
 *   • once on initial deployment (full index build)
 *   • periodically via a cron/interval to keep the search index fresh
 *   • manually from an admin CLI when data changes significantly
 */
async function syncProductsToSearch() {
    console.log('--retry-- [SearchSync] Starting full product sync to Meilisearch...');

    try {
        // ── 1. Fetch all products with category + brand names ────────────
        const { rows: products } = await db.query(`
            SELECT
                p.id,
                p.name,
                p.slug,
                p.description,
                p.short_description,
                p.price,
                p.discount_price,
                p.image_url,
                p.gallery,
                p.category_id,
                c.name  AS category_name,
                p.brand_id,
                b.name  AS brand_name,
                p.sku,
                p.stock_quantity,
                p.is_active,
                p.is_featured,
                p.is_trending,
                p.is_new_arrival,
                p.total_views,
                p.average_rating,
                p.created_at,
                p.updated_at
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN brands     b ON p.brand_id    = b.id
            ORDER BY p.id
        `);

        if (products.length === 0) {
            console.log('⚠️  [SearchSync] No products found in PostgreSQL — nothing to sync.');
            return;
        }

        // ── 2. Aggregate tags per product in a single query ──────────────
        const { rows: tagRows } = await db.query(`
            SELECT pt.product_id, t.name AS tag_name
            FROM product_tags pt
            JOIN tags t ON t.id = pt.tag_id
            ORDER BY pt.product_id, t.name
        `);

        // Build a lookup:  product_id → ['tag1', 'tag2', ...]
        const tagMap = {};
        for (const row of tagRows) {
            if (!tagMap[row.product_id]) tagMap[row.product_id] = [];
            tagMap[row.product_id].push(row.tag_name);
        }

        // ── 3. Map to clean Meilisearch documents ────────────────────────
        const documents = products.map(p => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            description: p.description || '',
            short_description: p.short_description || '',
            price: parseFloat(p.price) || 0,
            discount_price: p.discount_price ? parseFloat(p.discount_price) : null,
            image_url: p.image_url,
            gallery: p.gallery,
            category_id: p.category_id,
            category_name: p.category_name || '',
            brand_id: p.brand_id,
            brand_name: p.brand_name || '',
            sku: p.sku,
            stock_quantity: p.stock_quantity,
            is_active: p.is_active ?? true,
            is_featured: p.is_featured || false,
            is_trending: p.is_trending || false,
            is_new_arrival: p.is_new_arrival || false,
            total_views: p.total_views || 0,
            average_rating: p.average_rating ? parseFloat(p.average_rating) : null,
            tags: tagMap[p.id] || [],
            created_at: p.created_at ? new Date(p.created_at).getTime() / 1000 : 0,
            updated_at: p.updated_at ? new Date(p.updated_at).getTime() / 1000 : 0,
        }));

        // ── 4. Push documents to the Meilisearch index ───────────────────
        const index = meiliClient.index(INDEX_NAME);
        const enqueueResult = await index.addDocuments(documents, { primaryKey: 'id' });
        console.log(`📦 [SearchSync] Enqueued ${documents.length} documents (taskUid: ${enqueueResult.taskUid})`);

        // ── 5. Configure index settings ──────────────────────────────────
        await index.updateSettings({
            searchableAttributes: [
                'name',
                'brand_name',
                'category_name',
                'description',
                'tags',
            ],
            filterableAttributes: [
                'category_id',
                'brand_id',
                'price',
                'is_active',
            ],
            sortableAttributes: [
                'price',
                'created_at',
            ],
        });

        console.log(`--success-- [SearchSync] Index "${INDEX_NAME}" settings updated.`);
        console.log(`--success-- [SearchSync] Sync complete — ${documents.length} products indexed.`);
    } catch (err) {
        console.error('--failed-- [SearchSync] Sync failed:', err.message);
    }
}

module.exports = { syncProductsToSearch };
