import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface CanvasContent {
  type: 'html' | 'markdown' | 'json' | 'reset';
  content: string;
  title?: string;
  timestamp: number;
}

const HTML_PAGE = `<!DOCTYPE html>
<html><head><title>Code Buddy Canvas</title>
<style>
  body { font-family: system-ui; margin: 0; padding: 20px; background: #1a1a2e; color: #eee; }
  #canvas { max-width: 900px; margin: 0 auto; }
  .entry { background: #16213e; padding: 16px; border-radius: 8px; margin-bottom: 12px; border-left: 3px solid #7c3aed; }
  .entry .title { font-weight: bold; color: #a78bfa; margin-bottom: 8px; }
  .entry .time { font-size: 12px; color: #666; }
  h1 { color: #a78bfa; text-align: center; }
  #status { text-align: center; color: #4ade80; font-size: 14px; margin-bottom: 20px; }
</style></head>
<body>
<h1>Code Buddy Canvas</h1>
<div id="status">Connected</div>
<div id="canvas"></div>
<script>
const ws = new WebSocket('ws://' + location.host);
const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
ws.onopen = () => { status.textContent = 'Connected'; status.style.color = '#4ade80'; };
ws.onclose = () => { status.textContent = 'Disconnected'; status.style.color = '#f87171'; };
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'reset') { canvas.innerHTML = ''; return; }
  if (msg.type === 'history') { msg.items.forEach(addEntry); return; }
  addEntry(msg);
};
function addEntry(msg) {
  const div = document.createElement('div');
  div.className = 'entry';
  const time = new Date(msg.timestamp).toLocaleTimeString();
  div.innerHTML = (msg.title ? '<div class="title">' + msg.title + '</div>' : '') +
    '<div>' + msg.content + '</div>' +
    '<div class="time">' + time + '</div>';
  canvas.prepend(div);
}
</script></body></html>`;

export class CanvasServer extends EventEmitter {
  private server: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private history: CanvasContent[] = [];
  private port: number;
  private maxHistory: number;

  constructor(port: number = 3100, maxHistory: number = 50) {
    super();
    this.port = port;
    this.maxHistory = maxHistory;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML_PAGE);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      this.emit('connection', ws);

      if (this.history.length > 0) {
        ws.send(JSON.stringify({ type: 'history', items: this.history }));
      }

      ws.on('close', () => {
        this.clients.delete(ws);
        this.emit('disconnection', ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.on('error', reject);
      this.server!.listen(this.port, () => {
        this.emit('started', this.port);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    for (const client of Array.from(this.clients)) {
      client.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.emit('stopped');
        resolve();
      });
    });
  }

  push(content: Omit<CanvasContent, 'timestamp'>): void {
    const entry: CanvasContent = {
      ...content,
      timestamp: Date.now(),
    };

    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    const message = JSON.stringify(entry);
    for (const client of Array.from(this.clients)) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }

    this.emit('push', entry);
  }

  reset(): void {
    this.history = [];

    const message = JSON.stringify({ type: 'reset' });
    for (const client of Array.from(this.clients)) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }

    this.emit('reset');
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getHistory(): CanvasContent[] {
    return [...this.history];
  }

  isRunning(): boolean {
    return this.server !== null;
  }
}
