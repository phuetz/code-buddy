import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const coworkRoot = fileURLToPath(new URL('../', import.meta.url));
const auditScript = fileURLToPath(new URL('../scripts/audit-tailwind-colors.cjs', import.meta.url));
const css = readFileSync(new URL('../src/renderer/styles/globals.css', import.meta.url), 'utf8');

function themeTokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n  }', start);
  const tokens: Record<string, string> = {};
  for (const match of css.slice(start, end).matchAll(/(--color-[\w-]+):\s*(#[\da-fA-F]{6});/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

function luminance(hex: string): number {
  const channel = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channel[0] * 0.2126 + channel[1] * 0.7152 + channel[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

describe('Couleurs Tailwind Cowork', () => {
  it('génère chaque classe de couleur utilisée dans le renderer', () => {
    const report = JSON.parse(execFileSync(process.execPath, [auditScript, '--json'], {
      cwd: coworkRoot,
      encoding: 'utf8',
    })) as { scannedClasses: number; missing: Array<{ className: string; files: string[] }> };
    expect(report.scannedClasses).toBeGreaterThan(600);
    expect(report.missing).toEqual([]);
  });

  it.each([[':root', 'sombre'], ['.light', 'clair']] as const)(
    'respecte les contrastes AA des jetons %s (%s)', (selector) => {
      const colors = themeTokens(selector);
      const text = ['text-primary', 'text-secondary', 'accent', 'success', 'warning', 'error', 'info'];
      const surfaces = ['background', 'surface', 'surface-hover', 'surface-muted'];
      for (const name of text) {
        for (const surface of surfaces) {
          const foreground = colors[`--color-${name}`];
          const background = colors[`--color-${surface}`];
          expect(foreground, name).toBeDefined();
          expect(background, surface).toBeDefined();
          // Accent and status colors are shown as text on the base background.
          if (!name.startsWith('text-') && surface !== 'background') continue;
          expect(contrast(foreground, background), `${selector}: ${name} / ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(colors['--color-on-accent'], colors['--color-accent'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors['--color-on-accent'], colors['--color-accent-hover'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors['--color-border-strong'], colors['--color-background'])).toBeGreaterThanOrEqual(3);
    },
  );
});
