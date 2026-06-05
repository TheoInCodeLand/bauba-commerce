const db = require('../config/db');

async function getWishlist(userId) {
    const result = await db.query(
        `SELECT w.id AS wishlist_id, w.created_at AS wishlisted_at,
                p.*, c.name AS category_name, b.name AS brand_name
         FROM wishlists w
         JOIN products p ON p.id = w.product_id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN brands b ON p.brand_id = b.id
         WHERE w.user_id = $1
         ORDER BY w.created_at DESC`,
        [userId]
    );
    return result.rows;
}

async function addToWishlist(userId, productId) {
    await db.query(
        `INSERT INTO wishlists (user_id, product_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, product_id) DO NOTHING`,
        [userId, productId]
    );
}

async function removeFromWishlist(userId, productId) {
    await db.query(
        'DELETE FROM wishlists WHERE user_id = $1 AND product_id = $2',
        [userId, productId]
    );
}

async function toggleWishlist(userId, productId) {
    const exists = await isInWishlist(userId, productId);
    if (exists) {
        await removeFromWishlist(userId, productId);
        return { added: false };
    } else {
        await addToWishlist(userId, productId);
        return { added: true };
    }
}

async function isInWishlist(userId, productId) {
    const result = await db.query(
        'SELECT 1 FROM wishlists WHERE user_id = $1 AND product_id = $2 LIMIT 1',
        [userId, productId]
    );
    return result.rows.length > 0;
}

async function getWishlistProductIds(userId) {
    if (!userId) return [];
    const result = await db.query(
        'SELECT product_id FROM wishlists WHERE user_id = $1',
        [userId]
    );
    return result.rows.map(r => r.product_id);
}

async function getWishlistCount(userId) {
    if (!userId) return 0;
    const result = await db.query(
        'SELECT COUNT(*)::int AS count FROM wishlists WHERE user_id = $1',
        [userId]
    );
    return result.rows[0].count;
}

module.exports = {
    getWishlist,
    addToWishlist,
    removeFromWishlist,
    toggleWishlist,
    isInWishlist,
    getWishlistProductIds,
    getWishlistCount,
};
