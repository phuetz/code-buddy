/**
 * Unit tests for CSRF Protection Module
 */

import { CSRFProtection, getCSRFProtection, resetCSRFProtection } from '../../src/security/csrf-protection';

describe('CSRFProtection', () => {
  let csrf: CSRFProtection;

  beforeEach(() => {
    csrf = new CSRFProtection({
      tokenLength: 32,
      tokenExpiry: 3600000,
    });
  });

  afterEach(() => {
    csrf.dispose();
  });

  describe('generateToken', () => {
    it('should generate a valid token', () => {
      const token = csrf.generateToken();

      expect(token).toBeDefined();
      expect(token.token).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(token.createdAt).toBeInstanceOf(Date);
      expect(token.expiresAt).toBeInstanceOf(Date);
      expect(token.expiresAt.getTime()).toBeGreaterThan(token.createdAt.getTime());
    });

    it('should generate unique tokens', () => {
      const token1 = csrf.generateToken();
      const token2 = csrf.generateToken();

      expect(token1.token).not.toBe(token2.token);
    });

    it('should bind token to session if provided', () => {
      const sessionId = 'session123';
      const token = csrf.generateToken(sessionId);

      expect(token.sessionId).toBe(sessionId);
    });

    it('should emit token-generated event', () => {
      const handler = jest.fn();
      csrf.on('token-generated', handler);

      csrf.generateToken('session1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session1',
        })
      );
    });
  });

  describe('validateToken', () => {
    it('should validate a valid token', () => {
      const token = csrf.generateToken();
      const result = csrf.validateToken(token.token);

      expect(result.valid).toBe(true);
      expect(result.token).toBeDefined();
    });

    it('should reject invalid token', () => {
      const result = csrf.validateToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid CSRF token');
    });

    it('should reject expired token', () => {
      const shortLivedCsrf = new CSRFProtection({
        tokenExpiry: 1, // 1ms expiry
      });

      const token = shortLivedCsrf.generateToken();

      // Wait for expiry
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = shortLivedCsrf.validateToken(token.token);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('CSRF token expired');
          shortLivedCsrf.dispose();
          resolve();
        }, 10);
      });
    });

    it('should validate session binding', () => {
      const token = csrf.generateToken('session1');

      const validResult = csrf.validateToken(token.token, { sessionId: 'session1' });
      expect(validResult.valid).toBe(true);

      const invalidResult = csrf.validateToken(token.token, { sessionId: 'session2' });
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toBe('CSRF token session mismatch');
    });

    it('should validate double-submit cookie', () => {
      const token = csrf.generateToken();

      const validResult = csrf.validateToken(token.token, { cookieToken: token.token });
      expect(validResult.valid).toBe(true);

      const invalidResult = csrf.validateToken(token.token, { cookieToken: 'different-token' });
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toBe('CSRF cookie token mismatch');
    });
  });

  describe('rotateToken', () => {
    it('should rotate a valid token', () => {
      const oldToken = csrf.generateToken();
      const newToken = csrf.rotateToken(oldToken.token);

      expect(newToken).not.toBeNull();
      expect(newToken!.token).not.toBe(oldToken.token);

      // Old token should be invalid
      const oldResult = csrf.validateToken(oldToken.token);
      expect(oldResult.valid).toBe(false);

      // New token should be valid
      const newResult = csrf.validateToken(newToken!.token);
      expect(newResult.valid).toBe(true);
    });

    it('should return null for invalid token rotation', () => {
      const result = csrf.rotateToken('invalid-token');
      expect(result).toBeNull();
    });

    it('should preserve session binding on rotation', () => {
      const oldToken = csrf.generateToken('session1');
      const newToken = csrf.rotateToken(oldToken.token, 'session1');

      expect(newToken).not.toBeNull();
      expect(newToken!.sessionId).toBe('session1');
    });
  });

  describe('invalidateToken', () => {
    it('should invalidate a token', () => {
      const token = csrf.generateToken();

      const deleted = csrf.invalidateToken(token.token);
      expect(deleted).toBe(true);

      const result = csrf.validateToken(token.token);
      expect(result.valid).toBe(false);
    });

    it('should return false for non-existent token', () => {
      const deleted = csrf.invalidateToken('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('invalidateSession', () => {
    it('should invalidate all tokens for a session', () => {
      const token1 = csrf.generateToken('session1');
      const token2 = csrf.generateToken('session1');
      const token3 = csrf.generateToken('session2');

      const count = csrf.invalidateSession('session1');
      expect(count).toBe(2);

      expect(csrf.validateToken(token1.token).valid).toBe(false);
      expect(csrf.validateToken(token2.token).valid).toBe(false);
      expect(csrf.validateToken(token3.token).valid).toBe(true);
    });
  });

  describe('getCookieOptions', () => {
    it('should return correct cookie options', () => {
      const options = csrf.getCookieOptions();

      expect(options.name).toBe('_csrf');
      expect(options.options.httpOnly).toBe(false); // Must be readable by JS
      expect(options.options.sameSite).toBe('strict');
      expect(options.options.path).toBe('/');
    });
  });

  describe('getMetaTag', () => {
    it('should generate valid HTML meta tag', () => {
      const token = csrf.generateToken();
      const metaTag = csrf.getMetaTag(token.token);

      expect(metaTag).toContain('<meta name="csrf-token"');
      expect(metaTag).toContain(token.token);
    });

    it('should escape HTML special characters', () => {
      const metaTag = csrf.getMetaTag('<script>alert("xss")</script>');

      expect(metaTag).not.toContain('<script>');
      expect(metaTag).toContain('&lt;script&gt;');
    });
  });

  describe('getFormField', () => {
    it('should generate valid hidden input', () => {
      const token = csrf.generateToken();
      const field = csrf.getFormField(token.token);

      expect(field).toContain('<input type="hidden"');
      expect(field).toContain('name="_csrf"');
      expect(field).toContain(token.token);
    });
  });

  describe('cleanup', () => {
    it('should remove expired tokens', () => {
      const shortLivedCsrf = new CSRFProtection({
        tokenExpiry: 1,
      });

      shortLivedCsrf.generateToken();
      shortLivedCsrf.generateToken();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const cleaned = shortLivedCsrf.cleanup();
          expect(cleaned).toBe(2);
          shortLivedCsrf.dispose();
          resolve();
        }, 10);
      });
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      csrf.generateToken();
      csrf.generateToken();
      csrf.generateToken();

      const stats = csrf.getStats();

      expect(stats.activeTokens).toBe(3);
      expect(stats.oldestToken).toBeInstanceOf(Date);
      expect(stats.newestToken).toBeInstanceOf(Date);
    });

    it('should return empty stats when no tokens', () => {
      const stats = csrf.getStats();

      expect(stats.activeTokens).toBe(0);
      expect(stats.oldestToken).toBeUndefined();
      expect(stats.newestToken).toBeUndefined();
    });
  });

  describe('middleware', () => {
    it('should skip CSRF check for safe methods', () => {
      const mw = csrf.middleware();
      const req: Record<string, unknown> = {
        method: 'GET',
        headers: {},
        cookies: {},
      };
      const res = {
        cookie: jest.fn(),
      };
      const next = jest.fn();

      mw(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.csrfToken).toBeDefined();
    });

    it('should require token for unsafe methods', () => {
      const mw = csrf.middleware();
      const req = {
        method: 'POST',
        headers: {},
        cookies: {},
        body: {},
      };
      const res = {
        cookie: jest.fn(),
      };
      const next = jest.fn();

      mw(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should skip CSRF check for header-authenticated API requests', () => {
      const mw = csrf.middleware();
      const req = {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
        },
        cookies: {},
        body: {},
      };
      const res = {
        cookie: jest.fn(),
      };
      const next = jest.fn();

      mw(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should validate token from header', () => {
      const mw = csrf.middleware();
      const token = csrf.generateToken();

      const req = {
        method: 'POST',
        headers: {
          'x-csrf-token': token.token,
        },
        cookies: {
          _csrf: token.token,
        },
        body: {},
      };
      const res = {
        cookie: jest.fn(),
      };
      const next = jest.fn();

      mw(req as any, res as any, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('singleton', () => {
    afterEach(() => {
      resetCSRFProtection();
    });

    it('should return same instance', () => {
      const instance1 = getCSRFProtection();
      const instance2 = getCSRFProtection();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = getCSRFProtection();
      resetCSRFProtection();
      const instance2 = getCSRFProtection();

      expect(instance1).not.toBe(instance2);
    });
  });
});
