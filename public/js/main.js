document.addEventListener('DOMContentLoaded', () => {
    // ============================================
    // Auto-dismiss alerts
    // ============================================
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        setTimeout(() => {
            alert.style.opacity = '0';
            alert.style.transition = 'opacity 0.5s';
            setTimeout(() => alert.remove(), 500);
        }, 5000);
    });

    // Confirm destructive actions (backup)
    document.querySelectorAll('form[onsubmit]').forEach(form => {
        form.addEventListener('submit', (e) => {
            const confirmed = confirm(form.getAttribute('onsubmit').replace('return confirm(', '').replace(');', '').replace(/['\\"]/g, ''));
            if (!confirmed) e.preventDefault();
        });
    });

    // ============================================
    // Toast notification helper
    // ============================================
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    }

    // ============================================
    // AJAX add-to-cart
    // ============================================
    document.querySelectorAll('form.add-to-cart-form').forEach(form => {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = new FormData(form);
            const payload = {};
            data.forEach((v, k) => { payload[k] = v; });

            try {
                const res = await fetch(form.action || '/cart/add', {
                    method: form.method || 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'Failed to add to cart');

                // update cart count in header if present
                const cartCountEl = document.getElementById('cart-count');
                if (cartCountEl && typeof json.cartCount !== 'undefined') {
                    cartCountEl.textContent = json.cartCount;
                }
                const cartBadge = document.getElementById('cart-count-badge');
                if (cartBadge && typeof json.cartCount !== 'undefined') {
                    cartBadge.textContent = json.cartCount;
                }

                showToast(json.message || 'Added to cart', 'success');
            } catch (err) {
                showToast(err.message || 'Unable to add to cart', 'error');
            }
        });
    });

    // ============================================
    // Wishlist toggle (AJAX)
    // ============================================
    document.querySelectorAll('.btn-wishlist-heart').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const productId = btn.dataset.productId;
            if (!productId) return;

            try {
                const res = await fetch('/wishlist/toggle', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({ productId }),
                });

                if (res.status === 401 || res.redirected) {
                    window.location.href = '/login';
                    return;
                }

                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'Unable to update wishlist');

                // Toggle heart state
                const icon = btn.querySelector('.heart-icon');
                if (json.added) {
                    btn.classList.add('active');
                    if (icon) icon.textContent = '♥';
                    btn.title = 'Remove from wishlist';
                } else {
                    btn.classList.remove('active');
                    if (icon) icon.textContent = '♡';
                    btn.title = 'Add to wishlist';
                }

                // Animate
                btn.classList.add('pulse');
                setTimeout(() => btn.classList.remove('pulse'), 500);

                // Update wishlist count in navbar
                const countEl = document.getElementById('wishlist-count');
                if (countEl && typeof json.wishlistCount !== 'undefined') {
                    countEl.textContent = json.wishlistCount;
                    countEl.style.display = json.wishlistCount > 0 ? '' : 'none';
                }

                showToast(json.message, 'success');
            } catch (err) {
                showToast(err.message || 'Unable to update wishlist', 'error');
            }
        });
    });

    // ============================================
    // Quick view modal
    // ============================================
    document.querySelectorAll('button.quick-view').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = btn.dataset.id;
            if (!id) return;
            try {
                const res = await fetch(`/products/${id}/json`);
                if (!res.ok) throw new Error('Unable to load product');
                const { product } = await res.json();

                const modal = document.createElement('div');
                modal.className = 'quickview-modal';
                modal.innerHTML = `
                    <div class="quickview-content">
                      <button class="quickview-close">×</button>
                      <div class="quickview-left"><img src="${product.image_url || '/images/placeholder.jpg'}" alt="${product.name}"></div>
                      <div class="quickview-right">
                        <h2>${product.name}</h2>
                        <p class="price">ZAR ${product.discount_price || product.price}</p>
                        <p>${(product.short_description || product.description || '').slice(0,300)}</p>
                        <a href="/products/${product.slug || product.id}" class="btn">View product</a>
                      </div>
                    </div>`;
                document.body.appendChild(modal);

                modal.querySelector('.quickview-close').addEventListener('click', () => modal.remove());
                modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove(); });
            } catch (err) {
                showToast(err.message || 'Unable to open quick view', 'error');
            }
        });
    });

    // ============================================
    // Quantity +/- controls
    // ============================================
    const qtyInput = document.getElementById('quantity');
    const qtyMinus = document.getElementById('qty-minus');
    const qtyPlus = document.getElementById('qty-plus');
    if (qtyInput && qtyMinus && qtyPlus) {
        qtyMinus.addEventListener('click', () => {
            const val = parseInt(qtyInput.value) || 1;
            if (val > 1) qtyInput.value = val - 1;
        });
        qtyPlus.addEventListener('click', () => {
            const val = parseInt(qtyInput.value) || 1;
            const max = parseInt(qtyInput.max) || 999;
            if (val < max) qtyInput.value = val + 1;
        });
    }

    // ============================================
    // Gallery thumbnails
    // ============================================
    document.querySelectorAll('.gallery-item').forEach(item => {
        item.addEventListener('click', () => {
            const mainImg = document.getElementById('main-product-image');
            const newSrc = item.dataset.image;
            if (mainImg && newSrc) {
                mainImg.src = newSrc;
                document.querySelectorAll('.gallery-item').forEach(g => g.classList.remove('active'));
                item.classList.add('active');
            }
        });
    });

    // ============================================
    // Variant Selector
    // ============================================
    const variantSelector = document.getElementById('variant-selector');
    if (variantSelector && window.__variants && window.__variantAttributeMap) {
        const selectedValues = {}; // attributeId -> valueId
        const swatches = variantSelector.querySelectorAll('.variant-swatch');

        swatches.forEach(swatch => {
            swatch.addEventListener('click', () => {
                const attrId = swatch.dataset.attributeId;
                const valueId = parseInt(swatch.dataset.valueId);
                const valueName = swatch.dataset.value;

                // Deselect siblings
                const group = swatch.closest('.variant-group');
                group.querySelectorAll('.variant-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');

                // Update selected value display
                const selectedLabel = document.getElementById('selected-' + group.dataset.attributeId);
                // Try the slug-based ID
                const slugLabel = swatch.closest('.variant-group').querySelector('.variant-selected-value');
                if (slugLabel) slugLabel.textContent = valueName;

                // Record selection
                selectedValues[attrId] = valueId;

                // Find matching variant
                const selectedIds = Object.values(selectedValues).sort((a, b) => a - b);
                let matchedVariant = null;

                for (const [varId, attrValueIds] of Object.entries(window.__variantAttributeMap)) {
                    const sorted = [...attrValueIds].sort((a, b) => a - b);
                    if (sorted.length === selectedIds.length && sorted.every((v, i) => v === selectedIds[i])) {
                        matchedVariant = window.__variants.find(v => v.id === parseInt(varId));
                        break;
                    }
                }

                if (matchedVariant) {
                    updateProductDisplay(matchedVariant);
                }
            });
        });

        function updateProductDisplay(variant) {
            // Update price
            const priceEl = document.getElementById('display-price');
            if (priceEl && variant.priceOverride) {
                priceEl.innerHTML = `ZAR ${variant.priceOverride}`;
            } else if (priceEl) {
                priceEl.innerHTML = `ZAR ${window.__basePrice}`;
            }

            // Update stock
            const stockEl = document.getElementById('display-stock');
            if (stockEl) {
                if (variant.stockQuantity > 0) {
                    stockEl.textContent = variant.stockQuantity + ' available';
                    stockEl.className = 'in-stock';
                } else {
                    stockEl.textContent = 'Out of stock';
                    stockEl.className = 'out-of-stock-text';
                }
            }

            // Update SKU
            const skuEl = document.getElementById('display-sku');
            if (skuEl && variant.sku) {
                skuEl.textContent = variant.sku;
            }

            // Update image
            const mainImg = document.getElementById('main-product-image');
            if (mainImg && variant.imageUrl) {
                mainImg.src = variant.imageUrl;
            }

            // Update quantity max
            const qtyIn = document.getElementById('quantity');
            if (qtyIn) {
                qtyIn.max = variant.stockQuantity;
                if (parseInt(qtyIn.value) > variant.stockQuantity) {
                    qtyIn.value = Math.max(1, variant.stockQuantity);
                }
            }

            // Update add-to-cart button
            const cartBtn = document.getElementById('add-to-cart-btn');
            if (cartBtn) {
                if (variant.stockQuantity <= 0) {
                    cartBtn.disabled = true;
                    cartBtn.textContent = 'Out of Stock';
                } else {
                    cartBtn.disabled = false;
                    cartBtn.textContent = 'Add to Cart';
                }
            }

            // Set variant ID in form
            const varIdInput = document.getElementById('variant-id-input');
            if (varIdInput) {
                varIdInput.value = variant.id;
            }
        }
    }

    // ============================================
    // Review Star Selector
    // ============================================
    const starSelector = document.getElementById('star-selector');
    const ratingInput = document.getElementById('rating-input');
    const submitBtn = document.getElementById('submit-review-btn');

    if (starSelector && ratingInput) {
        const starBtns = starSelector.querySelectorAll('.star-select-btn');

        starBtns.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                const rating = parseInt(btn.dataset.rating);
                starBtns.forEach((s, i) => {
                    s.classList.toggle('hover', i < rating);
                });
            });

            btn.addEventListener('click', () => {
                const rating = parseInt(btn.dataset.rating);
                ratingInput.value = rating;
                starBtns.forEach((s, i) => {
                    s.classList.toggle('selected', i < rating);
                });
                if (submitBtn) submitBtn.disabled = false;
            });
        });

        starSelector.addEventListener('mouseleave', () => {
            const current = parseInt(ratingInput.value) || 0;
            starBtns.forEach((s, i) => {
                s.classList.remove('hover');
                s.classList.toggle('selected', i < current);
            });
        });
    }
});