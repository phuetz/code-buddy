
const WebSocket = require('ws');

const WORKER_TYPE = 'workerA';
const WS_URL = process.env.WS_URL || 'ws://localhost:3000'; // Default to port 3000 for simplicity, will be dynamic for smoke test

let ws;

const connectWebSocket = () => {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log(`${WORKER_TYPE} connected to WebSocket server`);
    };

    ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.event === 'job_queued' && message.job.type === WORKER_TYPE) {
            processJob(message.job);
        }
    };

    ws.onclose = () => {
        console.log(`${WORKER_TYPE} disconnected. Reconnecting in 3 seconds...`);
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = err => {
        console.error(`${WORKER_TYPE} WebSocket error:`, err.message);
        ws.close();
    };
};

const processJob = (job) => {
    console.log(`${WORKER_TYPE} processing job ${job.id} (retries: ${job.retries})`);

    // Simulate work
    setTimeout(() => {
        // In a real scenario, workers would update job status via HTTP API
        // For this exercise, we'll simulate success/failure and rely on the main server to handle retries/status updates.
        const success = Math.random() > 0.2; // 80% success rate

        if (success) {
            console.log(`${WORKER_TYPE} finished job ${job.id}`);
            // Ideally, send a message to the server to update status to 'done'
        } else {
            console.log(`${WORKER_TYPE} failed job ${job.id}`);
            // Ideally, send a message to the server to update status to 'failed' or 'retry'
        }
    }, 2500);
};

connectWebSocket();
