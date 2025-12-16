/**
 * JSON-RPC Server Tests
 *
 * Tests for the JSON-RPC integration server
 */

import { Readable, Writable } from 'stream';
import {
  createRequest,
  createResponse,
  createErrorResponse,
  isRequest,
  isNotification,
  ErrorCodes,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../../src/integrations/json-rpc/protocol.js';

describe('JSON-RPC Protocol', () => {
  describe('createRequest', () => {
    it('should create a valid JSON-RPC request', () => {
      const request = createRequest(1, 'initialize', {
        clientName: 'test',
        clientVersion: '1.0',
      });

      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBe(1);
      expect(request.method).toBe('initialize');
      expect(request.params).toEqual({
        clientName: 'test',
        clientVersion: '1.0',
      });
    });

    it('should create request with string id', () => {
      const request = createRequest('req-123', 'ai/complete', { prompt: 'test' });
      expect(request.id).toBe('req-123');
    });

    it('should create request without params', () => {
      const request = createRequest(1, 'tools/list', undefined);
      expect(request.params).toBeUndefined();
    });
  });

  describe('createResponse', () => {
    it('should create a success response', () => {
      const response = createResponse(1, { text: 'Hello' });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toEqual({ text: 'Hello' });
      expect(response.error).toBeUndefined();
    });

    it('should handle null result', () => {
      const response = createResponse(1, null);
      expect(response.result).toBeNull();
    });
  });

  describe('createErrorResponse', () => {
    it('should create an error response', () => {
      const response = createErrorResponse(
        1,
        ErrorCodes.METHOD_NOT_FOUND,
        'Method not found'
      );

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toEqual({
        code: ErrorCodes.METHOD_NOT_FOUND,
        message: 'Method not found',
      });
    });

    it('should include error data when provided', () => {
      const response = createErrorResponse(
        1,
        ErrorCodes.INVALID_PARAMS,
        'Invalid params',
        { field: 'prompt' }
      );

      expect(response.error?.data).toEqual({ field: 'prompt' });
    });
  });

  describe('isRequest', () => {
    it('should return true for valid request', () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };
      expect(isRequest(request)).toBe(true);
    });

    it('should return false for notification (no id)', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'test',
      };
      expect(isRequest(notification)).toBe(false);
    });

    it('should return false for response', () => {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      };
      expect(isRequest(response)).toBe(false);
    });

    it('should return false for invalid objects', () => {
      expect(isRequest(null)).toBe(false);
      expect(isRequest(undefined)).toBe(false);
      expect(isRequest({})).toBe(false);
      expect(isRequest({ jsonrpc: '1.0', id: 1, method: 'test' })).toBe(false);
    });
  });

  describe('isNotification', () => {
    it('should return true for notification', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'progress',
        params: { percent: 50 },
      };
      expect(isNotification(notification)).toBe(true);
    });

    it('should return false for request (has id)', () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };
      expect(isNotification(request)).toBe(false);
    });
  });

  describe('ErrorCodes', () => {
    it('should have standard JSON-RPC error codes', () => {
      expect(ErrorCodes.PARSE_ERROR).toBe(-32700);
      expect(ErrorCodes.INVALID_REQUEST).toBe(-32600);
      expect(ErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
      expect(ErrorCodes.INVALID_PARAMS).toBe(-32602);
      expect(ErrorCodes.INTERNAL_ERROR).toBe(-32603);
    });

    it('should have custom error codes in valid range', () => {
      // Custom codes should be between -32000 and -32099
      expect(ErrorCodes.NOT_INITIALIZED).toBe(-32001);
      expect(ErrorCodes.OPERATION_CANCELLED).toBe(-32002);
      expect(ErrorCodes.TIMEOUT).toBe(-32003);
      expect(ErrorCodes.FILE_NOT_FOUND).toBe(-32004);
      expect(ErrorCodes.PERMISSION_DENIED).toBe(-32005);
      expect(ErrorCodes.AI_ERROR).toBe(-32006);
      expect(ErrorCodes.TOOL_ERROR).toBe(-32007);
    });
  });
});

