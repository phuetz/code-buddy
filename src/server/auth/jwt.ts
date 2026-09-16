/**
 * JWT Token Management
 *
 * Handles JWT token generation and validation.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { JwtPayload, ApiScope } from '../types.js';

// Base64URL encoding/decoding
function base64UrlEncode(data: string | Buffer): string {
  const base64 = Buffer.from(data).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  const padded = padding ? base64 + '='.repeat(4 - padding) : base64;
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Create HMAC signature
 */
function createSignature(data: string, secret: string): string {
  return base64UrlEncode(
    createHmac('sha256', secret).update(data).digest()
  );
}

/**
 * Generate a JWT token
 */
export function generateToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresIn: string = '24h'
): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + parseExpiration(expiresIn);

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload));

  const signature = createSignature(
    `${headerEncoded}.${payloadEncoded}`,
    secret
  );

  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerEncoded, payloadEncoded, signatureProvided] = parts;
    if (
      headerEncoded === undefined ||
      payloadEncoded === undefined ||
      signatureProvided === undefined
    ) {
      return null;
    }

    // Verify signature
    const expectedSignature = createSignature(
      `${headerEncoded}.${payloadEncoded}`,
      secret
    );

    // Use timing-safe comparison
    const sig1 = Buffer.from(signatureProvided);
    const sig2 = Buffer.from(expectedSignature);

    if (sig1.length !== sig2.length || !timingSafeEqual(sig1, sig2)) {
      return null;
    }

    // Decode payload
    const payload: JwtPayload = JSON.parse(base64UrlDecode(payloadEncoded));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Parse expiration string to seconds
 */
function parseExpiration(exp: string): number {
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return 24 * 60 * 60; // Default 24 hours
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 24 * 60 * 60;
    default:
      return 24 * 60 * 60;
  }
}

/**
 * Decode token without verification (for debugging)
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payloadEncoded = parts[1];
    if (payloadEncoded === undefined) {
      return null;
    }

    return JSON.parse(base64UrlDecode(payloadEncoded));
  } catch {
    return null;
  }
}

/**
 * Check if token is expired
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now;
}

/**
 * Get time until token expires (in seconds)
 */
export function getTokenTTL(token: string): number {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) {
    return 0;
  }

  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, payload.exp - now);
}

/**
 * Refresh a token (generate new one with same payload)
 */
export function refreshToken(
  token: string,
  secret: string,
  expiresIn: string = '24h'
): string | null {
  const payload = verifyToken(token, secret);
  if (!payload) {
    return null;
  }

  // Device tokens require a fresh key proof after one hour. In particular,
  // never turn them into legacy tokens that lose the revocation marker.
  if (Array.isArray(payload.amr) && payload.amr.includes('device')) return null;

  return generateToken(
    {
      sub: payload.sub,
      scopes: payload.scopes,
      type: payload.type,
    },
    secret,
    expiresIn
  );
}

/**
 * Create access token from API key
 */
export function createAccessToken(
  keyId: string,
  scopes: ApiScope[],
  secret: string,
  expiresIn: string = '1h'
): string {
  return generateToken(
    {
      sub: keyId,
      scopes,
      type: 'api_key',
    },
    secret,
    expiresIn
  );
}

/**
 * Create user token
 */
export function createUserToken(
  userId: string,
  scopes: ApiScope[],
  secret: string,
  expiresIn: string = '24h'
): string {
  return generateToken(
    {
      sub: userId,
      scopes,
      type: 'user',
    },
    secret,
    expiresIn
  );
}
