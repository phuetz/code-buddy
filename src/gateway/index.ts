/**
 * Gateway Module
 *
 * Centralized WebSocket gateway for multi-client communication.
 * Inspired by OpenClaw's WebSocket gateway (ws://127.0.0.1:18789)
 */

// Types
export type {
  GatewayMessageType,
  GatewayMessage,
  AuthPayload,
  ChatPayload,
  ChatStreamPayload,
  ToolPayload,
  SessionPayload,
  ErrorPayload,
  ClientState,
  GatewayConfig,
  GatewayEvents,
} from './types.js';

export { DEFAULT_GATEWAY_CONFIG } from './types.js';

// Server
export type { MessageHandler } from './server.js';

export {
  createMessage,
  createErrorMessage,
  SessionManager,
  GatewayServer,
  getGatewayServer,
  resetGatewayServer,
} from './server.js';

// WebSocket Transport
export type {
  WebSocketTransportConfig,
  AgentCapabilities,
  RegisteredAgent,
  ControlMessageType,
  ControlMessage,
} from './ws-transport.js';

export {
  DEFAULT_WS_CONFIG,
  WebSocketGateway,
  AgentRegistry,
  createControlMessage,
  getWebSocketGateway,
  resetWebSocketGateway,
} from './ws-transport.js';
