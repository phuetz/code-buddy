import {
  CodeBuddyError,
  ToolExecutionError,
  ApiError,
  RateLimitError,
  AuthenticationError,
  ContextLimitExceededError,
  getErrorMessage,
  isCodeBuddyError,
  wrapError,
} from '../../src/errors/index';

describe('Error Handling', () => {
  describe('CodeBuddyError', () => {
    it('should create base error with correct properties', () => {
      const error = new CodeBuddyError('TEST_ERROR', 'Test message', {
        context: { detail: 'info' },
        isOperational: false,
      });

      expect(error.code).toBe('TEST_ERROR');
      expect(error.message).toBe('Test message');
      expect(error.context).toEqual({ detail: 'info' });
      expect(error.isOperational).toBe(false);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should default to operational error', () => {
      const error = new CodeBuddyError('TEST', 'Test');
      expect(error.isOperational).toBe(true);
    });

    it('should serialize to JSON', () => {
      const error = new CodeBuddyError('TEST', 'Test');
      const json = error.toJSON();
      expect(json.code).toBe('TEST');
      expect(json.message).toBe('Test');
      expect(json.name).toBe('CodeBuddyError');
    });
  });

  describe('Specific Errors', () => {
    it('ToolExecutionError should hold tool name and args', () => {
      const error = new ToolExecutionError('grep', 'Command failed', { args: { pattern: 'test' } });
      expect(error.toolName).toBe('grep');
      expect(error.args).toEqual({ pattern: 'test' });
      expect(error.code).toBe('TOOL_EXECUTION_ERROR');
    });

    it('ApiError should hold status code', () => {
      const error = new ApiError('Not found', { statusCode: 404 });
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('API_ERROR');
    });

    it('RateLimitError should have correct code', () => {
      const error = new RateLimitError(60);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.retryAfter).toBe(60);
    });

    it('AuthenticationError should have correct code', () => {
      const error = new AuthenticationError();
      expect(error.code).toBe('AUTHENTICATION_FAILED');
      expect(error.statusCode).toBe(401);
    });

    it('ContextLimitExceededError should calculate overflow', () => {
      const error = new ContextLimitExceededError(5000, 4000);
      expect(error.currentTokens).toBe(5000);
      expect(error.maxTokens).toBe(4000);
      expect(error.overflow).toBe(1000);
    });
  });

  describe('Utilities', () => {
    it('getErrorMessage should handle various inputs', () => {
      expect(getErrorMessage(new Error('test'))).toBe('test');
      expect(getErrorMessage('string error')).toBe('string error');
      expect(getErrorMessage({ message: 'obj' })).toBe('[object Object]');
    });

    it('isCodeBuddyError should identify instances', () => {
      expect(isCodeBuddyError(new CodeBuddyError('TEST', 'test'))).toBe(true);
      expect(isCodeBuddyError(new Error('test'))).toBe(false);
    });

    it('wrapError should convert unknown errors', () => {
      const error = new Error('native error');
      const wrapped = wrapError(error);
      expect(wrapped).toBeInstanceOf(CodeBuddyError);
      expect(wrapped.message).toBe('native error');
      expect(wrapped.cause).toBe(error);
    });

    it('wrapError should return existing CodeBuddyError as is', () => {
      const original = new CodeBuddyError('TEST', 'test');
      const wrapped = wrapError(original);
      expect(wrapped).toBe(original);
    });
  });
});
