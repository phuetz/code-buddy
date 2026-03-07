/**
 * Terminal Enhancements
 * OSC-8 hyperlinks, theming palette, and verbose mode.
 */

import { logger } from '../utils/logger.js';

export class OSC8Hyperlink {
  static create(url: string, text: string): string {
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
  }

  static isSupported(): boolean {
    const term = process.env.TERM_PROGRAM || '';
    const supported = ['kitty', 'iTerm.app', 'iTerm2', 'WezTerm', 'vscode', 'Hyper'];
    return supported.some(t => term.toLowerCase().includes(t.toLowerCase()));
  }

  static stripLinks(text: string): string {
    // Remove OSC-8 escape sequences
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '');
  }
}

export class LobsterPalette {
  private static instance: LobsterPalette | null = null;

  readonly accent = '#FF5A2D';
  readonly success = '#2FBF71';
  readonly warning = '#FFB020';
  readonly error = '#E23D2D';
  readonly info = '#3B82F6';
  readonly dim = '#6B7280';

  static getInstance(): LobsterPalette {
    if (!LobsterPalette.instance) {
      LobsterPalette.instance = new LobsterPalette();
    }
    return LobsterPalette.instance;
  }

  static resetInstance(): void {
    LobsterPalette.instance = null;
  }

  getColor(name: string): string | undefined {
    const colors = this.getAllColors();
    return colors[name];
  }

  applyAnsi(text: string, colorName: string): string {
    const ansiMap: Record<string, string> = {
      accent: '\x1b[38;2;255;90;45m',
      success: '\x1b[38;2;47;191;113m',
      warning: '\x1b[38;2;255;176;32m',
      error: '\x1b[38;2;226;61;45m',
      info: '\x1b[38;2;59;130;246m',
      dim: '\x1b[38;2;107;114;128m',
    };
    const code = ansiMap[colorName];
    if (!code) return text;
    return `${code}${text}\x1b[0m`;
  }

  getAllColors(): Record<string, string> {
    return {
      accent: this.accent,
      success: this.success,
      warning: this.warning,
      error: this.error,
      info: this.info,
      dim: this.dim,
    };
  }
}

export class VerboseMode {
  private static instance: VerboseMode | null = null;
  private enabled: boolean = false;

  static getInstance(): VerboseMode {
    if (!VerboseMode.instance) {
      VerboseMode.instance = new VerboseMode();
    }
    return VerboseMode.instance;
  }

  static resetInstance(): void {
    VerboseMode.instance = null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  log(message: string): void {
    if (this.enabled) {
      logger.debug(`[VERBOSE] ${message}`);
    }
  }
}
