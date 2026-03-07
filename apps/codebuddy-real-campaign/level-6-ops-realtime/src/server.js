const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'incidents.json');

let incidents = {};
let jobs = {};
const jobQueue = [];
let jobProcessorActive = false;

function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function loadIncidents() {
  await ensureDataDir();
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    incidents = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      incidents = {};
      await saveIncidents();
      return;
    }
    throw error;
  }
}

async function saveIncidents() {
  await ensureDataDir();
  const temp = `${DATA_FILE}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(incidents, null, 2), 'utf8');
  await fsp.rename(temp, DATA_FILE);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processQueue() {
  if (jobProcessorActive) return;
  jobProcessorActive = true;

  while (jobQueue.length > 0) {
    const jobId = jobQueue.shift();
    const job = jobs[jobId];
    if (!job) continue;

    try {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      broadcast({ type: 'job_updated', job });

      await sleep(400);

      job.status = 'done';
      job.completedAt = new Date().toISOString();
      broadcast({ type: 'job_updated', job });
    } catch (error) {
      job.status = 'failed';
      job.error = String(error?.message || error);
      job.completedAt = new Date().toISOString();
      broadcast({ type: 'job_updated', job });
    }
  }

  jobProcessorActive = false;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

wss.on('connection', (socket) => {
  socket.send(
    JSON.stringify({
      type: 'job_snapshot',
      jobs: Object.values(jobs),
    }),
  );
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/incidents', (req, res) => {
  res.status(200).json(Object.values(incidents));
});

app.get('/api/incidents/:id', (req, res) => {
  const incident = incidents[req.params.id];
  if (!incident) {
    res.status(404).json({ message: 'Incident not found' });
    return;
  }
  res.status(200).json(incident);
});

app.post('/api/incidents', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (!title || !description) {
    res.status(400).json({ message: 'Title and description are required' });
    return;
  }

  const id = randomUUID();
  const incident = {
    id,
    title,
    description,
    status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  incidents[id] = incident;
  await saveIncidents();
  broadcast({ type: 'incident_created', incident });
  res.status(201).json(incident);
});

app.put('/api/incidents/:id', async (req, res) => {
  const incident = incidents[req.params.id];
  if (!incident) {
    res.status(404).json({ message: 'Incident not found' });
    return;
  }

  if (req.body?.title !== undefined) {
    const nextTitle = String(req.body.title).trim();
    if (!nextTitle) {
      res.status(400).json({ message: 'Invalid title' });
      return;
    }
    incident.title = nextTitle;
  }
  if (req.body?.description !== undefined) {
    const nextDesc = String(req.body.description).trim();
    if (!nextDesc) {
      res.status(400).json({ message: 'Invalid description' });
      return;
    }
    incident.description = nextDesc;
  }
  if (req.body?.status !== undefined) {
    const allowed = new Set(['new', 'in_progress', 'resolved']);
    if (!allowed.has(req.body.status)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }
    incident.status = req.body.status;
  }

  incident.updatedAt = new Date().toISOString();
  await saveIncidents();
  broadcast({ type: 'incident_updated', incident });
  res.status(200).json(incident);
});

app.delete('/api/incidents/:id', async (req, res) => {
  const incident = incidents[req.params.id];
  if (!incident) {
    res.status(404).json({ message: 'Incident not found' });
    return;
  }

  delete incidents[req.params.id];
  await saveIncidents();
  broadcast({ type: 'incident_deleted', id: req.params.id });
  res.status(204).end();
});

app.post('/api/jobs', (req, res) => {
  const task = typeof req.body?.task === 'string' ? req.body.task.trim() : '';
  if (!task) {
    res.status(400).json({ message: 'Task is required' });
    return;
  }

  const id = randomUUID();
  const job = {
    id,
    task,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  jobs[id] = job;
  jobQueue.push(id);
  broadcast({ type: 'job_created', job });
  processQueue();
  res.status(202).json(job);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) {
    res.status(404).json({ message: 'Job not found' });
    return;
  }
  res.status(200).json(job);
});

async function startServer(port = Number(process.env.PORT || 0)) {
  await loadIncidents();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      console.log(`Server listening on http://127.0.0.1:${actual}`);
      if (process.env.NODE_ENV === 'test' && typeof process.send === 'function') {
        process.send({ port: actual });
      }
      resolve(actual);
    });
  });
}

async function stopServer() {
  for (const client of wss.clients) {
    client.close();
  }
  return new Promise((resolve) => server.close(resolve));
}

module.exports = {
  app,
  server,
  wss,
  DATA_FILE,
  startServer,
  stopServer,
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
