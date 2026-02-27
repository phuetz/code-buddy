/**
 * Sessions Routes
 *
 * Handles session management API endpoints.
 */

import { Router, Request, Response } from 'express';
import { requireScope, asyncHandler, ApiServerError, validateRequired } from '../middleware/index.js';
import type { SessionInfo, SessionListResponse } from '../types.js';

// Session interface for server routes
interface SessionData {
  id: string;
  name: string;
  description?: string;
  createdAt: Date | string;
  updatedAt?: Date | string;
  messages?: Array<{ role: string; content: string; timestamp?: string; metadata?: unknown }>;
  tokenCount?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}

interface SessionStoreAPI {
  listSessions(): Promise<SessionData[]>;
  loadSession(id: string): Promise<SessionData | null>;
  createSession(data: Record<string, unknown>): Promise<SessionData>;
  updateSession(id: string, data: Record<string, unknown>): Promise<SessionData>;
  deleteSession(id: string): Promise<void>;
  addMessage(id: string, message: Record<string, unknown>): Promise<void>;
}

// Lazy load the session store
let sessionStoreInstance: SessionStoreAPI | null = null;
async function getSessionStore(): Promise<SessionStoreAPI> {
  if (!sessionStoreInstance) {
    const { SessionStore } = await import('../../persistence/session-store.js');
    sessionStoreInstance = new SessionStore() as unknown as SessionStoreAPI;
  }
  return sessionStoreInstance!;
}

const router = Router();

// Helper to extract string param (Express params can be string | string[])
function getStringParam(param: string | string[] | undefined): string {
  return Array.isArray(param) ? param[0] : param || '';
}

/**
 * GET /api/sessions
 * List all sessions
 */
router.get(
  '/',
  requireScope('sessions'),
  asyncHandler(async (req: Request, res: Response) => {
    const store = await getSessionStore();
    const { limit = 50, offset = 0, search } = req.query;

    // Validate pagination parameters
    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw ApiServerError.badRequest('Limit must be an integer between 1 and 1000');
    }
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      throw ApiServerError.badRequest('Offset must be a non-negative integer');
    }

    // Validate search parameter if provided
    if (search !== undefined && search !== null && typeof search !== 'string') {
      throw ApiServerError.badRequest('Search must be a string');
    }
    if (typeof search === 'string' && search.length > 500) {
      throw ApiServerError.badRequest('Search query must not exceed 500 characters');
    }

    const allSessions = await store.listSessions();
    let sessions = allSessions;

    // Apply search filter if provided
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      sessions = sessions.filter((s: SessionData) =>
        s.name?.toLowerCase().includes(searchLower) ||
        s.description?.toLowerCase().includes(searchLower) ||
        s.id?.toLowerCase().includes(searchLower)
      );
    }

    // Apply pagination
    const total = sessions.length;
    const paginatedSessions = sessions.slice(
      parsedOffset,
      parsedOffset + parsedLimit
    );

    const sessionInfos: SessionInfo[] = paginatedSessions.map((s: SessionData) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages?.length || 0,
      tokenCount: s.tokenCount || 0,
      model: s.model,
    }));

    const response: SessionListResponse = {
      sessions: sessionInfos,
      total,
      limit: parsedLimit,
      offset: parsedOffset,
    };

    res.json(response);
  })
);

/**
 * GET /api/sessions/latest
 * Get the most recent session
 * NOTE: Must be registered before /:id to avoid route shadowing
 */
router.get(
  '/latest',
  requireScope('sessions'),
  asyncHandler(async (req: Request, res: Response) => {
    const store = await getSessionStore();
    const sessions = await store.listSessions();

    if (sessions.length === 0) {
      throw ApiServerError.notFound('No sessions found');
    }

    // Sort by updatedAt or createdAt
    const sorted = sessions.sort((a: SessionData, b: SessionData) => {
      const dateA = new Date(a.updatedAt || a.createdAt).getTime();
      const dateB = new Date(b.updatedAt || b.createdAt).getTime();
      return dateB - dateA;
    });

    const latest = sorted[0];

    res.json({
      id: latest.id,
      name: latest.name,
      description: latest.description,
      createdAt: latest.createdAt,
      updatedAt: latest.updatedAt,
      messageCount: latest.messages?.length || 0,
    });
  })
);

/**
 * GET /api/sessions/:id
 * Get session details
 */
router.get(
  '/:id',
  requireScope('sessions'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = getStringParam(req.params.id);
    const store = await getSessionStore();

    const session = await store.loadSession(id);
    if (!session) {
      throw ApiServerError.notFound(`Session '${id}'`);
    }

    res.json({
      id: session.id,
      name: session.name,
      description: session.description,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      model: session.model,
      messages: session.messages,
      messageCount: session.messages?.length || 0,
      tokenCount: session.tokenCount || 0,
      metadata: session.metadata,
    });
  })
);

/**
 * POST /api/sessions
 * Create a new session
 */
