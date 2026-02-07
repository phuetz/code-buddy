import { createServer, IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';

export interface CopilotCompletionRequest {
  prompt: string;
  suffix?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stop?: string[];
  language?: string;
  file_path?: string;
}

export interface CopilotCompletionResponse {
  id: string;
  choices: Array<{
    text: string;
    index: number;
    finish_reason: 'stop' | 'length';
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface CopilotProxyConfig {
  port: number;
  host: string;
  authToken?: string;
  maxTokens: number;
  onCompletion: (req: CopilotCompletionRequest) => Promise<CopilotCompletionResponse>;
}

export class CopilotProxy extends EventEmitter {
  private server: ReturnType<typeof createServer> | null = null;
  private config: CopilotProxyConfig;
  private requestCount: number = 0;

  constructor(config: CopilotProxyConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.emit('error', err);
          if (!res.writableEnded) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: { message: 'Internal server error', type: 'server_error', code: 500 }
            }));
          }
        });
      });

      this.server.on('error', reject);

      this.server.listen(this.config.port, this.config.host, () => {
        this.emit('listening');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        this.server = null;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.requestCount++;

    if (!this.authenticate(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { message: 'Unauthorized', type: 'auth_error', code: 401 }
      }));
      return;
    }

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (method === 'GET' && url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [{ id: 'codebuddy', object: 'model' }]
      }));
      return;
    }

    if (method === 'POST' && (url === '/v1/completions' || url === '/v1/engines/codex/completions')) {
      try {
        const body = await this.parseBody(req);
        const parsed = JSON.parse(body) as CopilotCompletionRequest;

        if (!parsed.prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: { message: 'Missing required field: prompt', type: 'invalid_request_error', code: 400 }
          }));
          return;
        }

        if (parsed.max_tokens === undefined) {
          parsed.max_tokens = this.config.maxTokens;
        }

        const response = await this.config.onCompletion(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        const message = err instanceof SyntaxError
          ? 'Invalid JSON in request body'
          : (err instanceof Error ? err.message : 'Unknown error');
        const type = err instanceof SyntaxError ? 'invalid_request_error' : 'server_error';
        const code = err instanceof SyntaxError ? 400 : 500;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message, type, code } }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: 'Not found', type: 'not_found', code: 404 }
    }));
  }

  private parseBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private authenticate(req: IncomingMessage): boolean {
    if (!this.config.authToken) {
      return true;
    }
    const header = req.headers.authorization;
    if (!header) {
      return false;
    }
    return header === `Bearer ${this.config.authToken}`;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }
}
