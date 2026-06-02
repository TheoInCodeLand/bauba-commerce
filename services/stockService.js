const db = require('../config/db');

const RESERVATION_MINUTES = 15; // PayFast timeout window

/**
 * Reserve stock for an order
 * Uses PostgreSQL function for atomic check-and-set
 * @returns {boolean} true if all items reserved successfully
 */
async function reserveStock(orderId, items) {
    const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60000);

    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        for (const item of items) {
            // Call the database function for atomic reservation
            const result = await client.query(
                'SELECT reserve_stock($1, $2, $3, $4) as success',
                [item.productId, orderId, item.quantity, expiresAt]
            );

            if (!result.rows[0].success) {
                await client.query('ROLLBACK');
                return false; // Not enough stock for this item
            }
        }

        await client.query('COMMIT');
        return true;

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Release reserved stock (payment failed/cancelled/expired)
 */
async function releaseStock(orderId) {
    await db.query('SELECT release_stock($1)', [orderId]);
}

/**
 * Commit stock after successful payment
 * Actually deducts from products.stock_quantity
 */
async function commitStock(orderId) {
    await db.query('SELECT commit_stock($1)', [orderId]);
}

/**
 * Get current available stock (total - reserved)
 */
async function getAvailableStock(productId) {
    const result = await db.query(`
    SELECT p.stock_quantity - COALESCE(SUM(r.quantity), 0) as available
    FROM products p
    LEFT JOIN stock_reservations r ON p.id = r.product_id AND r.expires_at > NOW()
    WHERE p.id = $1
    GROUP BY p.id
  `, [productId]);

    return result.rows[0]?.available || 0;
}

module.exports = {
    reserveStock,
    releaseStock,
    commitStock,
    getAvailableStock,
    RESERVATION_MINUTES,
};