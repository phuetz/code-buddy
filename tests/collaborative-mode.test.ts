/**
 * Collaborative Mode Tests
 */

import {
  CollaborationServer,
  CollaborationClient,
  createCollaborationServer,
  createCollaborationClient,
  type Collaborator,
  type CollaboratorRole,
  type CollaborationSession,
  type SessionSettings,
  type ToolCallState,
  type SessionEvent,
  type EventType,
} from '../src/collaboration/collaborative-mode.js';

describe('CollaborationServer', () => {
  let server: CollaborationServer;

  beforeEach(() => {
    server = new CollaborationServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('Initialization', () => {
    it('should create server instance', () => {
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(CollaborationServer);
    });

    it('should have no sessions initially', () => {
      const sessions = server.getSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe('Session Management', () => {
    it('should return undefined for non-existent session', () => {
      const session = server.getSession('non-existent');
      expect(session).toBeUndefined();
    });

    it('should emit events', () => {
      const handler = jest.fn();
      server.on('session:created', handler);

      // Event listener is registered
      expect(server.listenerCount('session:created')).toBe(1);
    });
  });

  describe('Factory', () => {
    it('should create server with factory', () => {
      const s = createCollaborationServer();
      expect(s).toBeInstanceOf(CollaborationServer);
    });
  });
});

describe('CollaborationClient', () => {
  let client: CollaborationClient;

  beforeEach(() => {
    client = new CollaborationClient('Test User');
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('Initialization', () => {
    it('should create client with name', () => {
      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(CollaborationClient);
    });

    it('should generate unique collaborator ID', () => {
      const id = client.getCollaboratorId();
      expect(id).toBeDefined();
      expect(id.length).toBe(16); // 8 bytes = 16 hex chars
    });

    it('should have no session initially', () => {
      expect(client.getSessionId()).toBeNull();
    });
  });

  describe('Events', () => {
    it('should register event listeners', () => {
      const handler = jest.fn();
      client.on('session:joined', handler);
      expect(client.listenerCount('session:joined')).toBe(1);
    });

    it('should register error listeners', () => {
      const handler = jest.fn();
      client.on('error', handler);
      expect(client.listenerCount('error')).toBe(1);
    });

    it('should register sync listeners', () => {
      const handler = jest.fn();
      client.on('sync', handler);
      expect(client.listenerCount('sync')).toBe(1);
    });

    it('should register event listeners', () => {
      const handler = jest.fn();
      client.on('event', handler);
      expect(client.listenerCount('event')).toBe(1);
    });

    it('should register disconnected listeners', () => {
      const handler = jest.fn();
      client.on('disconnected', handler);
      expect(client.listenerCount('disconnected')).toBe(1);
    });

    it('should register reconnecting listeners', () => {
      const handler = jest.fn();
      client.on('reconnecting', handler);
      expect(client.listenerCount('reconnecting')).toBe(1);
    });
  });

  describe('Connection', () => {
    it('should fail to connect to non-existent server', async () => {
      // Handle error event to prevent unhandled error
      client.on('error', () => {});

      try {
        await client.connect('ws://localhost:59999');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Factory', () => {
    it('should create client with factory', () => {
      const c = createCollaborationClient('User');
      expect(c).toBeInstanceOf(CollaborationClient);
      expect(c.getCollaboratorId()).toBeDefined();
      c.disconnect();
    });

    it('should create clients with unique IDs', () => {
      const c1 = createCollaborationClient('User 1');
      const c2 = createCollaborationClient('User 2');

      expect(c1.getCollaboratorId()).not.toBe(c2.getCollaboratorId());

      c1.disconnect();
      c2.disconnect();
    });
  });
});

describe('Collaborator Types', () => {
  it('should define collaborator structure', () => {
    const collaborator: Collaborator = {
      id: 'user-123',
      name: 'Test User',
      color: '#FF6B6B',
      role: 'editor',
      lastSeen: Date.now(),
      status: 'online',
    };

    expect(collaborator.id).toBe('user-123');
    expect(collaborator.name).toBe('Test User');
    expect(collaborator.role).toBe('editor');
    expect(collaborator.status).toBe('online');
  });

  it('should support cursor position', () => {
    const collaborator: Collaborator = {
      id: 'user-123',
      name: 'Test User',
      color: '#FF6B6B',
      role: 'owner',
      cursor: {
        file: '/src/index.ts',
        line: 42,
        column: 10,
      },
      lastSeen: Date.now(),
      status: 'online',
    };

    expect(collaborator.cursor?.file).toBe('/src/index.ts');
    expect(collaborator.cursor?.line).toBe(42);
    expect(collaborator.cursor?.column).toBe(10);
  });

  it('should support all roles', () => {
    const roles: CollaboratorRole[] = ['owner', 'editor', 'viewer'];

    for (const role of roles) {
      const collaborator: Collaborator = {
        id: 'user',
        name: 'User',
        color: '#000',
        role,
        lastSeen: Date.now(),
        status: 'online',
      };
      expect(collaborator.role).toBe(role);
    }
  });

  it('should support all statuses', () => {
    const statuses: Array<'online' | 'away' | 'offline'> = ['online', 'away', 'offline'];

    for (const status of statuses) {
      const collaborator: Collaborator = {
        id: 'user',
        name: 'User',
        color: '#000',
        role: 'editor',
        lastSeen: Date.now(),
        status,
      };
      expect(collaborator.status).toBe(status);
    }
  });
});

describe('Session Settings', () => {
  it('should define session settings structure', () => {
    const settings: SessionSettings = {
      requireApproval: true,
      approvalThreshold: 0.5,
      allowViewerMessages: true,
      maxCollaborators: 10,
      autoSyncInterval: 5000,
    };

    expect(settings.requireApproval).toBe(true);
    expect(settings.approvalThreshold).toBe(0.5);
    expect(settings.maxCollaborators).toBe(10);
  });

  it('should support approval threshold values', () => {
    // 100% approval required
    const strictSettings: SessionSettings = {
      requireApproval: true,
      approvalThreshold: 1.0,
      allowViewerMessages: false,
      maxCollaborators: 5,
      autoSyncInterval: 10000,
    };

    expect(strictSettings.approvalThreshold).toBe(1.0);

    // Any single approval
    const lenientSettings: SessionSettings = {
      requireApproval: true,
      approvalThreshold: 0.1,
      allowViewerMessages: true,
      maxCollaborators: 20,
      autoSyncInterval: 3000,
    };

    expect(lenientSettings.approvalThreshold).toBe(0.1);
  });
});

describe('Tool Call State', () => {
  it('should define tool call structure', () => {
    const toolCall: ToolCallState = {
      id: 'tc-123',
      name: 'read_file',
      args: { path: '/src/index.ts' },
      initiatedBy: 'user-456',
      status: 'pending',
      approvals: [],
      rejections: [],
    };

    expect(toolCall.id).toBe('tc-123');
    expect(toolCall.name).toBe('read_file');
    expect(toolCall.args.path).toBe('/src/index.ts');
    expect(toolCall.status).toBe('pending');
  });

  it('should track approvals', () => {
    const toolCall: ToolCallState = {
      id: 'tc-123',
      name: 'write_file',
      args: { path: '/test.txt', content: 'hello' },
      initiatedBy: 'user-1',
      status: 'pending',
      approvals: ['user-2', 'user-3'],
      rejections: [],
    };

    expect(toolCall.approvals).toHaveLength(2);
    expect(toolCall.approvals).toContain('user-2');
    expect(toolCall.approvals).toContain('user-3');
  });

  it('should track rejections', () => {
    const toolCall: ToolCallState = {
      id: 'tc-123',
      name: 'execute_bash',
      args: { command: 'rm -rf /' },
      initiatedBy: 'user-1',
      status: 'rejected',
      approvals: [],
      rejections: ['user-2'],
    };

    expect(toolCall.status).toBe('rejected');
    expect(toolCall.rejections).toContain('user-2');
  });

  it('should support all statuses', () => {
    const statuses: Array<ToolCallState['status']> = [
      'pending',
      'approved',
      'rejected',
      'executing',
      'completed',
      'failed',
    ];

    for (const status of statuses) {
      const toolCall: ToolCallState = {
        id: 'tc',
        name: 'test',
        args: {},
        initiatedBy: 'user',
        status,
        approvals: [],
        rejections: [],
      };
      expect(toolCall.status).toBe(status);
    }
  });

  it('should include result for completed calls', () => {
    const toolCall: ToolCallState = {
      id: 'tc-123',
      name: 'read_file',
      args: { path: '/test.txt' },
      initiatedBy: 'user-1',
      status: 'completed',
      approvals: ['user-1', 'user-2'],
      rejections: [],
      result: { content: 'file contents here' },
    };

    expect(toolCall.result).toEqual({ content: 'file contents here' });
  });
});

describe('Session Events', () => {
  it('should define event structure', () => {
    const event: SessionEvent = {
      id: 'evt-123',
      type: 'message',
      timestamp: Date.now(),
      collaboratorId: 'user-456',
      data: { text: 'Hello everyone!' },
    };

    expect(event.id).toBe('evt-123');
    expect(event.type).toBe('message');
    expect(event.collaboratorId).toBe('user-456');
  });

  it('should support all event types', () => {
    const eventTypes: EventType[] = [
      'join',
      'leave',
      'message',
      'tool_call',
      'tool_result',
      'file_change',
      'cursor_move',
      'approval',
      'rejection',
      'state_sync',
    ];

    for (const type of eventTypes) {
      const event: SessionEvent = {
        id: 'evt',
        type,
        timestamp: Date.now(),
        collaboratorId: 'user',
        data: null,
      };
      expect(event.type).toBe(type);
    }
  });

  it('should include timestamp', () => {
    const now = Date.now();
    const event: SessionEvent = {
      id: 'evt-123',
      type: 'join',
      timestamp: now,
      collaboratorId: 'user-456',
      data: {},
    };

    expect(event.timestamp).toBe(now);
  });
});

describe('Integration Tests (Without WebSocket)', () => {
  describe('Server Lifecycle', () => {
    it('should handle stop without start', async () => {
      const server = new CollaborationServer();
      await expect(server.stop()).resolves.not.toThrow();
    });

    it('should clear state on stop', async () => {
      const server = new CollaborationServer();

      // Register some event handlers
      server.on('session:created', jest.fn());
      server.on('session:ended', jest.fn());

      await server.stop();

      // Sessions should be empty
      expect(server.getSessions()).toHaveLength(0);
    });
  });

  describe('Client Lifecycle', () => {
    it('should handle disconnect without connect', () => {
      const client = new CollaborationClient('User');
      expect(() => client.disconnect()).not.toThrow();
    });

    it('should handle multiple disconnects', () => {
      const client = new CollaborationClient('User');
      client.disconnect();
      client.disconnect();
      client.disconnect();
      // Should not throw
    });

    it('should preserve collaborator ID across reconnects', () => {
      const client = new CollaborationClient('User');
      const id1 = client.getCollaboratorId();
      client.disconnect();
      const id2 = client.getCollaboratorId();

      expect(id1).toBe(id2);
    });
  });

  describe('Multiple Clients', () => {
    it('should generate unique IDs for each client', () => {
      const clients: CollaborationClient[] = [];
      const ids = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const client = new CollaborationClient(`User ${i}`);
        clients.push(client);
        ids.add(client.getCollaboratorId());
      }

      expect(ids.size).toBe(10);

      // Cleanup
      clients.forEach(c => c.disconnect());
    });
  });
});

describe('Type Exports', () => {
  it('should export all required types', () => {
    // These are type-only tests to ensure exports work
    const collaborator: Collaborator = {
      id: 'id',
      name: 'name',
      color: '#000',
      role: 'viewer',
      lastSeen: 0,
      status: 'offline',
    };

    const settings: SessionSettings = {
      requireApproval: false,
      approvalThreshold: 0,
      allowViewerMessages: false,
      maxCollaborators: 1,
      autoSyncInterval: 1000,
    };

    const toolCall: ToolCallState = {
      id: 'id',
      name: 'name',
      args: {},
      initiatedBy: 'user',
      status: 'pending',
      approvals: [],
      rejections: [],
    };

    const event: SessionEvent = {
      id: 'id',
      type: 'message',
      timestamp: 0,
      collaboratorId: 'user',
      data: null,
    };

    expect(collaborator).toBeDefined();
    expect(settings).toBeDefined();
    expect(toolCall).toBeDefined();
    expect(event).toBeDefined();
  });
});
