/**
 * Error Handling Middleware
 *
 * Centralized error handling for the API server.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { randomBytes } from 'crypto';
import type { ApiError } from '../types.js';
import { API_ERRORS } from '../types.js';
import { logger } from '../../utils/logger.js';

/**
 * Custom API Error class
 */
export class ApiServerError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    status: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiServerError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static badRequest(message: string, details?: Record<string, unknown>): ApiServerError {
    return new ApiServerError(message, 'VALIDATION_ERROR', 400, details);
  }

  static unauthorized(message: string = 'Authentication required'): ApiServerError {
    return new ApiServerError(message, 'UNAUTHORIZED', 401);
  }

  static forbidden(message: string = 'Insufficient permissions'): ApiServerError {
    return new ApiServerError(message, 'FORBIDDEN', 403);
  }

  static notFound(resource: string = 'Resource'): ApiServerError {
    return new ApiServerError(`${resource} not found`, 'NOT_FOUND', 404);
  }

  static rateLimited(retryAfter: number): ApiServerError {
    return new ApiServerError(
      `Rate limit exceeded. Try again in ${retryAfter}s`,
      'RATE_LIMITED',
      429,
      { retryAfter }
    );
  }

  static internal(message: string = 'Internal server error'): ApiServerError {
    return new ApiServerError(message, 'INTERNAL_ERROR', 500);
  }

  static serviceUnavailable(message: string = 'Service temporarily unavailable'): ApiServerError {
    return new ApiServerError(message, 'SERVICE_UNAVAILABLE', 503);
  }

  toJSON(): ApiError {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
    };
  }
}

/**
 * Generate request ID
 */
export function generateRequestId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Request ID middleware
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string || generateRequestId();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

/**
 * Not found handler (404)
 */
export function notFoundHandler(req: Request, res: Response) {
  const error: ApiError = {
    ...API_ERRORS.NOT_FOUND,
    message: `Endpoint not found: ${req.method} ${req.path}`,
    requestId: req.headers['x-request-id'] as string,
  };

  res.status(404).json(error);
}

/**
 * Global error handler
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error | ApiServerError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Log error
  const requestId = req.headers['x-request-id'] as string;
  logger.error(`[${requestId}] API Error`, err instanceof Error ? err : new Error(String(err)), { requestId });

  // Handle ApiServerError
  if (err instanceof ApiServerError) {
    const response: ApiError = {
      ...err.toJSON(),
      requestId,
    };
    return res.status(err.status).json(response);
  }

  // Handle validation errors (e.g., from express-validator or Joi)
  if (err.name === 'ValidationError') {
    const response: ApiError = {
      code: 'VALIDATION_ERROR',
      message: err.message,
      status: 400,
      requestId,
    };
    return res.status(400).json(response);
  }

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    const response: ApiError = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid JSON in request body',
      status: 400,
      requestId,
    };
    return res.status(400).json(response);
  }

  // Handle unknown errors
  const response: ApiError = {
    code: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
    status: 500,
    requestId,
    details: process.env.NODE_ENV === 'production'
      ? undefined
      : { stack: err.stack },
  };

  return res.status(500).json(response);
};

/**
 * Async handler wrapper (catches async errors)
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validate required fields in request body
 */
export function validateRequired<T extends object>(
  body: T,
  fields: (keyof T | string)[]
): void {
  const missing = fields.filter((field) => {
    const key = field as string;
    return !(key in body) || (body as Record<string, unknown>)[key] === undefined;
  });

  if (missing.length > 0) {
    throw ApiServerError.badRequest(
      `Missing required field(s): ${(missing as string[]).join(', ')}`,
      { missingFields: missing }
    );
  }
}

/**
 * Validate field types
 */
export function validateTypes(
  body: Record<string, unknown>,
  schema: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>
): void {
  const errors: string[] = [];

  for (const [field, expectedType] of Object.entries(schema)) {
    if (!(field in body)) continue;

    const value = body[field];
    let actualType = typeof value;

    if (expectedType === 'array' && !Array.isArray(value)) {
      errors.push(`${field} must be an array`);
    } else if (expectedType !== 'array' && actualType !== expectedType) {
      errors.push(`${field} must be a ${expectedType}`);
    }
  }

  if (errors.length > 0) {
    throw ApiServerError.badRequest(errors.join('; '), { errors });
  }
}
