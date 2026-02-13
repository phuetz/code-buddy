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
  /** Auth token — if not set, authentication is DISABLED (use with caution) */
  authToken?: string;
  /** Require authentication even if authToken is not set */
  requireAuth?: boolean;
  maxTokens: number;
  /** Absolute max tokens a client can request */
  maxTokensLimit?: number;
  /** Rate limit: max requests per minute per IP */
  rateLimitPerMinute?: number;
  onCompletion: (req: CopilotCompletionRequest) => Promise<CopilotCompletionResponse>;
}

export class CopilotProxy extends EventEmitter {
  private server: ReturnType<typeof createServer> | null = null;
  private config: CopilotProxyConfig;
  private requestCount: number = 0;
  /** Rate limiter: IP → { count, windowStart } */
  private rateLimitMap = new Map<string, { count: number; windowStart: number }>();
  private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CopilotProxyConfig) {
    super();
    this.config = {
      requireAuth: false,
      maxTokensLimit: 8192,
      rateLimitPerMinute: 60,
      ...config,
    };
    // Cleanup stale rate limit entries every 5 minutes
    this.rateLimitCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of this.rateLimitMap) {
        if (now - entry.windowStart > 120000) {
          this.rateLimitMap.delete(ip);
        }
      }
    }, 300000);
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.requestCount++;

    // Rate limiting
    if (this.config.rateLimitPerMinute && this.config.rateLimitPerMinute > 0) {
      const clientIp = req.socket.remoteAddress || 'unknown';
      if (!this.checkRateLimit(clientIp)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 429 }
        }));
        return;
      }
    }

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

        // Clamp max_tokens to prevent abuse
        const limit = this.config.maxTokensLimit || 8192;
        if (parsed.max_tokens > limit) {
          parsed.max_tokens = limit;
        }

        const response = await this.config.onCompletion(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        // Don't leak internal error details to clients
        const isSyntaxError = err instanceof SyntaxError;
        const message = isSyntaxError
          ? 'Invalid JSON in request body'
          : 'Internal completion error';
        const type = isSyntaxError ? 'invalid_request_error' : 'server_error';
        const code = isSyntaxError ? 400 : 500;
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
    const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Payload too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private authenticate(req: IncomingMessage): boolean {
    // If requireAuth is true but no token is configured, reject all
    if (!this.config.authToken && this.config.requireAuth) {
      return false;
    }
    // If no auth token configured and requireAuth is false, allow (development mode)
    if (!this.config.authToken) {
      return true;
    }
    const header = req.headers.authorization;
    if (!header) {
      return false;
    }
    return header === `Bearer ${this.config.authToken}`;
  }

  /**
   * Token-bucket rate limiter per IP.
   */
  private checkRateLimit(clientIp: string): boolean {
    const limit = this.config.rateLimitPerMinute || 60;
    const now = Date.now();
    const windowMs = 60000; // 1 minute

    let entry = this.rateLimitMap.get(clientIp);
    if (!entry || (now - entry.windowStart) > windowMs) {
      entry = { count: 0, windowStart: now };
      this.rateLimitMap.set(clientIp, entry);
    }

    entry.count++;
    return entry.count <= limit;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  async stop(): Promise<void> {
    if (this.rateLimitCleanupTimer) {
      clearInterval(this.rateLimitCleanupTimer);
      this.rateLimitCleanupTimer = null;
    }
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
}
