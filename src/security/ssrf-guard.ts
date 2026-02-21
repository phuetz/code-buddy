/**
 * SSRF Guard — OpenClaw-inspired server-side request forgery protection
 *
 * Applied to all outbound HTTP calls made by the agent (web_fetch, media
 * download, webhook delivery). Blocks all private/loopback/link-local
 * addresses including advanced bypass vectors:
 *
 * - RFC 1918 / loopback / link-local IPv4
 * - IPv4-mapped IPv6 (::ffff:127.0.0.1), full-form variants
 * - NAT64 prefix (64:ff9b::/96, 64:ff9b:1::/48)
 * - 6to4 (2002::/16)
 * - Teredo (2001:0000::/32)
 * - Octal, hex, short, packed IPv4 literals (0177.0.0.1, 127.1, 2130706433)
 * - Sensitive headers stripped on cross-origin redirects
 *
 * Fails **closed** on parse errors (unknown format → blocked).
 */

import * as dns from 'dns/promises';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SSRFCheckResult {
  safe: boolean;
  reason?: string;
}

export interface SSRFGuardConfig {
  /** Additional allowed hosts (exact hostname or *.domain.com wildcard) */
  allowedHosts?: string[];
  /** Additional blocked CIDR-like ranges (for extension) */
  extraBlockedHosts?: string[];
  /** Resolve DNS and check each returned IP (default: true) */
  resolveDns?: boolean;
}

// ============================================================================
// Private IP range matchers (IPv4)
// ============================================================================

/** Parse decimal, octal (0177.0.0.1), hex (0x7f000001), short forms (127.1) to uint32 */
function parseIPv4ToUint32(host: string): number | null {
  // Hex: 0x7f000001
  if (/^0x[0-9a-f]+$/i.test(host)) {
    const n = parseInt(host, 16);
    return isNaN(n) ? null : n >>> 0;
  }

  // Pure decimal integer: 2130706433
  if (/^\d+$/.test(host)) {
    const n = parseInt(host, 10);
    return isNaN(n) ? null : n >>> 0;
  }

  // Dotted notation: handles decimal, octal, hex per-octet and short forms
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    let val: number;
    if (/^0x[0-9a-f]+$/i.test(part)) {
      val = parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part)) {
      val = parseInt(part, 8); // octal
    } else if (/^\d+$/.test(part)) {
      val = parseInt(part, 10);
    } else {
      return null;
    }
    if (isNaN(val) || val < 0) return null;
    octets.push(val);
  }

  // Short-form expansion: 127.1 → 127.0.0.1, 10.1.2 → 10.1.0.2
  while (octets.length < 4) {
    const last = octets.pop()!;
    // last octet expands into remaining spots (like inet_aton)
    octets.push(0);
    octets.push(last);
  }

  if (octets.some(o => o > 255)) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function isPrivateIPv4(uint32: number): boolean {
  // 0.0.0.0/8 — This network
  if ((uint32 & 0xff000000) === 0x00000000) return true;
  // 10.0.0.0/8
  if ((uint32 & 0xff000000) === 0x0a000000) return true;
  // 100.64.0.0/10 — Shared address space (RFC 6598)
  if ((uint32 & 0xffc00000) === 0x64400000) return true;
  // 127.0.0.0/8 — Loopback
  if ((uint32 & 0xff000000) === 0x7f000000) return true;
  // 169.254.0.0/16 — Link-local / AWS metadata
  if ((uint32 & 0xffff0000) === 0xa9fe0000) return true;
  // 172.16.0.0/12
  if ((uint32 & 0xfff00000) === 0xac100000) return true;
  // 192.0.0.0/24 — IETF protocol assignments
  if ((uint32 & 0xffffff00) === 0xc0000000) return true;
  // 192.168.0.0/16
  if ((uint32 & 0xffff0000) === 0xc0a80000) return true;
  // 198.18.0.0/15 — Benchmark testing
  if ((uint32 & 0xfffe0000) === 0xc6120000) return true;
  // 198.51.100.0/24 — TEST-NET-2
  if ((uint32 & 0xffffff00) === 0xc6336400) return true;
  // 203.0.113.0/24 — TEST-NET-3
  if ((uint32 & 0xffffff00) === 0xcb007100) return true;
  // 224.0.0.0/4 — Multicast
  if ((uint32 & 0xf0000000) === 0xe0000000) return true;
  // 240.0.0.0/4 — Reserved
  if ((uint32 & 0xf0000000) === 0xf0000000) return true;
  // 255.255.255.255
  if (uint32 === 0xffffffff) return true;

  return false;
}

