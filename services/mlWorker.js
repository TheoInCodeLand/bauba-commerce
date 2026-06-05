const { spawn } = require('child_process');
const path = require('path');

function runRecommendationEngine() {
    console.log('[ML Worker] Starting Recommendation Engine...');
    
    const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_recs.py');
    const pythonProcess = spawn('python', [scriptPath]);
    
    pythonProcess.stdout.on('data', (data) => {
        console.log(`[ML Worker] ${data.toString().trim()}`);
    });
    
    pythonProcess.stderr.on('data', (data) => {
        console.error(`[ML Worker Error] ${data.toString().trim()}`);
    });
    
    pythonProcess.on('close', (code) => {
        console.log(`[ML Worker] Process exited with code ${code}`);
    });
}

function startMLWorker() {
    // Run immediately on startup
    runRecommendationEngine();
    
    // Then run every 24 hours
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    setInterval(runRecommendationEngine, TWENTY_FOUR_HOURS);
}

module.exports = {
    startMLWorker,
    runRecommendationEngine
};
