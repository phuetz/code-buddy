/**
 * HTTP Fetch Tool
 *
 * Make HTTP requests to APIs and web resources.
 * Supports GET, POST, PUT, DELETE with JSON handling.
 */

import type { ToolResult } from '../types/index.js';
import { assertSafeUrl } from '../security/ssrf-guard.js';

// ============================================================================
// Types
// ============================================================================

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

interface FetchParams {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  followRedirects?: boolean;
  parseJson?: boolean;
}

// ============================================================================
// Fetch Tool
// ============================================================================

export class FetchTool {
  name = 'fetch';
  description = 'Make HTTP requests to APIs and web resources';
  dangerLevel: 'safe' | 'low' | 'medium' | 'high' = 'medium';

  inputSchema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
        description: 'HTTP method (default: GET)',
      },
      headers: {
        type: 'object',
        description: 'HTTP headers as key-value pairs',
      },
      body: {
        type: ['string', 'object'],
        description: 'Request body (will be JSON stringified if object)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
      followRedirects: {
        type: 'boolean',
        description: 'Follow redirects (default: true)',
      },
      parseJson: {
        type: 'boolean',
        description: 'Parse response as JSON (default: true for JSON content-type)',
      },
    },
    required: ['url'],
  };

  /**
   * Execute HTTP request
   */
  async execute(params: FetchParams): Promise<ToolResult> {
    try {
      const {
        url,
        method = 'GET',
        headers = {},
        body,
        timeout = 30000,
        followRedirects = true,
        parseJson,
      } = params;

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return { success: false, error: `Invalid URL: ${url}` };
      }

      // Security check — full SSRF guard (OpenClaw-inspired, replaces basic isInternalUrl)
      const ssrfCheck = await assertSafeUrl(url);
      if (!ssrfCheck.safe) {
        return { success: false, error: `SSRF protection: ${ssrfCheck.reason}` };
      }

      // Prepare request
      const requestHeaders: Record<string, string> = {
        'User-Agent': 'Grok-CLI/1.0',
        ...headers,
      };

      let requestBody: string | undefined;
      if (body !== undefined) {
        if (typeof body === 'object') {
          requestBody = JSON.stringify(body);
          if (!requestHeaders['Content-Type']) {
            requestHeaders['Content-Type'] = 'application/json';
          }
        } else {
          requestBody = String(body);
        }
      }

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: requestBody,
          redirect: followRedirects ? 'follow' : 'manual',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        const shouldParseJson = parseJson !== undefined
          ? parseJson
          : contentType.includes('application/json');

        let responseBody: unknown;
        if (shouldParseJson) {
          try {
            responseBody = await response.json();
          } catch {
            responseBody = await response.text();
          }
        } else {
          responseBody = await response.text();
        }

        // Format response
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const result = {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
        };

        return {
          success: response.ok,
          content: JSON.stringify(result, null, 2),
          metadata: {
            status: response.status,
            contentType,
            url: response.url,
          },
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timed out' };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if URL is internal/local
   */
  private isInternalUrl(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();

    // Block localhost variants
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // Block private IP ranges
    if (hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')) {
      return true;
    }

    // Block metadata endpoints (cloud providers)
    if (hostname === '169.254.169.254' ||
        hostname === 'metadata.google.internal' ||
        hostname.includes('metadata.azure')) {
      return true;
    }

    return false;
  }

  /**
   * Convenience method for GET requests
   */
  async get(url: string, headers?: Record<string, string>): Promise<ToolResult> {
    return this.execute({ url, method: 'GET', headers });
  }

  /**
   * Convenience method for POST requests
   */
  async post(url: string, body: unknown, headers?: Record<string, string>): Promise<ToolResult> {
    return this.execute({ url, method: 'POST', body, headers });
  }

  /**
   * Convenience method for PUT requests
   */
  async put(url: string, body: unknown, headers?: Record<string, string>): Promise<ToolResult> {
    return this.execute({ url, method: 'PUT', body, headers });
  }

  /**
   * Convenience method for DELETE requests
   */
  async delete(url: string, headers?: Record<string, string>): Promise<ToolResult> {
    return this.execute({ url, method: 'DELETE', headers });
  }
}

// Singleton
let fetchToolInstance: FetchTool | null = null;

export function getFetchTool(): FetchTool {
  if (!fetchToolInstance) {
    fetchToolInstance = new FetchTool();
  }
  return fetchToolInstance;
}
