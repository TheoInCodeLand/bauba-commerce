const productService = require('./productService');


async function getCart(sessionCart = []) {
    if (!sessionCart || sessionCart.length === 0) {
        return { items: [], total: 0 };
    }

    const enrichedItems = [];
    let total = 0;

    for (const item of sessionCart) {
        // Verify product still exists and get current price
        const product = await productService.getProductById(item.productId);
        if (product) {
            const itemTotal = product.price * item.quantity;
            total += itemTotal;
            enrichedItems.push({
                productId: product.id,
                name: product.name,
                price: Number(product.price),
                imageUrl: product.image_url,
                quantity: item.quantity,
                itemTotal: itemTotal,
                stock: product.stock_quantity,
            });
        }
    }

    // return { items: enrichedItems, total: parseFloat(total.toFixed(2)) };
    return {
        items: enrichedItems,
        total: parseFloat(Number(total).toFixed(2))
    };
}

/**
 * Add item to cart
 */
async function addItem(sessionCart, productId, quantity = 1) {
    const cart = sessionCart || [];
    const product = await productService.getProductById(productId);

    if (!product) {
        throw new Error('Product not found');
    }

    if (product.stock_quantity < quantity) {
        throw new Error('Not enough stock available');
    }

    const existingIndex = cart.findIndex(item => item.productId === productId);

    if (existingIndex >= 0) {
        // Update quantity if already in cart
        const newQty = cart[existingIndex].quantity + quantity;
        if (newQty > product.stock_quantity) {
            throw new Error('Cannot add more than available stock');
        }
        cart[existingIndex].quantity = newQty;
    } else {
        cart.push({
            productId: product.id,
            name: product.name,
            price: product.price,
            imageUrl: product.image_url,
            quantity: quantity,
        });
    }

    return cart;
}

/**
 * Update item quantity
 */
async function updateQuantity(sessionCart, productId, quantity) {
    const cart = sessionCart || [];
    const index = cart.findIndex(item => item.productId === productId);

    if (index === -1) {
        throw new Error('Item not in cart');
    }

    if (quantity <= 0) {
        return removeItem(cart, productId);
    }

    const product = await productService.getProductById(productId);
    if (quantity > product.stock_quantity) {
        throw new Error('Not enough stock available');
    }

    cart[index].quantity = quantity;
    return cart;
}

/**
 * Remove item from cart
 */
function removeItem(cart, productId) {
    return cart.filter(item => item.productId !== productId);
}

/**
 * Clear entire cart
 */
function clearCart() {
    return [];
}

module.exports = {
    getCart,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
};