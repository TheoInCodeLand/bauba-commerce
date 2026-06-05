const express = require('express');
const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');

const router = express.Router();

router.post('/payfast', express.urlencoded({ extended: true }), async (req, res) => {
    const payload = req.body;

    console.log('PayFast ITN received:', {
        pf_payment_id: payload.pf_payment_id,
        payment_status: payload.payment_status,
        m_payment_id: payload.m_payment_id,
    });

    // 1. Basic validation
    if (!payload.m_payment_id || !payload.pf_payment_id) {
        console.error('Invalid ITN: missing identifiers');
        return res.status(400).send('Bad Request');
    }

    try {
        // 2. Find order by idempotency key (m_payment_id)
        const orderResult = await require('../config/db').query(
            'SELECT * FROM orders WHERE idempotency_key = $1',
            [payload.m_payment_id]
        );

        if (orderResult.rows.length === 0) {
            console.error('ITN: Order not found for key', payload.m_payment_id);
            return res.status(404).send('Order not found');
        }

        const order = orderResult.rows[0];

        // 3. Verify ITN signature and data integrity
        const verification = paymentService.verifyITN(
            payload,
            order.total_price,
            order.id
        );

        // 4. Record ITN (returns false if duplicate — idempotency guard)
        const isNewTransaction = await paymentService.recordITN(
            order.id,
            payload,
            verification.valid
        );

        if (!isNewTransaction) {
            console.log('ITN: Duplicate transaction ignored');
            return res.status(200).send('OK'); // Acknowledge to stop retries
        }

        if (!verification.valid) {
            console.error('ITN: Verification failed:', verification.reason);
            // Still return 200 to PayFast so they stop retrying, but log failure
            await orderService.failOrder(order.id, `ITN verification failed: ${verification.reason}`);
            return res.status(200).send('OK');
        }

        // 5. Process based on PayFast payment_status
        const status = payload.payment_status;

        if (status === 'COMPLETE') {
            // Payment successful — finalize order
            const result = await orderService.finalizeOrder(order.id, payload);

            if (result.alreadyPaid) {
                console.log('Order already paid — idempotency guard triggered');
            } else {
                console.log('Order finalized:', order.id);
                // TODO: Trigger fulfillment (email, shipping, etc.)
            }

        } else if (status === 'FAILED' || status === 'CANCELLED') {
            // --failed-- Payment failed — release stock
            await orderService.failOrder(order.id, `PayFast status: ${status}`);
            console.log('Order failed:', order.id);

        } else if (status === 'PENDING') {
            // EFT pending — wait for next ITN
            await require('../config/db').query(
                "UPDATE orders SET status = 'payment_pending', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                [order.id]
            );
            console.log('Payment pending:', order.id);
        }

        // Always return 200 OK to PayFast so they don't retry
        res.status(200).send('OK');

    } catch (err) {
        console.error('ITN processing error:', err);
        // Return 500 to trigger PayFast retry (they retry on 5xx)
        res.status(500).send('Server Error');
    }
});

module.exports = router;