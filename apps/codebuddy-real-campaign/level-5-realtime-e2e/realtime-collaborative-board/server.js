const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const DATA_FILE = path.join(__dirname, 'items.json');

function loadItems() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let items = loadItems();

function saveItems() {
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/items', (req, res) => {
  res.json(items);
});

app.get('/api/items/:id', (req, res) => {
  const item = items.find((entry) => entry.id === req.params.id);
  if (!item) {
    res.status(404).json({ message: 'Item not found' });
    return;
  }
  res.json(item);
});

app.post('/api/items', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title) {
    res.status(400).json({ message: 'Invalid title' });
    return;
  }

  const item = {
    id: randomUUID(),
    title,
    done: Boolean(req.body?.done),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  items.push(item);
  saveItems();
  broadcast({ type: 'item.created', payload: item });
  res.status(201).json(item);
});

app.put('/api/items/:id', (req, res) => {
  const idx = items.findIndex((entry) => entry.id === req.params.id);
  if (idx < 0) {
    res.status(404).json({ message: 'Item not found' });
    return;
  }

  const nextTitle =
    req.body?.title === undefined ? items[idx].title : String(req.body.title).trim();
  if (!nextTitle) {
    res.status(400).json({ message: 'Invalid title' });
    return;
  }
  const updated = {
    ...items[idx],
    title: nextTitle,
    done: req.body?.done === undefined ? items[idx].done : Boolean(req.body.done),
    updatedAt: new Date().toISOString(),
  };
  items[idx] = updated;
  saveItems();
  broadcast({ type: 'item.updated', payload: updated });
  res.json(updated);
});

app.delete('/api/items/:id', (req, res) => {
  const idx = items.findIndex((entry) => entry.id === req.params.id);
  if (idx < 0) {
    res.status(404).json({ message: 'Item not found' });
    return;
  }

  const [deleted] = items.splice(idx, 1);
  saveItems();
  broadcast({ type: 'item.deleted', payload: { id: deleted.id } });
  res.status(204).end();
});

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'snapshot', payload: items }));
});

function startServer(port = Number(process.env.PORT || 3000)) {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      console.log(`Server listening on http://127.0.0.1:${actualPort}`);
      resolve(actualPort);
    });
  });
}

function stopServer() {
  for (const client of wss.clients) {
    client.close();
  }
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

module.exports = { app, server, wss, startServer, stopServer };

if (require.main === module) {
  startServer();
}
