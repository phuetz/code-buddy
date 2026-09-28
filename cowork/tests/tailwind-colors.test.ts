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
  for (const match of css.slice(start, end).matchAll(/(--color-[\w-]+):\s*([^;]+);/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

type Rgb = [number, number, number];

function blend(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map((value, index) => value * alpha + background[index] * (1 - alpha)) as Rgb;
}

function rgb(value: string, background?: Rgb): Rgb {
  if (value.startsWith('#')) {
    return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)) as Rgb;
  }
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  expect(match, `Unsupported color ${value}`).not.toBeNull();
  expect(background, `RGBA color ${value} needs a background`).toBeDefined();
  const alpha = Number(match![4]);
  return blend([Number(match![1]), Number(match![2]), Number(match![3])], background!, alpha);
}

function luminance(color: Rgb): number {
  const channel = color.map((component) => {
    const value = component / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channel[0] * 0.2126 + channel[1] * 0.7152 + channel[2] * 0.0722;
}

function contrast(a: Rgb, b: Rgb): number {
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

  it.each([':root', '.light', '.ember', '.genspark', '.codex', '.anthropic'] as const)(
    'respecte les contrastes AA des jetons %s', (selector) => {
      const colors = themeTokens(selector);
      const text = ['text-primary', 'text-secondary', 'accent', 'accent-hover', 'success', 'warning', 'error', 'info'];
      const surfaces = ['background', 'background-secondary', 'surface', 'surface-hover', 'surface-muted'];
      const base = rgb(colors['--color-background']);
      for (const name of text) {
        for (const surface of surfaces) {
          const foreground = colors[`--color-${name}`];
          const background = colors[`--color-${surface}`];
          expect(foreground, name).toBeDefined();
          expect(background, surface).toBeDefined();
          expect(contrast(rgb(foreground), rgb(background, base)), `${selector}: ${name} / ${surface}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const accent of ['accent', 'accent-hover']) {
        const background = rgb(colors[`--color-${accent}`]);
        expect(contrast(rgb(colors['--color-on-accent']), background), `${selector}: on-accent / ${accent}`)
          .toBeGreaterThanOrEqual(4.5);
        expect(contrast(base, background), `${selector}: text-background / ${accent}`)
          .toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of surfaces) {
        const backdrop = rgb(colors[`--color-${surface}`], base);
        const translucentAccent = blend(rgb(colors['--color-accent']), backdrop, 0.9);
        expect(contrast(rgb(colors['--color-on-accent']), translucentAccent),
          `${selector}: on-accent / accent-90 on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of surfaces) {
        expect(contrast(rgb(colors['--color-border-strong']), rgb(colors[`--color-${surface}`], base)),
          `${selector}: border-strong / ${surface}`).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('adapte le texte blanc historique sur les fonds accent sans changer les composants', () => {
    expect(css).toContain('[class~="bg-accent/90"]).text-white');
    expect(css).toContain('color: var(--color-on-accent);');
  });
});
