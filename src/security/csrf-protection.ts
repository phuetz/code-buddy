/**
 * CSRF Protection Module
 *
 * Provides CSRF (Cross-Site Request Forgery) protection for web interfaces.
 * Used when Code Buddy exposes HTTP endpoints (REST API, webhooks, etc.)
 *
 * Features:
 * - Token generation and validation
 * - Double-submit cookie pattern
 * - SameSite cookie configuration
 * - Token rotation
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';

export interface CSRFConfig {
  /** Token length in bytes (default: 32) */
  tokenLength?: number;
  /** Token expiry in milliseconds (default: 1 hour) */
  tokenExpiry?: number;
  /** Cookie name for CSRF token */
  cookieName?: string;
  /** Header name for CSRF token */
  headerName?: string;
  /** Enable double-submit cookie pattern */
  doubleSubmit?: boolean;
  /** SameSite cookie attribute */
  sameSite?: 'strict' | 'lax' | 'none';
  /** Secure cookie (HTTPS only) */
  secure?: boolean;
}

export interface CSRFToken {
  token: string;
  createdAt: Date;
  expiresAt: Date;
  sessionId?: string;
}

export interface CSRFValidationResult {
  valid: boolean;
  error?: string;
  token?: CSRFToken;
}

const DEFAULT_CONFIG: Required<CSRFConfig> = {
  tokenLength: 32,
  tokenExpiry: 3600000, // 1 hour
  cookieName: '_csrf',
  headerName: 'X-CSRF-Token',
  doubleSubmit: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
};

/**
 * CSRF Protection Manager
 */
export class CSRFProtection extends EventEmitter {
  private config: Required<CSRFConfig>;
  private tokens: Map<string, CSRFToken> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: CSRFConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Generate a new CSRF token
   */
  generateToken(sessionId?: string): CSRFToken {
    const token = crypto.randomBytes(this.config.tokenLength).toString('hex');
    const now = new Date();

    const csrfToken: CSRFToken = {
      token,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.tokenExpiry),
      sessionId,
    };

    this.tokens.set(token, csrfToken);
    this.emit('token-generated', { token: token.slice(0, 8) + '...', sessionId });

