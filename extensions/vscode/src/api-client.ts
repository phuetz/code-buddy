import type {
  ChatResponse,
  CommandRequest,
  CommandResponse,
  HealthStatus,
  ServerMetrics,
} from './types';

export class CodeBuddyClient {
  private baseUrl: string;
  private sessionId: string | undefined;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async chat(message: string): Promise<string> {
    const body: Record<string, unknown> = { message };
    if (this.sessionId) {
      body.sessionId = this.sessionId;
    }

    const res = await this.fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as ChatResponse;
    if (data.sessionId) {
      this.sessionId = data.sessionId;
    }
    return data.response;
  }

  async getStatus(): Promise<HealthStatus> {
    const res = await this.fetch('/api/health');
    return (await res.json()) as HealthStatus;
  }

  async getMetrics(): Promise<ServerMetrics> {
    const res = await this.fetch('/api/metrics');
    return (await res.json()) as ServerMetrics;
  }

  async executeCommand(command: string, args?: Record<string, unknown>): Promise<CommandResponse> {
    const body: CommandRequest = { command, args };
    const res = await this.fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `/${command}${args ? ' ' + JSON.stringify(args) : ''}` }),
    });
    return (await res.json()) as CommandResponse;
  }

  async isConnected(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status.status === 'ok';
    } catch {
      return false;
    }
  }

  resetSession(): void {
    this.sessionId = undefined;
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`CodeBuddy server returned ${res.status}: ${res.statusText}`);
      }
      return res;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after 30 seconds`);
      }
      if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('ECONNREFUSED'))) {
        throw new Error(
          `Cannot connect to CodeBuddy server at ${this.baseUrl}. Is the server running? Start it with: buddy server start`
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
