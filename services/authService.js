const bcrypt = require('bcryptjs');
const db = require('../config/db');

/**
 * Register a new user
 * @param {string} email
 * @param {string} password - plain text, will be hashed
 * @returns {Object} created user (without password_hash)
 */
async function register(email, password) {
    // Check if email already exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
        throw new Error('Email already registered');
    }

    // Hash password with bcrypt (salt rounds: 10)
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await db.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, is_admin, created_at',
        [email, passwordHash]
    );

    return result.rows[0];
}

/**
 * Authenticate user credentials
 * @param {string} email
 * @param {string} password - plain text
 * @returns {Object|null} user object if valid, null if invalid
 */
async function login(email, password) {
    const result = await db.query(
        'SELECT id, email, password_hash, is_admin FROM users WHERE email = $1',
        [email]
    );

    if (result.rows.length === 0) {
        return null; // User not found
    }

    const user = result.rows[0];

    // Compare plain password with stored hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
        return null;
    }

    // Return user without password_hash
    return {
        id: user.id,
        email: user.email,
        is_admin: user.is_admin,
    };
}

/**
 * Get user by ID (for session restoration or profile)
 */
async function getUserById(userId) {
    const result = await db.query(
        'SELECT id, email, is_admin, created_at FROM users WHERE id = $1',
        [userId]
    );
    return result.rows[0] || null;
}

module.exports = {
    register,
    login,
    getUserById,
};