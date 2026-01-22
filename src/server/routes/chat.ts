/**
 * Chat Routes
 *
 * Handles chat completion API endpoints.
 */

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { requireScope, asyncHandler, ApiServerError, validateRequired } from '../middleware/index.js';
import type { ChatRequest, ChatResponse, ChatStreamChunk } from '../types.js';

// Agent interface for server routes (subset of CodeBuddyAgent methods used)
interface AgentAPI {
  processUserInput(input: string, options?: Record<string, unknown>): Promise<{
    content?: string;
    finishReason?: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    toolCalls?: Array<{ name: string; id: string; success?: boolean; output?: string; error?: string; executionTime?: number }>;
    cost?: number;
  }>;
  streamResponse(input: string, options?: Record<string, unknown>): AsyncIterable<{
    choices?: Array<{ delta?: { content?: string } }>;
  }>;
  getModel(): string;
}

// Lazy load the agent
let agentInstance: AgentAPI | null = null;
async function getAgent(): Promise<AgentAPI> {
  if (!agentInstance) {
    const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
    agentInstance = new CodeBuddyAgent(
      process.env.GROK_API_KEY || '',
      process.env.GROK_BASE_URL,
      process.env.GROK_MODEL || 'grok-3-latest'
    ) as unknown as AgentAPI;
  }
  return agentInstance!;
}

const router = Router();

/**
 * POST /api/chat
 * Send a chat message and get a response
 */
router.post(
  '/',
  requireScope('chat'),
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body as ChatRequest;

    // Validate required fields
    validateRequired(body, ['messages']);

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw ApiServerError.badRequest('Messages must be a non-empty array');
    }

    // Validate each message structure
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (!msg || typeof msg !== 'object') {
        throw ApiServerError.badRequest(`Message at index ${i} must be an object`);
      }
      if (!msg.role || typeof msg.role !== 'string') {
        throw ApiServerError.badRequest(`Message at index ${i} must have a valid 'role' field`);
      }
      if (!['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
        throw ApiServerError.badRequest(`Message at index ${i} has invalid role '${msg.role}'. Must be one of: system, user, assistant, tool`);
      }
      if (msg.content !== undefined && msg.content !== null && typeof msg.content !== 'string') {
        throw ApiServerError.badRequest(`Message at index ${i} has invalid content type. Must be a string or null`);
      }
    }

    // Validate optional parameters
    if (body.model !== undefined && (typeof body.model !== 'string' || body.model.trim().length === 0)) {
      throw ApiServerError.badRequest('Model must be a non-empty string if provided');
    }
    if (body.temperature !== undefined) {
      const temp = Number(body.temperature);
      if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
        throw ApiServerError.badRequest('Temperature must be a number between 0 and 2');
      }
    }
    if (body.maxTokens !== undefined) {
      const maxTok = Number(body.maxTokens);
      if (!Number.isInteger(maxTok) || maxTok < 1 || maxTok > 200000) {
        throw ApiServerError.badRequest('maxTokens must be an integer between 1 and 200000');
      }
    }

    // Check for streaming
    if (body.stream) {
      // Require stream scope for streaming
      if (!req.auth?.scopes.includes('chat:stream') && !req.auth?.scopes.includes('admin')) {
        throw ApiServerError.forbidden('Streaming requires chat:stream scope');
      }

      return handleStreamingChat(req, res, body, startTime);
    }

    // Non-streaming response
    const agent = await getAgent();
    const requestId = randomBytes(8).toString('hex');

    try {
      // Process messages
      const messages = body.messages as ChatCompletionMessageParam[];

      // Add system prompt if provided
      if (body.systemPrompt && messages[0]?.role !== 'system') {
        messages.unshift({
          role: 'system',
          content: body.systemPrompt,
        });
      }

      // Get completion
      const result = await agent.processUserInput(
        messages[messages.length - 1].content as string,
        {
          model: body.model,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          enableTools: body.tools,
        }
      );

      const response: ChatResponse = {
        id: requestId,
        content: result.content || '',
        model: body.model || agent.getModel(),
        finishReason: (result.finishReason as ChatResponse['finishReason']) || 'stop',
        usage: {
          promptTokens: result.usage?.prompt_tokens || 0,
          completionTokens: result.usage?.completion_tokens || 0,
          totalTokens: result.usage?.total_tokens || 0,
        },
        toolCalls: result.toolCalls?.map((tc: { name: string; id: string; success?: boolean; output?: string; error?: string; executionTime?: number }) => ({
          name: tc.name,
          callId: tc.id,
          success: tc.success ?? true,
          output: tc.output,
          error: tc.error,
          executionTime: tc.executionTime || 0,
        })),
        sessionId: body.sessionId,
        cost: result.cost,
        latency: Date.now() - startTime,
      };

      res.json(response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw ApiServerError.internal(message);
    }
  })
);

