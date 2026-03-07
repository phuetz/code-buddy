const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fsp = require('fs/promises');
const { randomUUID } = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DB_FILE = path.join(__dirname, 'db.json');

let db = {
  incidents: [],
  jobs: [],
};

const jobQueue = [];
let processing = false;

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

async function saveDb() {
  const temp = `${DB_FILE}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(db, null, 2), 'utf8');
  await fsp.rename(temp, DB_FILE);
}

async function loadDb() {
  try {
    const raw = await fsp.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = {
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveDb();
      return;
    }
    throw error;
  }
}

function findJob(id) {
  return db.jobs.find((job) => job.id === id);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processJobs() {
  if (processing) return;
  processing = true;

  while (jobQueue.length > 0) {
    const nextId = jobQueue.shift();
    const job = findJob(nextId);
    if (!job) continue;

    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      await saveDb();
      broadcast({ type: 'jobUpdated', job });

      await sleep(500);

      job.status = 'completed';
      job.updatedAt = new Date().toISOString();
      await saveDb();
      broadcast({ type: 'jobUpdated', job });
    } catch (error) {
      job.status = 'failed';
      job.error = String(error?.message || error);
      job.updatedAt = new Date().toISOString();
      await saveDb();
      broadcast({ type: 'jobUpdated', job });
    }
  }

  processing = false;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (socket) => {
  socket.send(
    JSON.stringify({
      type: 'init',
      incidents: db.incidents,
      jobs: db.jobs,
    }),
  );
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/incidents', (req, res) => {
  res.status(200).json(db.incidents);
});

app.post('/api/incidents', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (!title || !description) {
    res.status(400).json({ message: 'title and description are required' });
    return;
  }

  const incident = {
    id: randomUUID(),
    title,
    description,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.incidents.push(incident);
  await saveDb();
  broadcast({ type: 'incidentCreated', incident });
  res.status(201).json(incident);
});

app.put('/api/incidents/:id', async (req, res) => {
  const incident = db.incidents.find((entry) => entry.id === req.params.id);
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
    const nextDescription = String(req.body.description).trim();
    if (!nextDescription) {
      res.status(400).json({ message: 'Invalid description' });
      return;
    }
    incident.description = nextDescription;
  }
  if (req.body?.status !== undefined) {
    const allowed = new Set(['open', 'in_progress', 'resolved']);
    if (!allowed.has(req.body.status)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }
    incident.status = req.body.status;
  }

  incident.updatedAt = new Date().toISOString();
  await saveDb();
  broadcast({ type: 'incidentUpdated', incident });
  res.status(200).json(incident);
});

app.delete('/api/incidents/:id', async (req, res) => {
  const idx = db.incidents.findIndex((entry) => entry.id === req.params.id);
  if (idx < 0) {
    res.status(404).json({ message: 'Incident not found' });
    return;
  }

  db.incidents.splice(idx, 1);
  await saveDb();
  broadcast({ type: 'incidentDeleted', id: req.params.id });
  res.status(204).end();
});

app.post('/api/jobs', async (req, res) => {
  const task = typeof req.body?.task === 'string' ? req.body.task.trim() : '';
  if (!task) {
    res.status(400).json({ message: 'task is required' });
    return;
  }

  const job = {
    id: randomUUID(),
    task,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.jobs.push(job);
  await saveDb();
  broadcast({ type: 'jobCreated', job });
  jobQueue.push(job.id);
  processJobs();
  res.status(202).json(job);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = findJob(req.params.id);
  if (!job) {
    res.status(404).json({ message: 'Job not found' });
    return;
  }
  res.status(200).json(job);
});

app.post('/api/assist/summarize', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ message: 'text is required' });
    return;
  }

  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ message: 'Gemini API key is not configured' });
    return;
  }

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const client = new GoogleGenerativeAI(apiKey);
    const genModel = client.getGenerativeModel({ model });
    const prompt = `Summarize this incident in <= 2 sentences:\n\n${text}`;
    const result = await genModel.generateContent(prompt);
    const summary = result.response.text().trim();
    res.status(200).json({ summary });
  } catch (error) {
    res.status(502).json({
      message: 'Gemini request failed',
      details: String(error?.message || error),
    });
  }
});

async function startServer(port = Number(process.env.PORT || 3000)) {
  await loadDb();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      console.log(`Server listening on http://127.0.0.1:${actualPort}`);
      resolve(actualPort);
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
