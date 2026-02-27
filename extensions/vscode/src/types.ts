export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  model?: string;
}

export interface ChatResponse {
  response: string;
  sessionId: string;
  model?: string;
  tokensUsed?: number;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  version?: string;
  uptime?: number;
}

export interface CommandRequest {
  command: string;
  args?: Record<string, unknown>;
}

export interface CommandResponse {
  success: boolean;
  output?: string;
  error?: string;
}

export interface ServerMetrics {
  totalRequests: number;
  activeSessions: number;
  uptime: number;
}

export interface WebviewMessage {
  type: 'sendMessage' | 'clearChat' | 'getStatus';
  payload?: string;
}

export interface WebviewResponse {
  type: 'response' | 'error' | 'status' | 'loading';
  payload: string;
}
