
const WebSocket = require('ws');

const WORKER_TYPE = 'workerB';
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
        const success = Math.random() > 0.4; // 60% success rate

        if (success) {
            console.log(`${WORKER_TYPE} finished job ${job.id}`);
        } else {
            console.log(`${WORKER_TYPE} failed job ${job.id}`);
        }
    }, 3000);
};

connectWebSocket();
