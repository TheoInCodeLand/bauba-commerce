'use strict';

const nodemailer = require('nodemailer');

// ─────────────────────────────────────────────────────────────────────────────
// Transporter — lazy-initialised so we can await the Ethereal test account
// creation only once, the first time the module is required.
// ─────────────────────────────────────────────────────────────────────────────

let _transporter = null;

/**
 * Returns (and lazily creates) the singleton Nodemailer transporter.
 *
 * Priority:
 *  1. Real SMTP when SMTP_HOST is set in the environment.
 *  2. Ethereal test account for local development (no env vars needed).
 */
async function getTransporter() {
    if (_transporter) return _transporter;

    if (process.env.SMTP_HOST) {
        // ── Production / staging path ──────────────────────────────────────
        _transporter = nodemailer.createTransport({
            host:   process.env.SMTP_HOST,
            port:   Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465, // true for port 465
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        console.log('📧 [Mailer] Using real SMTP transporter:', process.env.SMTP_HOST);
    } else {
        // ── Local dev fallback: Ethereal test account ──────────────────────
        // Emails are NOT actually delivered — copy the preview URL from logs.
        console.warn(
            '⚠️  [Mailer] SMTP_HOST not set. Falling back to Ethereal test account.\n' +
            '    Emails will NOT be delivered. Check logs for preview URLs.'
        );

        const testAccount = await nodemailer.createTestAccount();

        _transporter = nodemailer.createTransport({
            host:   'smtp.ethereal.email',
            port:   587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass,
            },
        });

        console.log('📧 [Mailer] Ethereal test account:', testAccount.user);
    }

    return _transporter;
}

// Export for direct use (e.g., verify connection on startup)
const transporter = { getTransporter };

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Order confirmation email
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a branded HTML order confirmation email.
 *
 * @param {string} userEmail   - Recipient email address.
 * @param {object} orderData   - Order object with `id`, `total_price`, `items`,
 *                               `shipping_address`, `status`, `created_at`.
 */
async function sendOrderConfirmationEmail(userEmail, orderData) {
    const mailer = await getTransporter();

    const {
        id,
        total_price,
        items = [],
        shipping_address,
        status,
        created_at,
    } = orderData;

    // ── Build items table rows ────────────────────────────────────────────────
    const itemRows = items.length
        ? items
              .map(
                  (item) => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">
              ${item.product_name || item.name || 'Product'}
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">
              ${item.quantity}
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">
              R ${Number(item.price).toFixed(2)}
            </td>
          </tr>`
              )
              .join('')
        : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#999;">
             No item details available.
           </td></tr>`;

    const formattedDate = created_at
        ? new Date(created_at).toLocaleDateString('en-ZA', {
              year: 'numeric', month: 'long', day: 'numeric',
          })
        : new Date().toLocaleDateString('en-ZA', {
              year: 'numeric', month: 'long', day: 'numeric',
          });

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Order Confirmation</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f4f4f7;color:#333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;
                      box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);
                       padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#e94560;font-size:28px;letter-spacing:-0.5px;">
                bauba
              </h1>
              <p style="margin:8px 0 0;color:#a0b4c8;font-size:14px;">
                Your order has been confirmed ✓
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">
                Hi there,<br /><br />
                Thank you for shopping with <strong>bauba</strong>! We've received your order
                and it is now being processed.
              </p>

              <!-- Order meta -->
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:#f9f9fb;border-radius:8px;padding:20px;margin-bottom:28px;">
                <tr>
                  <td style="padding:4px 0;">
                    <strong style="color:#555;">Order ID:</strong>
                    <span style="float:right;color:#0f3460;font-weight:600;">#${id}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0;">
                    <strong style="color:#555;">Date:</strong>
                    <span style="float:right;">${formattedDate}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0;">
                    <strong style="color:#555;">Status:</strong>
                    <span style="float:right;text-transform:capitalize;">${status || 'processing'}</span>
                  </td>
                </tr>
                ${shipping_address ? `
                <tr>
                  <td style="padding:4px 0;">
                    <strong style="color:#555;">Ship to:</strong>
                    <span style="float:right;max-width:280px;text-align:right;">${shipping_address}</span>
                  </td>
                </tr>` : ''}
              </table>

              <!-- Items table -->
              <h3 style="margin:0 0 16px;font-size:15px;color:#1a1a2e;border-bottom:2px solid #e94560;
                         padding-bottom:8px;">
                Order Summary
              </h3>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <thead>
                  <tr style="background:#f0f0f5;">
                    <th style="padding:10px 12px;text-align:left;font-size:12px;
                               text-transform:uppercase;color:#666;letter-spacing:0.5px;">Product</th>
                    <th style="padding:10px 12px;text-align:center;font-size:12px;
                               text-transform:uppercase;color:#666;letter-spacing:0.5px;">Qty</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;
                               text-transform:uppercase;color:#666;letter-spacing:0.5px;">Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="2" style="padding:14px 12px;text-align:right;
                                           font-weight:700;font-size:16px;color:#1a1a2e;">
                      Total:
                    </td>
                    <td style="padding:14px 12px;text-align:right;font-weight:700;
                               font-size:18px;color:#e94560;">
                      R ${Number(total_price).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              <p style="margin:24px 0 0;font-size:14px;color:#777;line-height:1.6;">
                If you have any questions about your order, reply to this email or
                contact us at <a href="mailto:${process.env.ADMIN_EMAIL || 'support@bauba.co.za'}"
                style="color:#e94560;">${process.env.ADMIN_EMAIL || 'support@bauba.co.za'}</a>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9fb;padding:24px 40px;text-align:center;
                       border-top:1px solid #eee;">
              <p style="margin:0;font-size:12px;color:#aaa;">
                © ${new Date().getFullYear()} bauba Commerce. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const mailOptions = {
        from: `"bauba" <${process.env.SMTP_USER || 'noreply@bauba.co.za'}>`,
        to: userEmail,
        subject: `Order Confirmed — #${id} | bauba`,
        html,
        text: `Order #${id} confirmed. Total: R${Number(total_price).toFixed(2)}. Thank you for shopping with bauba!`,
    };

    const info = await mailer.sendMail(mailOptions);

    // For Ethereal accounts, log the preview URL so devs can inspect the email
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
        console.log(`📧 [Mailer] Preview URL (Ethereal): ${previewUrl}`);
    } else {
        console.log(`📧 [Mailer] Confirmation email sent to ${userEmail} (messageId: ${info.messageId})`);
    }

    return info;
}

module.exports = { transporter, sendOrderConfirmationEmail };