describe('JSON-RPC Server Integration', () => {
  // Mock stdin/stdout for testing (available for future integration tests)
  class _MockReadable extends Readable {
    private lines: string[] = [];
    private index = 0;

    addLine(line: string) {
      this.lines.push(line);
    }

    _read() {
      if (this.index < this.lines.length) {
        this.push(this.lines[this.index++] + '\n');
      } else {
        this.push(null);
      }
    }
  }

  class _MockWritable extends Writable {
    public output: string[] = [];

    _write(chunk: Buffer, encoding: string, callback: () => void) {
      this.output.push(chunk.toString());
      callback();
    }

    getResponses(): JsonRpcResponse[] {
      return this.output
        .join('')
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }
  }

  describe('Protocol Messages', () => {
    it('should serialize request correctly', () => {
      const request = createRequest(1, 'ai/complete', { prompt: 'Hello' });
      const json = JSON.stringify(request);
      const parsed = JSON.parse(json);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(1);
      expect(parsed.method).toBe('ai/complete');
      expect(parsed.params.prompt).toBe('Hello');
    });

    it('should serialize response correctly', () => {
      const response = createResponse(1, { text: 'World' });
      const json = JSON.stringify(response);
      const parsed = JSON.parse(json);

      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(1);
      expect(parsed.result.text).toBe('World');
    });

    it('should handle unicode in messages', () => {
      const request = createRequest(1, 'ai/complete', { prompt: '你好世界 🌍' });
      const json = JSON.stringify(request);
      const parsed = JSON.parse(json);

      expect(parsed.params.prompt).toBe('你好世界 🌍');
    });

    it('should handle large payloads', () => {
      const largeText = 'x'.repeat(100000);
      const request = createRequest(1, 'ai/complete', { prompt: largeText });
      const json = JSON.stringify(request);
      const parsed = JSON.parse(json);

      expect(parsed.params.prompt.length).toBe(100000);
    });
  });

  describe('Method Types', () => {
    it('should support all documented methods', () => {
      const methods = [
        'initialize',
        'shutdown',
        'ai/complete',
        'ai/chat',
        'ai/clearHistory',
        'tools/list',
        'tools/call',
        'fcs/execute',
        'fcs/parse',
        'context/add',
        'context/list',
        'context/clear',
        'git/status',
        'git/diff',
      ];

      // Just verify the method names are valid strings
      methods.forEach(method => {
        const request = createRequest(1, method as any, {});
        expect(request.method).toBe(method);
      });
    });
  });

  describe('Request/Response Matching', () => {
    it('should match response to request by id', () => {
      const requests = [
        createRequest(1, 'tools/list', undefined),
        createRequest(2, 'ai/complete', { prompt: 'test' }),
        createRequest('abc', 'context/list', undefined),
      ];

      const responses = [
        createResponse(2, { text: 'response 2' }),
        createResponse('abc', { files: [] }),
        createResponse(1, { tools: [] }),
      ];

      // Verify each request can find its matching response
      requests.forEach(req => {
        const matchingResponse = responses.find(res => res.id === req.id);
        expect(matchingResponse).toBeDefined();
      });
    });
  });
});

describe('Server Runner', () => {
  it('should export parseServerArgs function', async () => {
    const { parseServerArgs } = await import('../../src/integrations/server-runner.js');
    expect(typeof parseServerArgs).toBe('function');
  });

  it('should parse --json-rpc flag', async () => {
    const { parseServerArgs } = await import('../../src/integrations/server-runner.js');
    const options = parseServerArgs(['--json-rpc']);

    expect(options).not.toBeNull();
    expect(options?.mode).toBe('json-rpc');
  });

  it('should parse --mcp-server flag', async () => {
    const { parseServerArgs } = await import('../../src/integrations/server-runner.js');
    const options = parseServerArgs(['--mcp-server']);

    expect(options).not.toBeNull();
    expect(options?.mode).toBe('mcp');
  });

  it('should parse --server json-rpc', async () => {
    const { parseServerArgs } = await import('../../src/integrations/server-runner.js');
    const options = parseServerArgs(['--server', 'json-rpc']);

    expect(options).not.toBeNull();
    expect(options?.mode).toBe('json-rpc');
  });

  it('should parse --server mcp', async () => {
    const { parseServerArgs } = await import('../../src/integrations/server-runner.js');
    const options = parseServerArgs(['--server', 'mcp']);

    expect(options).not.toBeNull();
    expect(options?.mode).toBe('mcp');
  });

  it('should parse additional options', async () => {
    const { parseServerArgs } = await import('../../src/integrations/server-runner.js');
    const options = parseServerArgs([
      '--json-rpc',
      '--verbose',
      '--workdir', '/tmp/test',
      '--api-key', 'test-key',
    ]);

    expect(options).not.toBeNull();
    expect(options?.verbose).toBe(true);
    expect(options?.workdir).toBe('/tmp/test');
    expect(options?.apiKey).toBe('test-key');
  });

  it('should return null for non-server args', async () => {
    const { parseServerArgs } = await import('../../src/integrations/server-runner.js');
    const options = parseServerArgs(['--help']);

    expect(options).toBeNull();
  });

  it('should detect server mode', async () => {
    const { isServerMode } = await import('../../src/integrations/server-runner.js');

    expect(isServerMode(['--json-rpc'])).toBe(true);
    expect(isServerMode(['--mcp-server'])).toBe(true);
    expect(isServerMode(['--server', 'mcp'])).toBe(true);
    expect(isServerMode(['--help'])).toBe(false);
    expect(isServerMode([])).toBe(false);
  });
});
