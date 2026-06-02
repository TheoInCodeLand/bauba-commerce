// services/paymentService.js
// PayFast integration: signature generation, ITN verification, idempotency

const crypto = require('crypto');
const db = require('../config/db');

// PayFast config (load from env in production)
const PAYFAST_CONFIG = {
    merchantId: process.env.PAYFAST_MERCHANT_ID,
    merchantKey: process.env.PAYFAST_MERCHANT_KEY,
    passphrase: process.env.PAYFAST_PASSPHRASE || null,
    sandbox: process.env.NODE_ENV !== 'production',
    // Endpoints
    url: process.env.NODE_ENV === 'production'
        ? 'https://www.payfast.co.za/eng/process'
        : 'https://sandbox.payfast.co.za/eng/process',
};

/**
 * Generate unique idempotency key for checkout attempt
 * Prevents duplicate orders if user clicks checkout twice
 */
function generateIdempotencyKey(userId) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `ord_${userId}_${timestamp}_${random}`;
}

/**
 * Build PayFast payment form data with signature
 * @param {Object} order - order object with total, id, etc.
 * @param {string} returnUrl - user success redirect
 * @param {string} cancelUrl - user cancel redirect
 * @param {string} notifyUrl - ITN webhook endpoint
 */
function buildPayFastForm(order, returnUrl, cancelUrl, notifyUrl) {
    console.log('--- [PayFast] buildPayFastForm START ---');
    console.log('[PayFast] order.id:', order.id);
    console.log('[PayFast] order.user_id:', order.user_id);
    console.log('[PayFast] order.total_price:', order.total_price, '(type:', typeof order.total_price + ')');
    console.log('[PayFast] order.idempotency_key:', order.idempotency_key);
    console.log('[PayFast] returnUrl:', returnUrl);
    console.log('[PayFast] cancelUrl:', cancelUrl);
    console.log('[PayFast] notifyUrl:', notifyUrl);

    // Build raw data
    const rawData = {
        merchant_id: PAYFAST_CONFIG.merchantId,
        merchant_key: PAYFAST_CONFIG.merchantKey,
        return_url: returnUrl,
        cancel_url: cancelUrl,
        notify_url: notifyUrl,
        m_payment_id: order.idempotency_key,
        amount: Number(order.total_price).toFixed(2),
        item_name: `Order #${order.id}`,
        item_description: `ShopMVP Order ${order.id}`,
        custom_str1: String(order.id),
        custom_str2: String(order.user_id),
        email_confirmation: '1',
        confirmation_address: process.env.ADMIN_EMAIL || '',
    };

    console.log('[PayFast] rawData field count:', Object.keys(rawData).length);

    // CRITICAL: Remove ALL empty/null/undefined values completely
    // PayFast must see the EXACT same fields in the form that were used for the signature
    const data = {};
    const removedKeys = [];
    Object.keys(rawData).forEach(key => {
        const val = rawData[key];
        if (val !== '' && val !== null && val !== undefined) {
            data[key] = String(val);
        } else {
            removedKeys.push(`${key} (value: ${JSON.stringify(val)})`);
        }
    });

    if (removedKeys.length > 0) {
        console.log('[PayFast] Removed empty/null/undefined keys count:', removedKeys.length);
    }
    console.log('[PayFast] Filtered field count (for signature):', Object.keys(data).length);

    // Generate signature from the filtered data (no signature field yet)
    const signature = generateSignature(data, PAYFAST_CONFIG.passphrase);
    console.log('[PayFast] Generated MD5 signature:', signature);

    // Add signature to the data that goes to the form
    data.signature = signature;

    // Signature generated successfully — param string masked for security

    console.log('[PayFast] Final form field count:', Object.keys(data).length);
    console.log('[PayFast] PayFast URL:', PAYFAST_CONFIG.url);
    console.log('--- [PayFast] buildPayFastForm END ---');

    return { url: PAYFAST_CONFIG.url, data };
}

/**
 * Generate PayFast MD5 signature
 * Fields must be alphabetized, concatenated with & and no empty values
 */
function generateSignature(data, passphrase = null) {
    // Add passphrase INTO the data object BEFORE sorting (per PayFast docs)
    const pfData = { ...data };
    if (passphrase) {
        pfData['passphrase'] = passphrase;
    }

    // Sort ALL keys alphabetically (passphrase sorts with the rest)
    const sortedKeys = Object.keys(pfData).sort();

    // Build param string — PHP http_build_query uses + for spaces
    const paramString = sortedKeys
        .map(key => `${key}=${encodeURIComponent(String(pfData[key])).replace(/%20/g, '+')}`)
        .join('&');

    const hash = require('crypto').createHash('md5').update(paramString).digest('hex');

    return hash;
}

