const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JOBS_FILE = path.join(__dirname, 'jobs.json');
const MAX_RETRIES = 2;
let jobs = {};
const queue = [];
let processing = false;

function broadcast(event, job) {
  const payload = JSON.stringify({ event, job });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

async function saveJobs() {
  const temp = `${JOBS_FILE}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(jobs, null, 2), 'utf8');
  await fsp.rename(temp, JOBS_FILE);
}

async function loadJobs() {
  try {
    const raw = await fsp.readFile(JOBS_FILE, 'utf8');
    jobs = JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      jobs = {};
      await saveJobs();
      return;
    }
    throw error;
  }
}

const workers = {
  workerA: async (job) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    // deterministic: first attempt fails once, then success
    if (job.retries === 0) throw new Error('workerA transient error');
    return { ok: true };
  },
  workerB: async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    return { ok: true };
  },
};

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const jobId = queue.shift();
    const job = jobs[jobId];
    if (!job) continue;
    const worker = workers[job.type];
    if (!worker) {
      job.status = 'failed';
      job.error = `Unknown worker type: ${job.type}`;
      job.updatedAt = new Date().toISOString();
      await saveJobs();
      broadcast('job_failed', job);
      continue;
    }

    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      await saveJobs();
      broadcast('job_running', job);
      await worker(job);
      job.status = 'done';
      job.updatedAt = new Date().toISOString();
      await saveJobs();
      broadcast('job_done', job);
    } catch (error) {
      if (job.retries < MAX_RETRIES) {
        job.retries += 1;
        job.status = 'retry';
        job.updatedAt = new Date().toISOString();
        job.error = String(error?.message || error);
        await saveJobs();
        broadcast('job_retry', job);
        queue.push(job.id);
      } else {
        job.status = 'failed';
        job.updatedAt = new Date().toISOString();
        job.error = String(error?.message || error);
        await saveJobs();
        broadcast('job_failed', job);
      }
    }
  }

  processing = false;
}

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/api/jobs', async (req, res) => {
  const type = typeof req.body?.type === 'string' ? req.body.type : '';
  const payload = req.body?.payload ?? {};
  if (!type) return res.status(400).json({ message: 'Job type is required' });

  const job = {
    id: `job-${randomUUID()}`,
    type,
    payload,
    status: 'queued',
    retries: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs[job.id] = job;
  queue.push(job.id);
  await saveJobs();
  broadcast('job_queued', job);
  processQueue();
  res.status(201).json(job);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ message: 'Job not found' });
  res.status(200).json(job);
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ event: 'initial_jobs', jobs: Object.values(jobs) }));
});

async function startServer(port = Number(process.env.PORT || 0)) {
  await loadJobs();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      console.log(`Server listening on port ${actual}`);
      resolve(actual);
    });
  });
}

module.exports = { app, server, startServer };

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
