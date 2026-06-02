const db = require('../config/db');
const stockService = require('./stockService');

/**
 * Create a new order with stock reservation
 * Step 1-4 of secure flow: Validate → Lock Stock → Create Order (pending)
 * Uses idempotency key to prevent duplicate orders
 */
async function createOrder(userId, cartItems, totalPrice, shippingAddress, idempotencyKey) {
    const client = await db.pool.connect();
    const safeTotal = Number(totalPrice);
    const expiresAt = new Date(Date.now() + stockService.RESERVATION_MINUTES * 60000);

    try {
        await client.query('BEGIN');

        // 1. Check if idempotency key already exists (duplicate submission)
        const existing = await client.query(
            'SELECT id, status FROM orders WHERE idempotency_key = $1',
            [idempotencyKey]
        );

        if (existing.rows.length > 0) {
            const order = existing.rows[0];
            // If already paid or in progress, return it
            if (['paid', 'payment_pending', 'reserved'].includes(order.status)) {
                await client.query('COMMIT');
                return await getOrderById(order.id); // Return full order
            }
        }

        // 2. Create order with reserved status
        const orderResult = await client.query(
            `INSERT INTO orders (user_id, total_price, status, shipping_address, idempotency_key, expires_at) 
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *`,
            [userId, safeTotal, 'reserved', shippingAddress, idempotencyKey, expiresAt]
        );

        const order = orderResult.rows[0];

        // 3. Reserve stock atomically using DB function
        // We do this inside the same transaction for consistency
        for (const item of cartItems) {
            const reserveResult = await client.query(
                'SELECT reserve_stock($1, $2, $3, $4) as success',
                [item.productId, order.id, item.quantity, expiresAt]
            );

            if (!reserveResult.rows[0].success) {
                await client.query('ROLLBACK');
                throw new Error(`Insufficient stock for product ${item.name}`);
            }
        }

        // 4. Insert order items
        for (const item of cartItems) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price) 
         VALUES ($1, $2, $3, $4)`,
                [order.id, item.productId, item.quantity, item.price]
            );
        }

        await client.query('COMMIT');
        return order;

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Mark order as payment_pending (user redirected to PayFast)
 */
async function markPaymentPending(orderId, payfastData) {
    await db.query(
        `UPDATE orders 
     SET status = 'payment_pending', payfast_payment_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND status = 'reserved'`,
        [payfastData.paymentId || null, orderId]
    );
}

/**
 * Finalize order after successful PayFast webhook
 * Step 9: Commit stock, mark paid, trigger fulfillment
 */
async function finalizeOrder(orderId, paymentData) {
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // Idempotency check: already paid?
        const check = await client.query(
            "SELECT status FROM orders WHERE id = $1 FOR UPDATE",
            [orderId]
        );

        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            throw new Error('Order not found');
        }

        if (check.rows[0].status === 'paid') {
            await client.query('ROLLBACK');
            return { alreadyPaid: true }; // Idempotent: already processed
        }

        // Commit stock (actually deduct from products)
        await client.query('SELECT commit_stock($1)', [orderId]);

        // Mark order as paid
        const result = await client.query(
            `UPDATE orders 
       SET status = 'paid', payment_data = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
            [JSON.stringify(paymentData), orderId]
        );

        await client.query('COMMIT');
        return { order: result.rows[0], alreadyPaid: false };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Mark order as failed/cancelled and release stock
 */
async function failOrder(orderId, reason) {
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // Only fail if not already paid (idempotency)
        const result = await client.query(
            `UPDATE orders 
       SET status = 'failed', payment_data = COALESCE(payment_data, '{}'::jsonb) || $1::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status != 'paid'
       RETURNING id`,
            [JSON.stringify({ failure_reason: reason }), orderId]
        );

        if (result.rows.length > 0) {
            // Release reserved stock
            await client.query('SELECT release_stock($1)', [orderId]);
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Expire abandoned orders (cron job calls this)
 * Step 10: Release stock for orders past expiration
 */
async function expireAbandonedOrders() {
    const result = await db.query(
        `UPDATE orders 
     SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('reserved', 'payment_pending') 
     AND expires_at < NOW()
     RETURNING id`
    );

    for (const row of result.rows) {
        await db.query('SELECT release_stock($1)', [row.id]);
    }

    return result.rows.length;
}

// Previous functions remain unchanged...
async function getOrdersByUser(userId) {
    const result = await db.query(
        `SELECT o.*, 
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
     FROM orders o 
     WHERE o.user_id = $1 
     ORDER BY o.created_at DESC`,
        [userId]
    );
    return result.rows;
}

async function getOrderById(orderId, userId = null) {
    let orderQuery = 'SELECT * FROM orders WHERE id = $1';
    const params = [orderId];

    if (userId) {
        orderQuery += ' AND user_id = $2';
        params.push(userId);
    }

    const orderResult = await db.query(orderQuery, params);
    if (orderResult.rows.length === 0) return null;

    const order = orderResult.rows[0];

    const itemsResult = await db.query(
        `SELECT oi.*, p.name as product_name, p.image_url 
     FROM order_items oi 
     JOIN products p ON oi.product_id = p.id 
     WHERE oi.order_id = $1`,
        [orderId]
    );

    return { ...order, items: itemsResult.rows };
}

async function getAllOrders() {
    const result = await db.query(
        `SELECT o.*, u.email as user_email,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
     FROM orders o 
     JOIN users u ON o.user_id = u.id 
     ORDER BY o.created_at DESC`
    );
    return result.rows;
}

module.exports = {
    createOrder,
    markPaymentPending,
    finalizeOrder,
    failOrder,
    expireAbandonedOrders,
    getOrdersByUser,
    getOrderById,
    getAllOrders,
};