/**
 * Verify ITN (Instant Transaction Notification) from PayFast
 *
 * ITN signature rules are DIFFERENT from the outgoing payment signature:
 *   - Outgoing: sort all keys alphabetically, passphrase sorts in with them
 *   - ITN:      preserve PayFast's original POST field order, stop before
 *               'signature', skip empty values, append passphrase at the END
 *
 * This matches PayFast's own PHP verification sample exactly.
 */
function verifyITN(payload, expectedAmount, expectedOrderId) {
    const receivedSig = payload.signature;

    if (!receivedSig) {
        return { valid: false, reason: 'No signature in payload' };
    }

    // 1. Build param string in PayFast's original POST order
    //    - Stop when we hit 'signature' (mirrors the PHP break-on-signature logic)
    //    - INCLUDE empty fields as key= (PHP urlencode('') === '', so key= is included)
    //    - Do NOT skip empty values — that's what was causing the signature mismatch
    let pfParamString = '';
    for (const key of Object.keys(payload)) {
        if (key === 'signature') break;
        const val = (payload[key] === null || payload[key] === undefined)
            ? ''
            : String(payload[key]);
        pfParamString += `${key}=${encodeURIComponent(val).replace(/%20/g, '+')}&`;
    }
    // Remove trailing &
    pfParamString = pfParamString.slice(0, -1);

    // 2. Append passphrase at the END (NOT sorted in — ITN rule)
    const passphrase = PAYFAST_CONFIG.passphrase;
    const stringToHash = passphrase
        ? `${pfParamString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
        : pfParamString;

    // Signature param string masked for security

    // 3. MD5 hash
    const computedSig = crypto.createHash('md5').update(stringToHash).digest('hex');

    // Signatures computed — payload integrity verified

    if (computedSig !== receivedSig) {
        return { valid: false, reason: 'Invalid signature' };
    }

    // 4. Verify merchant ID
    if (String(payload.merchant_id) !== String(PAYFAST_CONFIG.merchantId)) {
        return { valid: false, reason: `Merchant ID mismatch: got ${payload.merchant_id}` };
    }

    // 5. Verify amount (allow 1 cent float tolerance)
    const grossAmount = parseFloat(payload.amount_gross);
    const expected = parseFloat(expectedAmount);
    if (Math.abs(grossAmount - expected) > 0.01) {
        return { valid: false, reason: `Amount mismatch: got ${grossAmount}, expected ${expected}` };
    }

    // 6. Verify order linkage
    if (String(payload.custom_str1) !== String(expectedOrderId)) {
        return { valid: false, reason: `Order ID mismatch: got ${payload.custom_str1}, expected ${expectedOrderId}` };
    }

    return { valid: true };
}

/**
 * Record ITN transaction for audit and idempotency
 * Returns true if this is a new/unique transaction to process
 */
async function recordITN(orderId, payload, signatureValid) {
    try {
        const result = await db.query(
            `INSERT INTO payfast_transactions 
       (order_id, pf_payment_id, m_payment_id, amount_gross, payment_status, signature_valid, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pf_payment_id, payment_status) DO NOTHING
       RETURNING id`,
            [
                orderId,
                payload.pf_payment_id || null,
                payload.m_payment_id || null,
                payload.amount_gross || 0,
                payload.payment_status || 'UNKNOWN',
                signatureValid,
                JSON.stringify(payload),
            ]
        );

        // If RETURNING id is present, this was a new insert → we should process it
        return result.rows.length > 0;
    } catch (err) {
        // If unique constraint violation, it's a duplicate webhook
        if (err.code === '23505') return false;
        throw err;
    }
}

/**
 * Check if order was already paid (idempotency guard)
 */
async function isOrderAlreadyPaid(orderId) {
    const result = await db.query(
        "SELECT id FROM orders WHERE id = $1 AND status = 'paid'",
        [orderId]
    );
    return result.rows.length > 0;
}

console.log('PayFast config:', {
    merchantId: PAYFAST_CONFIG.merchantId ? 'SET' : 'MISSING',
    merchantKey: PAYFAST_CONFIG.merchantKey ? 'SET' : 'MISSING',
    passphrase: PAYFAST_CONFIG.passphrase ? 'SET' : 'NOT SET (sandbox often needs this)',
    sandbox: PAYFAST_CONFIG.sandbox,
});

module.exports = {
    generateIdempotencyKey,
    buildPayFastForm,
    verifyITN,
    recordITN,
    isOrderAlreadyPaid,
    PAYFAST_CONFIG,
};