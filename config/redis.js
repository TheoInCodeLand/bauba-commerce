const { createClient } = require('redis');

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('connect', () => {
    console.log('--success-- Redis connected');
});

redisClient.on('ready', () => {
    console.log('--success-- Redis ready');
});

redisClient.on('error', (err) => {
    console.error('--failed-- Redis error:', err.message);
});

redisClient.on('reconnecting', () => {
    console.log('--retry-- Redis reconnecting...');
});

module.exports = redisClient;
