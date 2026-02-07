import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export type ACPMessageType = 'request' | 'response' | 'event' | 'error';

export interface ACPMessage {
  id: string;
  type: ACPMessageType;
  from: string;
  to: string;
  action: string;
  payload: unknown;
  correlationId?: string;
  timestamp: number;
  ttl?: number;
}

export interface ACPAgent {
  id: string;
  name: string;
  capabilities: string[];
  status: 'ready' | 'busy' | 'offline';
}

export class ACPRouter extends EventEmitter {
  private agents: Map<string, ACPAgent> = new Map();
  private handlers: Map<string, (msg: ACPMessage) => Promise<ACPMessage | null>> = new Map();
  private pendingRequests: Map<string, { resolve: (msg: ACPMessage) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
  private messageLog: ACPMessage[] = [];
  private maxLogSize: number;

  constructor(maxLogSize: number = 100) {
    super();
    this.maxLogSize = maxLogSize;
  }

  register(agent: ACPAgent): void {
    this.agents.set(agent.id, agent);
    this.emit('agent:registered', agent);
  }

  unregister(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.emit('agent:unregistered', agent);
    }
  }

  onAction(action: string, handler: (msg: ACPMessage) => Promise<ACPMessage | null>): void {
    this.handlers.set(action, handler);
  }

  async send(partial: Omit<ACPMessage, 'id' | 'timestamp'>): Promise<ACPMessage | null> {
    const msg: ACPMessage = {
      ...partial,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    this.messageLog.push(msg);
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog.splice(0, this.messageLog.length - this.maxLogSize);
    }

    return this.route(msg);
  }

  async request(to: string, action: string, payload: unknown, timeoutMs: number = 30000): Promise<ACPMessage> {
    const correlationId = randomUUID();

    const promise = new Promise<ACPMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`ACP request timed out after ${timeoutMs}ms: ${action} -> ${to}`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, timer });
    });

    await this.send({
      type: 'request',
      from: 'router',
      to,
      action,
      payload,
      correlationId,
    });

    return promise;
  }

  private async route(msg: ACPMessage): Promise<ACPMessage | null> {
    this.emit('message', msg);

    if (msg.type === 'response' && msg.correlationId) {
      this.resolveRequest(msg.correlationId, msg);
      return null;
    }

    if (msg.to === '*') {
      this.emit('broadcast', msg);
      const handler = this.handlers.get(msg.action);
      if (handler) {
        return handler(msg);
      }
      return null;
    }

    const handler = this.handlers.get(msg.action);
    if (handler) {
      const response = await handler(msg);
      if (response && msg.type === 'request') {
        return response;
      }
      return response;
    }

    return null;
  }

  private resolveRequest(correlationId: string, response: ACPMessage): void {
    const pending = this.pendingRequests.get(correlationId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(correlationId);
      pending.resolve(response);
    }
  }

  getAgents(): ACPAgent[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): ACPAgent | undefined {
    return this.agents.get(id);
  }

  setAgentStatus(agentId: string, status: ACPAgent['status']): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      this.emit('agent:status', { agentId, status });
    }
  }

  findByCapability(capability: string): ACPAgent[] {
    return Array.from(this.agents.values()).filter(
      (agent) => agent.capabilities.includes(capability)
    );
  }

  getLog(): ACPMessage[] {
    return [...this.messageLog];
  }

  clearLog(): void {
    this.messageLog = [];
  }

  dispose(): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
    });
    this.pendingRequests.clear();
    this.removeAllListeners();
  }
}
