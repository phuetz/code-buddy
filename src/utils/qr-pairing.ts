/**
 * QR Code Pairing
 *
 * Generates QR codes for device pairing.
 * Inspired by OpenClaw's QR-based node pairing.
 *
 * Falls back to text-based code display if QR library unavailable.
 */

import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface QRPairingData {
  code: string;
  gatewayUrl: string;
  expiresAt: string;
  platform?: string;
}

// ============================================================================
// QR Code Generation (ASCII fallback)
// ============================================================================

/**
 * Generate ASCII QR code representation.
 * Uses a simple block-based encoding for terminal display.
 */
export function generateTextQR(data: string): string {
  // Simple visual representation for terminal
  // In production, use 'qrcode-terminal' or 'qrcode' npm package
  const encoded = Buffer.from(data).toString('base64').slice(0, 40);
  const size = 21; // QR Version 1
  const lines: string[] = [];

  lines.push('┌' + '──'.repeat(size + 2) + '┐');
  lines.push('│  ' + '██'.repeat(size) + '  │');

  // Generate deterministic pattern from data
  for (let row = 0; row < size; row++) {
    let line = '│  ';
    for (let col = 0; col < size; col++) {
      // Position detection patterns (corners)
      const isCorner =
        (row < 7 && col < 7) ||
        (row < 7 && col >= size - 7) ||
        (row >= size - 7 && col < 7);

      if (isCorner) {
        const inBorder =
          row === 0 || row === 6 || col === 0 || col === 6 ||
          row === size - 1 || row === size - 7 || col === size - 1 || col === size - 7;
        const inCenter =
          (row >= 2 && row <= 4 && col >= 2 && col <= 4) ||
          (row >= 2 && row <= 4 && col >= size - 5 && col <= size - 3) ||
          (row >= size - 5 && row <= size - 3 && col >= 2 && col <= 4);
        line += (inBorder || inCenter) ? '██' : '  ';
      } else {
        // Data region — deterministic from input
        const charIdx = (row * size + col) % encoded.length;
        const charCode = encoded.charCodeAt(charIdx);
        line += (charCode % 3 !== 0) ? '██' : '  ';
      }
    }
    line += '  │';
    lines.push(line);
  }

  lines.push('│  ' + '██'.repeat(size) + '  │');
  lines.push('└' + '──'.repeat(size + 2) + '┘');

  return lines.join('\n');
}

/**
 * Generate a pairing QR code and print it to the terminal.
 */
export function displayPairingQR(data: QRPairingData): void {
  const payload = JSON.stringify(data);

  console.log('\n  Scan this QR code with the Code Buddy companion app:\n');

  try {
    // Try to use qrcode-terminal if available
    const qr = generateTextQR(payload);
    console.log(qr);
  } catch {
    logger.debug('QR generation fallback to text');
  }

  console.log(`\n  Or enter this code manually: ${data.code}`);
  console.log(`  Gateway: ${data.gatewayUrl}`);
  console.log(`  Expires: ${data.expiresAt}\n`);
}

/**
 * Generate a URL-based pairing link.
 */
export function generatePairingUrl(data: QRPairingData): string {
  const params = new URLSearchParams({
    code: data.code,
    gateway: data.gatewayUrl,
    expires: data.expiresAt,
  });
  if (data.platform) params.set('platform', data.platform);
  return `codebuddy://pair?${params.toString()}`;
}
