const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
});

pool.on('connect', () => {
    console.log('db connected');
});

pool.on('error', (err) => {
    console.error('db connection error:', err.message);
});

const query = (text, params) => pool.query(text, params);

module.exports = {
    pool,
    query,
};