const { createClient } = require('redis');

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('connect', () => {
    console.log('✅ Redis connected');
});

redisClient.on('ready', () => {
    console.log('✅ Redis ready');
});

redisClient.on('error', (err) => {
    console.error('❌ Redis error:', err.message);
});

redisClient.on('reconnecting', () => {
    console.log('🔄 Redis reconnecting...');
});

module.exports = redisClient;
