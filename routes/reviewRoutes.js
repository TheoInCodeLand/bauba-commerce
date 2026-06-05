const express = require('express');
const reviewService = require('../services/reviewService');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// Submit a review
router.post('/:id/reviews', requireAuth, async (req, res) => {
    const productId = parseInt(req.params.id);
    const { rating, title, body } = req.body;

    try {
        // Validate rating
        const ratingNum = parseInt(rating);
        if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
            req.session.flashError = 'Please select a rating between 1 and 5';
            return res.redirect(`/products/${productId}`);
        }

        // Check if user already reviewed
        const alreadyReviewed = await reviewService.hasUserReviewed(req.session.user.id, productId);
        if (alreadyReviewed) {
            req.session.flashError = 'You have already reviewed this product';
            return res.redirect(`/products/${productId}`);
        }

        await reviewService.createReview(req.session.user.id, productId, {
            rating: ratingNum,
            title: title ? title.trim() : null,
            body: body ? body.trim() : null,
        });

        res.redirect(`/products/${productId}`);
    } catch (err) {
        console.error('Review submit error:', err);
        req.session.flashError = 'Unable to submit review';
        res.redirect(`/products/${productId}`);
    }
});

// Delete a review
router.post('/:id/reviews/:reviewId/delete', requireAuth, async (req, res) => {
    const productId = parseInt(req.params.id);
    const reviewId = parseInt(req.params.reviewId);

    try {
        await reviewService.deleteReview(
            reviewId,
            req.session.user.id,
            req.session.user.is_admin
        );
        res.redirect(`/products/${productId}`);
    } catch (err) {
        console.error('Review delete error:', err);
        req.session.flashError = 'Unable to delete review';
        res.redirect(`/products/${productId}`);
    }
});

module.exports = router;