    return csrfToken;
  }

  /**
   * Validate a CSRF token
   */
  validateToken(
    token: string,
    options: { sessionId?: string; cookieToken?: string } = {}
  ): CSRFValidationResult {
    // Check if token exists
    const storedToken = this.tokens.get(token);

    if (!storedToken) {
      this.emit('validation-failed', { reason: 'token-not-found' });
      return { valid: false, error: 'Invalid CSRF token' };
    }

    // Check expiry
    if (new Date() > storedToken.expiresAt) {
      this.tokens.delete(token);
      this.emit('validation-failed', { reason: 'token-expired' });
      return { valid: false, error: 'CSRF token expired' };
    }

    // Check session binding if provided
    if (options.sessionId && storedToken.sessionId !== options.sessionId) {
      this.emit('validation-failed', { reason: 'session-mismatch' });
      return { valid: false, error: 'CSRF token session mismatch' };
    }

    // Double-submit cookie validation
    if (this.config.doubleSubmit && options.cookieToken) {
      if (token !== options.cookieToken) {
        this.emit('validation-failed', { reason: 'cookie-mismatch' });
        return { valid: false, error: 'CSRF cookie token mismatch' };
      }
    }

    this.emit('validation-success', { token: token.slice(0, 8) + '...' });
    return { valid: true, token: storedToken };
  }

  /**
   * Rotate a token (invalidate old, generate new)
   */
  rotateToken(oldToken: string, sessionId?: string): CSRFToken | null {
    const validation = this.validateToken(oldToken, { sessionId });

    if (!validation.valid) {
      return null;
    }

    // Invalidate old token
    this.tokens.delete(oldToken);

    // Generate new token
    return this.generateToken(sessionId);
  }

  /**
   * Invalidate a specific token
   */
  invalidateToken(token: string): boolean {
    return this.tokens.delete(token);
  }

  /**
   * Invalidate all tokens for a session
   */
  invalidateSession(sessionId: string): number {
    let count = 0;
    for (const [token, csrfToken] of this.tokens) {
      if (csrfToken.sessionId === sessionId) {
        this.tokens.delete(token);
        count++;
      }
    }
    return count;
  }

  /**
   * Get cookie options for setting CSRF cookie
   */
  getCookieOptions(): {
    name: string;
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'strict' | 'lax' | 'none';
      maxAge: number;
      path: string;
    };
  } {
    return {
      name: this.config.cookieName,
      options: {
        httpOnly: false, // Must be readable by JavaScript for double-submit
        secure: this.config.secure,
        sameSite: this.config.sameSite,
        maxAge: this.config.tokenExpiry,
        path: '/',
      },
    };
  }

  /**
   * Get header name for CSRF token
   */
  getHeaderName(): string {
    return this.config.headerName;
  }

  /**
   * Express/Connect middleware for CSRF protection
   */
  middleware(): (
    req: CSRFRequest,
    res: CSRFResponse,
    next: (err?: Error) => void
  ) => void {
    return (req, res, next) => {
      // Skip safe methods
      const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
      if (safeMethods.includes(req.method?.toUpperCase() || '')) {
        // Generate token for safe methods if not present
        if (!req.cookies?.[this.config.cookieName]) {
          const csrfToken = this.generateToken(req.sessionID);
          const cookieOpts = this.getCookieOptions();
          res.cookie(cookieOpts.name, csrfToken.token, cookieOpts.options);
          req.csrfToken = () => csrfToken.token;
        } else {
          const cookieToken = req.cookies?.[this.config.cookieName] || '';
          req.csrfToken = () => cookieToken;
        }
        return next();
      }

      // Validate token for unsafe methods
      const headerToken = req.headers[this.config.headerName.toLowerCase()] as string;
      const bodyToken = req.body?._csrf;
      const queryToken = req.query?._csrf as string;
      const cookieToken = req.cookies?.[this.config.cookieName];

      const token = headerToken || bodyToken || queryToken;

      if (!token) {
        return next(new Error('CSRF token missing'));
      }

      const validation = this.validateToken(token, {
        sessionId: req.sessionID,
        cookieToken,
      });

      if (!validation.valid) {
        return next(new Error(validation.error || 'Invalid CSRF token'));
      }

      // Attach token function to request
      req.csrfToken = () => token;

      next();
    };
  }

  /**
   * Generate HTML meta tag for CSRF token
   */
  getMetaTag(token: string): string {
    return `<meta name="csrf-token" content="${this.escapeHtml(token)}">`;
  }

  /**
   * Generate hidden form field for CSRF token
   */
  getFormField(token: string): string {
    return `<input type="hidden" name="_csrf" value="${this.escapeHtml(token)}">`;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(str: string): string {
    const htmlEscapes: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return str.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
  }

  /**
   * Start cleanup interval for expired tokens
   */
  private startCleanup(): void {
    // Cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 300000);

    // Don't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Clean up expired tokens
   */
  cleanup(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [token, csrfToken] of this.tokens) {
      if (now > csrfToken.expiresAt) {
        this.tokens.delete(token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.emit('cleanup', { cleaned });
    }

    return cleaned;
  }

  /**
   * Get statistics
   */
  getStats(): { activeTokens: number; oldestToken?: Date; newestToken?: Date } {
    let oldestToken: Date | undefined;
    let newestToken: Date | undefined;

    for (const csrfToken of this.tokens.values()) {
      if (!oldestToken || csrfToken.createdAt < oldestToken) {
        oldestToken = csrfToken.createdAt;
      }
      if (!newestToken || csrfToken.createdAt > newestToken) {
        newestToken = csrfToken.createdAt;
      }
    }

    return {
      activeTokens: this.tokens.size,
      oldestToken,
      newestToken,
    };
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.tokens.clear();
    this.removeAllListeners();
  }
}

// Types for Express-like request/response
interface CSRFRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  body?: Record<string, string>;
  query?: Record<string, string | string[]>;
  sessionID?: string;
  csrfToken?: () => string;
}

interface CSRFResponse {
  cookie: (
    name: string,
    value: string,
    options: Record<string, unknown>
  ) => void;
}

// Singleton instance
let csrfInstance: CSRFProtection | null = null;

/**
 * Get the CSRF protection instance
 */
export function getCSRFProtection(config?: CSRFConfig): CSRFProtection {
  if (!csrfInstance) {
    csrfInstance = new CSRFProtection(config);
  }
  return csrfInstance;
}

/**
 * Reset the CSRF protection instance
 */
export function resetCSRFProtection(): void {
  if (csrfInstance) {
    csrfInstance.dispose();
  }
  csrfInstance = null;
}

export default CSRFProtection;
