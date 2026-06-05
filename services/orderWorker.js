'use strict';

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const orderService = require('./orderService');
const stockService = require('./stockService');
const { sendOrderConfirmationEmail } = require('../config/mailer');

// ─────────────────────────────────────────────────────────────────────────────
// Redis connection — ioredis instance dedicated to BullMQ.
// We intentionally use ioredis here (NOT the redis v4 client used elsewhere)
// to avoid conflicts between the two client libraries.
// ─────────────────────────────────────────────────────────────────────────────

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    // BullMQ requires maxRetriesPerRequest: null on the ioredis connection
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Retry strategy: keep retrying with backoff so the worker survives
    // brief Redis blips without crashing the process.
    retryStrategy: (times) => Math.min(times * 200, 5000),
});

redisConnection.on('connect', () => console.log('--success-- [OrderWorker] IORedis connected'));
redisConnection.on('ready', () => console.log('--success-- [OrderWorker] IORedis ready'));
redisConnection.on('reconnecting', () => console.log('--retry-- [OrderWorker] IORedis reconnecting...'));
redisConnection.on('error', (err) => console.error('--failed-- [OrderWorker] IORedis error:', err.message));

// ─────────────────────────────────────────────────────────────────────────────
// Queue — used by the checkout route to enqueue jobs
// ─────────────────────────────────────────────────────────────────────────────

const orderQueue = new Queue('order-processing', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,                       // Retry up to 3× on failure
        backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s
        removeOnComplete: { count: 100 },  // Keep last 100 completed jobs
        removeOnFail: { count: 200 },  // Keep last 200 failed jobs for debugging
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Worker — processes jobs from the 'order-processing' queue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Job shape expected for the 'process-checkout' job:
 * {
 *   orderId:   number | string,
 *   userEmail: string,
 *   order:     object  — full order object (id, total_price, items, status, …)
 * }
 *
 * The worker is responsible for the async heavy-lifting that happens AFTER
 * the HTTP response has already been sent to the user:
 *   1. Commit stock in the database (deduct from stock_quantity).
 *   2. Send the customer's order-confirmation email.
 *
 * NOTE: Stock reservation already happened synchronously inside createOrder()
 *       (via the reserve_stock() PG function).  The PayFast webhook calls
 *       finalizeOrder() which commits stock once payment is confirmed.
 *       This worker therefore handles the post-payment email leg so the
 *       webhook also returns quickly to PayFast.
 */
const orderWorker = new Worker(
    'order-processing',

    async (job) => {
        const { orderId, userEmail, order } = job.data;

        // Guard: only handle known job names
        if (job.name !== 'process-checkout') {
            console.warn(`[OrderWorker] Unknown job name: ${job.name} — skipping`);
            return;
        }

        console.log(`🔧 [OrderWorker] Processing job ${job.id} for order #${orderId}`);

        // ── Step 1: Fetch the latest order state from the DB ─────────────────
        // The order may have been updated between enqueue and processing.
        let liveOrder;
        try {
            liveOrder = await orderService.getOrderById(orderId);
        } catch (fetchErr) {
            console.error(`[OrderWorker] Could not fetch order #${orderId}:`, fetchErr.message);
            // Fall back to the snapshot passed in the job payload
            liveOrder = order;
        }

        // ── Step 2: Commit stock if order is in 'paid' status ────────────────
        // finalizeOrder() in the webhook handles the commit, but as a safety
        // net we run it here too (idempotent — commit_stock is a PG function
        // that only deducts if reservations still exist).
        if (liveOrder && liveOrder.status === 'paid') {
            try {
                await stockService.commitStock(orderId);
                console.log(`--success-- [OrderWorker] Stock committed for order #${orderId}`);
            } catch (stockErr) {
                // Log but don't throw — email should still go out
                console.error(`--failed-- [OrderWorker] Stock commit failed for order #${orderId}:`, stockErr.message);
            }
        } else {
            console.log(
                `ℹ️  [OrderWorker] Order #${orderId} status is '${liveOrder?.status}'. ` +
                `Stock commit deferred to payment webhook.`
            );
        }

        // ── Step 3: Send order-confirmation email ────────────────────────────
        // Use the live order (with items) if available, otherwise fall back to
        // the job payload snapshot.
        const orderForEmail = liveOrder || order;

        if (!userEmail) {
            throw new Error(`[OrderWorker] No userEmail for job ${job.id}; cannot send confirmation.`);
        }

        await sendOrderConfirmationEmail(userEmail, orderForEmail);
        console.log(`--success-- [OrderWorker] Confirmation email sent to ${userEmail} for order #${orderId}`);
    },

    {
        connection: redisConnection,
        concurrency: 5, // Process up to 5 jobs concurrently
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// Worker event listeners — surface errors without crashing the process
// ─────────────────────────────────────────────────────────────────────────────

orderWorker.on('completed', (job) => {
    console.log(`--success-- [OrderWorker] Job ${job.id} completed`);
});

orderWorker.on('failed', (job, err) => {
    console.error(
        `--failed-- [OrderWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}):`,
        err.message
    );
});

orderWorker.on('error', (err) => {
    // Worker-level errors (connection issues etc.)
    console.error('--failed-- [OrderWorker] Worker error:', err.message);
});

// ─────────────────────────────────────────────────────────────────────────────
// Exported helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call from app.js alongside startCleanupJob() / startCacheWorker().
 * The worker starts automatically when this module is required; this function
 * simply logs a confirmation so app startup output is consistent.
 */
function startOrderWorker() {
    console.log('--launched-- [OrderWorker] Order queue worker is listening on "order-processing"');
}

module.exports = { orderQueue, startOrderWorker };