router.post(
  '/',
  requireScope('sessions:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const store = await getSessionStore();
    const { name, description, model, metadata } = req.body;

    // Validate optional fields
    if (name !== undefined && name !== null) {
      if (typeof name !== 'string') {
        throw ApiServerError.badRequest('Session name must be a string');
      }
      if (name.length > 200) {
        throw ApiServerError.badRequest('Session name must not exceed 200 characters');
      }
    }
    if (description !== undefined && description !== null) {
      if (typeof description !== 'string') {
        throw ApiServerError.badRequest('Session description must be a string');
      }
      if (description.length > 2000) {
        throw ApiServerError.badRequest('Session description must not exceed 2000 characters');
      }
    }
    if (model !== undefined && model !== null) {
      if (typeof model !== 'string' || model.trim().length === 0) {
        throw ApiServerError.badRequest('Model must be a non-empty string if provided');
      }
    }
    if (metadata !== undefined && metadata !== null) {
      if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw ApiServerError.badRequest('Metadata must be an object if provided');
      }
    }

    const session = await store.createSession({
      name: name || `Session ${Date.now()}`,
      description,
      model: model || process.env.GROK_MODEL || 'grok-3-latest',
      metadata,
    });

    res.status(201).json({
      id: session.id,
      name: session.name,
      description: session.description,
      createdAt: session.createdAt,
      model: session.model,
    });
  })
);

/**
 * PUT /api/sessions/:id
 * Update session metadata
 */
router.put(
  '/:id',
  requireScope('sessions:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = getStringParam(req.params.id);
    const store = await getSessionStore();

    const session = await store.loadSession(id);
    if (!session) {
      throw ApiServerError.notFound(`Session '${id}'`);
    }

    const { name, description, metadata } = req.body;

    const updated = await store.updateSession(id, {
      name: name ?? session.name,
      description: description ?? session.description,
      metadata: metadata ?? session.metadata,
    });

    res.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      updatedAt: updated.updatedAt,
    });
  })
);

/**
 * DELETE /api/sessions/:id
 * Delete a session
 */
router.delete(
  '/:id',
  requireScope('sessions:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = getStringParam(req.params.id);
    const store = await getSessionStore();

    const session = await store.loadSession(id);
    if (!session) {
      throw ApiServerError.notFound(`Session '${id}'`);
    }

    await store.deleteSession(id);

    res.status(204).send();
  })
);

/**
 * GET /api/sessions/:id/messages
 * Get messages for a session
 */
router.get(
  '/:id/messages',
  requireScope('sessions'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = getStringParam(req.params.id);
    const limitNum = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
    const offsetNum = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const store = await getSessionStore();

    const session = await store.loadSession(id);
    if (!session) {
      throw ApiServerError.notFound(`Session '${id}'`);
    }

    const messages = session.messages || [];
    const total = messages.length;
    const paginatedMessages = messages.slice(offsetNum, offsetNum + limitNum);

    res.json({
      messages: paginatedMessages,
      total,
      limit: limitNum,
      offset: offsetNum,
    });
  })
);

/**
 * POST /api/sessions/:id/messages
 * Add a message to a session
 */
router.post(
  '/:id/messages',
  requireScope('sessions:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = getStringParam(req.params.id);
    const store = await getSessionStore();

    const session = await store.loadSession(id);
    if (!session) {
      throw ApiServerError.notFound(`Session '${id}'`);
    }

    validateRequired(req.body, ['role', 'content']);
    const { role, content, metadata } = req.body;

    if (!['user', 'assistant', 'system'].includes(role)) {
      throw ApiServerError.badRequest('Role must be user, assistant, or system');
    }

    const message = {
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };

    await store.addMessage(id, message);

    res.status(201).json(message);
  })
);

/**
 * POST /api/sessions/:id/fork
 * Fork a session (create a copy)
 */
router.post(
  '/:id/fork',
  requireScope('sessions:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = getStringParam(req.params.id);
    const store = await getSessionStore();

    const session = await store.loadSession(id);
    if (!session) {
      throw ApiServerError.notFound(`Session '${id}'`);
    }

    const { name, description, fromMessage } = req.body;

    // Create a copy of the session
    let messages = session.messages || [];
    if (typeof fromMessage === 'number' && fromMessage >= 0) {
      messages = messages.slice(0, fromMessage + 1);
    }

    const forked = await store.createSession({
      name: name || `${session.name} (fork)`,
      description: description || `Forked from ${session.id}`,
      model: session.model,
      messages,
      metadata: {
        ...session.metadata,
        forkedFrom: session.id,
        forkedAt: new Date().toISOString(),
      },
    });

    res.status(201).json({
      id: forked.id,
      name: forked.name,
      description: forked.description,
      createdAt: forked.createdAt,
      messageCount: messages.length,
      forkedFrom: session.id,
    });
  })
);

/**
 * POST /api/sessions/:id/export
 * Export session data
 */
router.post(
  '/:id/export',
  requireScope('sessions'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = getStringParam(req.params.id);
    const { format = 'json' } = req.body;
    const store = await getSessionStore();

    const session = await store.loadSession(id);
    if (!session) {
      throw ApiServerError.notFound(`Session '${id}'`);
    }

    if (format === 'markdown') {
      // Export as markdown
      let markdown = `# ${session.name || 'Session'}\n\n`;
      markdown += `**Created:** ${session.createdAt}\n`;
      markdown += `**Model:** ${session.model}\n\n`;
      markdown += `---\n\n`;

      for (const msg of session.messages || []) {
        const role = msg.role === 'user' ? '**User**' : msg.role === 'assistant' ? '**Assistant**' : '**System**';
        markdown += `${role}:\n\n${msg.content}\n\n---\n\n`;
      }

      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${id}.md"`);
      res.send(markdown);
    } else {
      // Export as JSON
      res.setHeader('Content-Disposition', `attachment; filename="${id}.json"`);
      res.json(session);
    }
  })
);

export default router;
