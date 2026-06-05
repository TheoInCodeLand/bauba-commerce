const db = require('../config/db');

async function getReviewsByProduct(productId) {
    const result = await db.query(
        `SELECT r.*, u.email AS user_email
         FROM product_reviews r
         JOIN users u ON u.id = r.user_id
         WHERE r.product_id = $1
         ORDER BY r.created_at DESC`,
        [productId]
    );
    return result.rows;
}

async function createReview(userId, productId, { rating, title, body }) {
    const result = await db.query(
        `INSERT INTO product_reviews (user_id, product_id, rating, title, body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, productId, rating, title || null, body || null]
    );
    // Rating recalculation is handled by the DB trigger
    return result.rows[0];
}

async function deleteReview(reviewId, userId, isAdmin = false) {
    let result;
    if (isAdmin) {
        result = await db.query(
            'DELETE FROM product_reviews WHERE id = $1 RETURNING *',
            [reviewId]
        );
    } else {
        result = await db.query(
            'DELETE FROM product_reviews WHERE id = $1 AND user_id = $2 RETURNING *',
            [reviewId, userId]
        );
    }
    // Rating recalculation is handled by the DB trigger
    return result.rows[0] || null;
}

async function hasUserReviewed(userId, productId) {
    if (!userId) return false;
    const result = await db.query(
        'SELECT 1 FROM product_reviews WHERE user_id = $1 AND product_id = $2 LIMIT 1',
        [userId, productId]
    );
    return result.rows.length > 0;
}

async function getReviewStats(productId) {
    const result = await db.query(
        `SELECT
            COUNT(*)::int AS total,
            COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS average,
            COUNT(*) FILTER (WHERE rating = 5)::int AS five_star,
            COUNT(*) FILTER (WHERE rating = 4)::int AS four_star,
            COUNT(*) FILTER (WHERE rating = 3)::int AS three_star,
            COUNT(*) FILTER (WHERE rating = 2)::int AS two_star,
            COUNT(*) FILTER (WHERE rating = 1)::int AS one_star
         FROM product_reviews
         WHERE product_id = $1`,
        [productId]
    );
    return result.rows[0];
}

module.exports = {
    getReviewsByProduct,
    createReview,
    deleteReview,
    hasUserReviewed,
    getReviewStats,
};
