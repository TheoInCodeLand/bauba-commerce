const { Meilisearch } = require('meilisearch');

const meiliClient = new Meilisearch({
    host: process.env.MEILISEARCH_URL || 'http://localhost:7700',
    apiKey: process.env.MEILI_MASTER_KEY || undefined,
});

// Graceful startup check — log reachability without crashing the app
async function checkMeilisearchHealth() {
    try {
        const health = await meiliClient.health();
        console.log(`--success-- Meilisearch reachable (status: ${health.status})`);
    } catch (err) {
        console.error('⚠️  Meilisearch is NOT reachable:', err.message);
        console.error('   Search will fall back to PostgreSQL until Meilisearch is available.');
    }
}

module.exports = { meiliClient, checkMeilisearchHealth };