/**
 * Handle streaming chat response
 */
async function handleStreamingChat(
  req: Request,
  res: Response,
  body: ChatRequest,
  _startTime: number
): Promise<void> {
  const requestId = randomBytes(8).toString('hex');

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Request-ID', requestId);

  // Handle client disconnect
  let isConnected = true;
  req.on('close', () => {
    isConnected = false;
  });

  try {
    const agent = await getAgent();
    const messages = body.messages as ChatCompletionMessageParam[];

    // Add system prompt if provided
    if (body.systemPrompt && messages[0]?.role !== 'system') {
      messages.unshift({
        role: 'system',
        content: body.systemPrompt,
      });
    }

    // Stream the response
    let _totalContent = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const stream = await agent.streamResponse(
      messages[messages.length - 1].content as string,
      {
        model: body.model,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      }
    );

    for await (const chunk of stream) {
      if (!isConnected) break;

      const delta = chunk.choices?.[0]?.delta?.content || '';
      _totalContent += delta;

      const streamChunk: ChatStreamChunk = {
        id: requestId,
        delta,
        done: false,
      };

      res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
    }

    // Send final chunk
    if (isConnected) {
      const finalChunk: ChatStreamChunk = {
        id: requestId,
        delta: '',
        done: true,
        finishReason: 'stop',
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        },
      };

      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
    }

    res.end();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown stream error';
    const errorChunk = {
      id: requestId,
      delta: '',
      done: true,
      error: {
        code: 'STREAM_ERROR',
        message,
      },
    };

    res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    res.end();
  }
}

/**
 * POST /api/chat/completions
 * OpenAI-compatible chat completions endpoint
 */
router.post(
  '/completions',
  requireScope('chat'),
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body;

    // Validate required fields (OpenAI format)
    validateRequired(body, ['messages']);

    // Convert to our format
    const chatRequest: ChatRequest = {
      messages: body.messages,
      model: body.model,
      temperature: body.temperature,
      maxTokens: body.max_tokens,
      stream: body.stream,
    };

    if (body.stream) {
      return handleStreamingChat(req, res, chatRequest, startTime);
    }

    const agent = await getAgent();
    const requestId = `chatcmpl-${randomBytes(12).toString('hex')}`;

    const messages = body.messages as ChatCompletionMessageParam[];
    const lastMessage = messages[messages.length - 1];

    const result = await agent.processUserInput(
      lastMessage.content as string,
      {
        model: body.model,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
      }
    );

    // Return OpenAI-compatible response
    const response = {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || agent.getModel(),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.content || '',
          },
          finish_reason: result.finishReason || 'stop',
        },
      ],
      usage: {
        prompt_tokens: result.usage?.prompt_tokens || 0,
        completion_tokens: result.usage?.completion_tokens || 0,
        total_tokens: result.usage?.total_tokens || 0,
      },
    };

    res.json(response);
  })
);

/**
 * GET /api/chat/models
 * List available models
 */
router.get(
  '/models',
  requireScope('chat'),
  asyncHandler(async (req: Request, res: Response) => {
    const models = [
      {
        id: 'grok-3-latest',
        object: 'model',
        created: Date.now(),
        owned_by: 'xai',
      },
      {
        id: 'grok-3-fast',
        object: 'model',
        created: Date.now(),
        owned_by: 'xai',
      },
      {
        id: 'grok-2-latest',
        object: 'model',
        created: Date.now(),
        owned_by: 'xai',
      },
    ];

    res.json({
      object: 'list',
      data: models,
    });
  })
);

export default router;
