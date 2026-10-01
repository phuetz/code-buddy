import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/server/middleware/error-handler.js';
import { logger } from '../../src/utils/logger.js';

describe('body-parser error mapping without a network listener', () => {
  afterEach(() => vi.restoreAllMocks());

  function handle(error: Error) {
    const req = {
      headers: { 'x-request-id': 'request-123' },
      app: { get: () => true },
    } as unknown as Request;
    const response: { status?: number; body?: Record<string, unknown> } = {};
    const res = {
      status: vi.fn((status: number) => {
        response.status = status;
        return res;
      }),
      json: vi.fn((body: Record<string, unknown>) => {
        response.body = body;
        return res;
      }),
    } as unknown as Response;
    errorHandler(error, req, res, vi.fn() as NextFunction);
    return response;
  }

  it('maps a body-parser entity limit to 413 without exposing its message', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('request entity too large: internal detail'), {
      status: 413, type: 'entity.too.large', expose: true,
    });
    expect(handle(error)).toEqual({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', status: 413, requestId: 'request-123' },
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([
    [415, 'charset.unsupported', 'UNSUPPORTED_MEDIA_TYPE'],
    [400, 'request.aborted', 'VALIDATION_ERROR'],
  ])('maps body-parser status %i', (status, type, code) => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const error = Object.assign(new Error('parser rejected request'), {
      status, type, expose: true,
    });
    expect(handle(error)).toMatchObject({ status, body: { code, status } });
  });

  it('preserves the existing invalid JSON response', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const error = Object.assign(new SyntaxError('Unexpected token'), { body: '{bad' });
    expect(handle(error)).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION_ERROR', message: 'Invalid JSON in request body' },
    });
  });

  it('keeps an ordinary error at 500', () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    expect(handle(new Error('internal'))).toMatchObject({
      status: 500,
      body: { code: 'INTERNAL_ERROR', status: 500, requestId: 'request-123' },
    });
    expect(logError).toHaveBeenCalledOnce();
  });
});
