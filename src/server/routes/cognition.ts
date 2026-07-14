import { Router, type Request } from 'express';
import {
  CognitiveHubError,
  type CognitiveHub,
  type CognitivePrincipal,
} from '../../cognition/cognitive-hub.js';
import { COGNITIVE_WIRE_VERSION } from '../../cognition/cognitive-wire-contract.js';
import { isDirectLoopbackRequest } from '../middleware/auth.js';

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

function principalOf(req: Request): CognitivePrincipal {
  const auth = req.auth;
  return {
    id: auth?.userId ?? auth?.keyId ?? `http:${req.socket.remoteAddress ?? 'unknown'}`,
    source: 'http-snapshot',
    scopes: auth?.scopes ?? [],
    loopback: isDirectLoopbackRequest(req.socket.remoteAddress, req.headers),
    secure: Boolean((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted),
  };
}

function statusFor(error: CognitiveHubError): number {
  switch (error.code) {
    case 'COGNITION_FORBIDDEN':
    case 'CORRELATION_FORBIDDEN':
    case 'LEASE_FORBIDDEN':
      return 403;
    case 'CORRELATION_NOT_FOUND':
    case 'LEASE_NOT_FOUND':
    case 'PARENT_NOT_FOUND':
      return 404;
    case 'CORRELATION_CANCELLED':
    case 'IDEMPOTENCY_CONFLICT':
      return 409;
    case 'WORKSPACE_REJECTED':
      return 422;
    case 'COGNITION_INVALID_REQUEST':
      return 400;
  }
}

export function createCognitionRoutes(hub: CognitiveHub): Router {
  const router = Router();

  /** Bounded recovery surface for subscribers after reconnect or cognition.gap. */
  router.get('/snapshot', (req, res) => {
    const afterRevision = firstQueryValue(req.query.afterRevision);
    const limit = firstQueryValue(req.query.limit);
    const kinds = firstQueryValue(req.query.kinds);
    const input = {
      version: COGNITIVE_WIRE_VERSION,
      ...(afterRevision !== undefined ? { afterRevision: Number(afterRevision) } : {}),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
      ...(kinds
        ? { kinds: kinds.split(',').map((kind) => kind.trim()).filter(Boolean) }
        : {}),
    };
    try {
      res.json(hub.snapshot(principalOf(req), input));
    } catch (error) {
      if (error instanceof CognitiveHubError) {
        res.status(statusFor(error)).json({
          error: { code: error.code, message: error.message },
          version: COGNITIVE_WIRE_VERSION,
          serverEpoch: hub.serverEpoch,
        });
        return;
      }
      throw error;
    }
  });

  return router;
}