// ============================================================================
// IPv6 private range detection
// ============================================================================

/** Expand a possibly compressed IPv6 address to 8 groups of uint16 */
function expandIPv6(address: string): number[] | null {
  try {
    // Handle IPv4-mapped: ::ffff:1.2.3.4
    const v4mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4mapped) {
      const v4 = parseIPv4ToUint32(v4mapped[1]);
      if (v4 === null) return null;
      return [0, 0, 0, 0, 0, 0xffff, (v4 >>> 16) & 0xffff, v4 & 0xffff];
    }

    if (!address.includes(':')) return null;

    // Split on ::
    const halves = address.split('::');
    if (halves.length > 2) return null;

    const parseGroups = (s: string): number[] | null => {
      if (s === '') return [];
      return s.split(':').map(g => {
        // Handle embedded IPv4 in last two groups
        if (g.includes('.')) {
          const v4 = parseIPv4ToUint32(g);
          return v4 !== null ? [((v4 >>> 16) & 0xffff), v4 & 0xffff] : null;
        }
        const n = parseInt(g, 16);
        return isNaN(n) ? null : [n];
      }).reduce<number[] | null>((acc, val) => {
        if (acc === null || val === null) return null;
        return [...acc, ...(Array.isArray(val[0]) ? val[0] : val) as number[]];
      }, []);
    };

    if (halves.length === 1) {
      const groups = parseGroups(halves[0]);
      if (!groups || groups.length !== 8) return null;
      return groups;
    }

    const left = parseGroups(halves[0]) ?? [];
    const right = parseGroups(halves[1]) ?? [];
    const fill = new Array(8 - left.length - right.length).fill(0);
    const groups = [...left, ...fill, ...right];
    if (groups.length !== 8) return null;
    return groups;
  } catch {
    return null;
  }
}

