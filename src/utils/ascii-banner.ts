/**
 * Simple ASCII Banner Generator
 * MIT Licensed alternative to cfonts (GPL-3.0)
 *
 * Provides basic ASCII art text rendering without GPL license concerns.
 */

import { logger } from './logger.js';

export interface BannerOptions {
  font?: 'simple' | 'block' | 'slant';
  color?: string;
  align?: 'left' | 'center' | 'right';
}

// Simple block font characters (5 lines high)
const BLOCK_FONT: Record<string, string[]> = {
  'G': [
    ' ████╗ ',
    '██╔═══╝',
    '██║ ███╗',
    '██║  ██║',
    ' █████╔╝',
  ],
  'R': [
    '██████╗ ',
    '██╔══██╗',
    '██████╔╝',
    '██╔══██╗',
    '██║  ██║',
  ],
  'O': [
    ' █████╗ ',
    '██╔══██╗',
    '██║  ██║',
    '██║  ██║',
    ' █████╔╝',
  ],
  'K': [
    '██╗  ██╗',
    '██║ ██╔╝',
    '█████╔╝ ',
    '██╔═██╗ ',
    '██║  ██╗',
  ],
  ' ': [
    '   ',
    '   ',
    '   ',
    '   ',
    '   ',
  ],
  'C': [
    ' ██████╗',
    '██╔════╝',
    '██║     ',
    '██║     ',
    ' ██████╗',
  ],
  'L': [
    '██╗     ',
    '██║     ',
    '██║     ',
    '██║     ',
    '███████╗',
  ],
  'I': [
    '██╗',
    '██║',
    '██║',
    '██║',
    '██║',
  ],
  'A': [
    ' █████╗ ',
    '██╔══██╗',
    '███████║',
    '██╔══██║',
    '██║  ██║',
  ],
  'B': [
    '██████╗ ',
    '██╔══██╗',
    '██████╔╝',
    '██╔══██╗',
    '██████╔╝',
  ],
  'D': [
    '██████╗ ',
    '██╔══██╗',
    '██║  ██║',
    '██║  ██║',
    '██████╔╝',
  ],
  'E': [
    '███████╗',
    '██╔════╝',
    '█████╗  ',
    '██╔══╝  ',
    '███████╗',
  ],
  'F': [
    '███████╗',
    '██╔════╝',
    '█████╗  ',
    '██╔══╝  ',
    '██║     ',
  ],
  'H': [
    '██╗  ██╗',
    '██║  ██║',
    '███████║',
    '██╔══██║',
    '██║  ██║',
  ],
  'J': [
    '     ██╗',
    '     ██║',
    '     ██║',
    '██   ██║',
    ' █████╔╝',
  ],
  'M': [
    '███╗   ███╗',
    '████╗ ████║',
    '██╔████╔██║',
    '██║╚██╔╝██║',
    '██║ ╚═╝ ██║',
  ],
  'N': [
    '███╗   ██╗',
    '████╗  ██║',
    '██╔██╗ ██║',
    '██║╚██╗██║',
    '██║ ╚████║',
  ],
  'P': [
    '██████╗ ',
    '██╔══██╗',
    '██████╔╝',
    '██╔═══╝ ',
    '██║     ',
  ],
  'Q': [
    ' █████╗ ',
    '██╔══██╗',
    '██║  ██║',
    '██║▄▄██║',
    ' ██████╔╝',
  ],
  'S': [
    '███████╗',
    '██╔════╝',
    '███████╗',
    '╚════██║',
    '███████║',
  ],
  'T': [
    '████████╗',
    '╚══██╔══╝',
    '   ██║   ',
    '   ██║   ',
    '   ██║   ',
  ],
  'U': [
    '██╗   ██╗',
    '██║   ██║',
    '██║   ██║',
    '██║   ██║',
    ' ██████╔╝',
  ],
  'V': [
    '██╗   ██╗',
    '██║   ██║',
    '██║   ██║',
    ' ██╗ ██╔╝',
    '  ████╔╝ ',
  ],
  'W': [
    '██╗    ██╗',
    '██║    ██║',
    '██║ █╗ ██║',
    '██║███╗██║',
    ' ███╔███╔╝',
  ],
  'X': [
    '██╗  ██╗',
    '╚██╗██╔╝',
    ' ╚███╔╝ ',
    ' ██╔██╗ ',
    '██╔╝ ██╗',
  ],
  'Y': [
    '██╗   ██╗',
    '╚██╗ ██╔╝',
    ' ╚████╔╝ ',
    '  ╚██╔╝  ',
    '   ██║   ',
  ],
  'Z': [
    '███████╗',
    '╚════██║',
    '  ███╔╝ ',
    ' ███╔╝  ',
    '███████╗',
  ],
};

/**
 * Render text as ASCII art banner
 */
export function renderBanner(text: string, options: BannerOptions = {}): string {
  const { font = 'block', align = 'left' } = options;

  if (font === 'simple') {
    return renderSimpleBanner(text);
  }

  const upperText = text.toUpperCase();
  const lines: string[] = ['', '', '', '', ''];

  for (const char of upperText) {
    const charLines = BLOCK_FONT[char] || BLOCK_FONT[' '];
    for (let i = 0; i < 5; i++) {
      lines[i] += charLines[i] || '   ';
    }
  }

  // Get terminal width for alignment
  const termWidth = process.stdout.columns || 80;

  if (align === 'center') {
    return lines.map(line => {
      const padding = Math.max(0, Math.floor((termWidth - line.length) / 2));
      return ' '.repeat(padding) + line;
    }).join('\n');
  }

  return lines.join('\n');
}

/**
 * Simple one-line banner
 */
function renderSimpleBanner(text: string): string {
  const border = '═'.repeat(text.length + 4);
  return `╔${border}╗\n║  ${text}  ║\n╚${border}╝`;
}

/**
 * Render "GROK" banner (default app banner)
 */
export function renderGrokBanner(): string {
  return renderBanner('GROK', { align: 'center' });
}

/**
 * Render with gradient colors (using ANSI codes)
 */
export function renderColorBanner(text: string, colors: string[] = ['cyan', 'blue']): string {
  const banner = renderBanner(text);
  const lines = banner.split('\n');

  const colorCodes: Record<string, string> = {
    'red': '\x1b[31m',
    'green': '\x1b[32m',
    'yellow': '\x1b[33m',
    'blue': '\x1b[34m',
    'magenta': '\x1b[35m',
    'cyan': '\x1b[36m',
    'white': '\x1b[37m',
    'reset': '\x1b[0m',
  };

  // Apply gradient effect
  return lines.map((line, i) => {
    const colorIndex = Math.floor(i / lines.length * colors.length);
    const color = colors[Math.min(colorIndex, colors.length - 1)];
    return `${colorCodes[color] || ''}${line}${colorCodes['reset']}`;
  }).join('\n');
}

// Export default for easy replacement of cfonts
export default {
  render: renderBanner,
  say: (text: string, options?: BannerOptions) => {
    logger.info(renderBanner(text, options));
  },
};
