const db = require('../config/db');
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const cartService = require('../services/cartService');
const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');
const stockService = require('../services/stockService');
const { orderQueue } = require('../services/orderWorker');

const router = express.Router();

router.get('/checkout', requireAuth, async (req, res) => {
    const cart = await cartService.getCart(req.session.cart);

    if (cart.items.length === 0) {
        return res.redirect('/cart');
    }

    res.render('orders/checkout', {
        title: 'Secure Checkout',
        cart,
        error: req.session.checkoutError || null,
    });
    delete req.session.checkoutError;
});

// Step 2-5: Validate, Reserve Stock, Create Order, Initiate PayFast
router.post('/checkout', requireAuth, async (req, res) => {
    console.log('=== [Checkout] POST /orders/checkout START ===');
    console.log('[Checkout] user:', req.session.user?.id, req.session.user?.email);
    console.log('[Checkout] shippingAddress:', req.body.shippingAddress);

    const { shippingAddress } = req.body;
    const cart = await cartService.getCart(req.session.cart);

    console.log('[Checkout] cart.items.length:', cart.items.length);
    console.log('[Checkout] cart.total:', cart.total);
    console.log('[Checkout] cart.items:', JSON.stringify(cart.items.map(i => ({
        id: i.id, name: i.name, qty: i.quantity, price: i.price
    }))));

    if (cart.items.length === 0) {
        console.log('[Checkout] ABORT: Cart is empty, redirecting to /cart');
        return res.redirect('/cart');
    }

    try {
        // Generate idempotency key (prevents duplicate orders)
        const idempotencyKey = paymentService.generateIdempotencyKey(req.session.user.id);
        console.log('[Checkout] Step 1 — idempotencyKey:', idempotencyKey);

        // Create order with stock reservation (status = 'reserved')
        console.log('[Checkout] Step 2 — Creating order...');
        const order = await orderService.createOrder(
            req.session.user.id,
            cart.items,
            cart.total,
            shippingAddress,
            idempotencyKey
        );
        console.log('[Checkout] Step 2 — Order created:', {
            id: order.id,
            total_price: order.total_price,
            total_price_type: typeof order.total_price,
            status: order.status,
            idempotency_key: order.idempotency_key,
            user_id: order.user_id,
        });

        // Clear cart — order is now the source of truth
        req.session.cart = cartService.clearCart();
        console.log('[Checkout] Step 3 — Cart cleared');

        // ── Enqueue background job (non-blocking) ────────────────────────────
        // The worker will send the confirmation email (and act as a stock-commit
        // safety net) without making the user wait.
        try {
            // Fetch the full order (with items) so the email template has
            // product names and per-line prices available.
            const orderDetails = await orderService.getOrderById(order.id);
            await orderQueue.add('process-checkout', {
                orderId:   order.id,
                userEmail: req.session.user.email,
                order:     orderDetails || order,
            });
            console.log(`[Checkout] Step 3b — Enqueued background job for order #${order.id}`);
        } catch (queueErr) {
            // Queue failure must NEVER block the checkout response.
            // The user's order is created; we just log the enqueue error.
            console.error('[Checkout] ⚠️  Failed to enqueue background job:', queueErr.message);
        }

        // Mark as payment_pending and build PayFast form
        await orderService.markPaymentPending(order.id, {});
        console.log('[Checkout] Step 4 — Order marked payment_pending');

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const returnUrl = `${baseUrl}/orders/payment/success`;
        const cancelUrl = `${baseUrl}/orders/payment/cancel`;
        const notifyUrl = `${baseUrl}/webhooks/payfast`;
        console.log('[Checkout] Step 4 — URLs:', { returnUrl, cancelUrl, notifyUrl });

        console.log('[Checkout] Step 4 — order.total_price type:', typeof order.total_price, 'value:', order.total_price);
        const payfastForm = paymentService.buildPayFastForm(order, returnUrl, cancelUrl, notifyUrl);
        console.log('[Checkout] Step 4 — PayFast form built, url:', payfastForm.url);
        console.log('[Checkout] Step 4 — PayFast form data keys:', Object.keys(payfastForm.data));

        // Render auto-submitting PayFast form (POST redirect)
        console.log('[Checkout] Step 5 — Rendering payfast-redirect template');
        res.render('orders/payfast-redirect', {
            title: 'Redirecting to PayFast...',
            payfastUrl: payfastForm.url,
            payfastData: payfastForm.data,
        });
        console.log('=== [Checkout] POST /orders/checkout SUCCESS ===');

    } catch (err) {
        console.error('=== [Checkout] POST /orders/checkout ERROR ===');
        console.error('[Checkout] Error name:', err.name);
        console.error('[Checkout] Error message:', err.message);
        console.error('[Checkout] Error stack:', err.stack);

        // If stock reservation failed, release any partial reservations
        // (handled by transaction rollback, but log for visibility)

        req.session.checkoutError = err.message || 'Unable to complete checkout. Please try again.';
        res.redirect('/orders/checkout');
    }
});

router.get('/payment/success', requireAuth, async (req, res) => {
    // Show "pending confirmation" page — webhook will finalize
    res.render('orders/payment-pending', {
        title: 'Processing Payment',
        message: 'We are confirming your payment. Please do not refresh.',
        autoRefresh: true,
    });
});

router.get('/payment/cancel', requireAuth, async (req, res) => {
    res.render('orders/payment-cancelled', {
        title: 'Payment Cancelled',
        message: 'Your payment was cancelled. Items are still available in your cart.',
    });
});

// GET Order history
router.get('/', requireAuth, async (req, res) => {
    try {
        const orders = await orderService.getOrdersByUser(req.session.user.id);
        res.render('orders/history', { title: 'My Orders', orders, singleOrder: false });
    } catch (err) {
        console.error('Order history error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load orders',
        });
    }
});

// Order detail
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const order = await orderService.getOrderById(req.params.id, req.session.user.id);

        if (!order) {
            return res.status(404).render('partials/error', {
                title: 'Not Found',
                message: 'Order not found',
            });
        }

        res.render('orders/history', {
            title: `Order #${order.id}`,
            orders: [order],
            singleOrder: true,
        });
    } catch (err) {
        console.error('Order detail error:', err);
        res.status(500).render('partials/error', {
            title: 'Error',
            message: 'Unable to load order',
        });
    }
});

// used by payment-pending polling
router.get('/api/latest-status', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, status, total_price, created_at 
       FROM orders 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
            [req.session.user.id]
        );

        if (result.rows.length === 0) {
            return res.json({ status: 'none', orderId: null });
        }

        const order = result.rows[0];

        // If order is older than 2 hours, probably not the one we're waiting for
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        if (order.created_at < twoHoursAgo && order.status !== 'paid') {
            return res.json({ status: 'stale', orderId: order.id });
        }

        res.json({
            status: order.status,
            orderId: order.id,
            total: order.total_price
        });

    } catch (err) {
        console.error('Latest status error:', err);
        res.status(500).json({ status: 'error' });
    }
});

module.exports = router;