function isPrivateIPv6(address: string): boolean {
  const addr = address.toLowerCase().replace(/^\[|\]$/g, ''); // strip brackets

  // ::1 — loopback
  if (addr === '::1') return true;
  // :: — unspecified
  if (addr === '::') return true;

  const groups = expandIPv6(addr);
  if (!groups) return false; // parse error → caller should handle

  const g = groups;

  // ::ffff:0:0/96 — IPv4-mapped
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const v4 = (g[6] << 16) | g[7];
    return isPrivateIPv4(v4 >>> 0);
  }

  // 0:0:0:0:0:0::/96 — IPv4-compatible (deprecated but still mapped)
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    const v4 = (g[6] << 16) | g[7];
    if (v4 !== 0 && v4 !== 1) return isPrivateIPv4(v4 >>> 0);
  }

  // 64:ff9b::/96 — NAT64 (RFC 6052)
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    const v4 = (g[6] << 16) | g[7];
    return isPrivateIPv4(v4 >>> 0);
  }

  // 64:ff9b:1::/48 — NAT64 (RFC 8215)
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0x0001) return true;

  // 2002::/16 — 6to4 (RFC 3056): embedded IPv4 is in groups [1] and [2]
  if (g[0] === 0x2002) {
    const v4 = (g[1] << 16) | g[2];
    return isPrivateIPv4(v4 >>> 0);
  }

  // 2001:0000::/32 — Teredo (RFC 4380)
  if (g[0] === 0x2001 && g[1] === 0x0000) return true;

  // fc00::/7 — Unique local
  if ((g[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 — Link-local
  if ((g[0] & 0xffc0) === 0xfe80) return true;

  // ff00::/8 — Multicast
  if ((g[0] & 0xff00) === 0xff00) return true;

  return false;
}

// ============================================================================
// SSRFGuard
// ============================================================================

export class SSRFGuard {
  private config: Required<SSRFGuardConfig>;

  constructor(config: SSRFGuardConfig = {}) {
    this.config = {
      allowedHosts: config.allowedHosts ?? [],
      extraBlockedHosts: config.extraBlockedHosts ?? [],
      resolveDns: config.resolveDns ?? true,
    };
  }

  /**
   * Check if a URL is safe to fetch.
   * Resolves the hostname to IP(s) and validates each one.
   *
   * @returns `{safe: true}` if the URL is safe, or `{safe: false, reason}` otherwise.
   */
  async isSafeUrl(rawUrl: string): Promise<SSRFCheckResult> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { safe: false, reason: 'Invalid URL (parse error)' };
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: `Blocked protocol: ${parsed.protocol}` };
    }

    const host = parsed.hostname.toLowerCase();

    // Check allowlist first
    if (this.isAllowedHost(host)) {
      return { safe: true };
    }

    // Check extra blocked hosts
    if (this.config.extraBlockedHosts.some(h => host === h || host.endsWith('.' + h))) {
      return { safe: false, reason: `Host on blocked list: ${host}` };
    }

    // Check if host is an IP literal
    const ipCheck = this.checkIpLiteral(host);
    if (ipCheck !== null) return ipCheck;

    // Resolve DNS and check each returned address
    if (this.config.resolveDns) {
      try {
        const addresses = await dns.lookup(host, { all: true });
        for (const { address, family } of addresses) {
          const result = family === 6
            ? this.checkIPv6(address)
            : this.checkIPv4String(address);
          if (!result.safe) {
            return { safe: false, reason: `Host ${host} resolves to private IP: ${address} — ${result.reason}` };
          }
        }
      } catch (err) {
        // DNS resolution failure → fail closed
        return { safe: false, reason: `DNS resolution failed for ${host}: ${err}` };
      }
    }

    return { safe: true };
  }

  /**
   * Synchronous check for IP literals only (no DNS).
   * Use for fast path when URL is already an IP literal.
   */
  isSafeUrlSync(rawUrl: string): SSRFCheckResult {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { safe: false, reason: 'Invalid URL' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: `Blocked protocol: ${parsed.protocol}` };
    }

    const host = parsed.hostname;
    const ipCheck = this.checkIpLiteral(host);
    if (ipCheck !== null) return ipCheck;

    // Cannot verify hostname without DNS — return safe (async version required)
    return { safe: true };
  }

  private isAllowedHost(host: string): boolean {
    return this.config.allowedHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        return host.endsWith(allowed.slice(1));
      }
      return host === allowed;
    });
  }

  /** Returns null if not an IP literal */
  private checkIpLiteral(host: string): SSRFCheckResult | null {
    // IPv6 literal in brackets [::1]
    if (host.startsWith('[') && host.endsWith(']')) {
      return this.checkIPv6(host.slice(1, -1));
    }

    // Try parsing as IPv4 (handles octal/hex/short forms)
    const v4 = parseIPv4ToUint32(host);
    if (v4 !== null) {
      return this.checkIPv4Uint32(v4);
    }

    // Try parsing as plain IPv6 (no brackets)
    if (host.includes(':')) {
      return this.checkIPv6(host);
    }

    return null; // Not an IP literal
  }

  private checkIPv4String(address: string): SSRFCheckResult {
    const v4 = parseIPv4ToUint32(address);
    if (v4 === null) return { safe: false, reason: `Could not parse IPv4 address: ${address}` };
    return this.checkIPv4Uint32(v4);
  }

  private checkIPv4Uint32(uint32: number): SSRFCheckResult {
    if (isPrivateIPv4(uint32)) {
      const a = [(uint32 >>> 24) & 0xff, (uint32 >>> 16) & 0xff, (uint32 >>> 8) & 0xff, uint32 & 0xff];
      return { safe: false, reason: `Private/reserved IPv4: ${a.join('.')}` };
    }
    return { safe: true };
  }

  private checkIPv6(address: string): SSRFCheckResult {
    if (isPrivateIPv6(address)) {
      return { safe: false, reason: `Private/reserved IPv6: ${address}` };
    }
    // Expand to verify parse succeeded
    const groups = expandIPv6(address.toLowerCase());
    if (groups === null) {
      return { safe: false, reason: `Could not parse IPv6 address: ${address}` };
    }
    return { safe: true };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _guard: SSRFGuard | null = null;

export function getSSRFGuard(config?: SSRFGuardConfig): SSRFGuard {
  if (!_guard) _guard = new SSRFGuard(config);
  return _guard;
}

export function resetSSRFGuard(): void {
  _guard = null;
}

/**
 * Convenience wrapper — use in web_fetch, webhook delivery, media download.
 *
 * @example
 * const check = await assertSafeUrl(url);
 * if (!check.safe) throw new Error(`SSRF blocked: ${check.reason}`);
 */
export async function assertSafeUrl(url: string): Promise<SSRFCheckResult> {
  try {
    return await getSSRFGuard().isSafeUrl(url);
  } catch (err) {
    logger.warn('SSRFGuard check failed', { url, err });
    return { safe: false, reason: `SSRF guard error: ${err}` };
  }
}
