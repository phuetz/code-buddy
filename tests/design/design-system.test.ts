/**
 * Design-system registry + branding injection — real tests (no mocks): they read
 * the actual vendored assets under assets/design-systems/ and write into a real
 * tmpdir, exactly as the App Studio scaffold path does.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadCatalog,
  listDesignSystems,
  getDesignSystem,
  buildDesignGuidance,
} from '../../src/design/design-system-registry.js';
import { applyDesignSystem } from '../../src/templates/design-system-apply.js';

describe('design-system-registry', () => {
  it('loads the full vendored catalog', () => {
    const catalog = loadCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(150);
    for (const entry of catalog.slice(0, 5)) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.category).toBeTruthy();
    }
  });

  it('getDesignSystem returns brand DESIGN.md + tokens for a known id', () => {
    const spotify = getDesignSystem('spotify');
    expect(spotify).not.toBeNull();
    expect(spotify?.name).toBe('Spotify');
    expect(spotify?.design).toContain('Spotify');
    expect((spotify?.tokensCss ?? '').length).toBeGreaterThan(0);
  });

  it('getDesignSystem returns null for an unknown id (no path traversal)', () => {
    expect(getDesignSystem('nope-xyz-123')).toBeNull();
    expect(getDesignSystem('../../etc/passwd')).toBeNull();
    expect(getDesignSystem('')).toBeNull();
  });

  it('listDesignSystems filters by category and query', () => {
    const all = listDesignSystems();
    expect(all.length).toBe(loadCatalog().length);

    const spotifyByQuery = listDesignSystems({ query: 'spotify' });
    expect(spotifyByQuery.some((s) => s.id === 'spotify')).toBe(true);

    const byCategory = listDesignSystems({ category: getDesignSystem('spotify')!.category });
    expect(byCategory.length).toBeGreaterThan(0);
    expect(byCategory.every((s) => s.category === getDesignSystem('spotify')!.category)).toBe(true);
  });

  it('buildDesignGuidance produces non-empty guidance and honours maxChars', () => {
    const full = buildDesignGuidance('spotify');
    expect(full).toBeTruthy();
    expect((full ?? '').length).toBeGreaterThan(100);

    const capped = buildDesignGuidance('spotify', { maxChars: 500 });
    expect(capped).toBeTruthy();
    // Allow a small overhead for the imperative header + truncation marker.
    expect((capped ?? '').length).toBeLessThan(1200);

    expect(buildDesignGuidance('nope-xyz-123')).toBeNull();
  });
});

describe('applyDesignSystem', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('brands a react-ts-like project: writes design-system.css + DESIGN.md and wires the import after index.css', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-apply-test-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'main.tsx'), "import './index.css';\nconsole.log('app');\n");
    fs.writeFileSync(path.join(dir, 'src', 'index.css'), ':root { --x: 0; }\n');

    const result = applyDesignSystem(dir, 'spotify');
    expect(result.applied).toBe(true);
    expect(result.files).toContain('DESIGN.md');

    const css = fs.readFileSync(path.join(dir, 'src', 'design-system.css'), 'utf8');
    expect(css.length).toBeGreaterThan(0);
    expect(css).toContain('Spotify');

    const main = fs.readFileSync(path.join(dir, 'src', 'main.tsx'), 'utf8');
    // The brand import must come AFTER index.css so brand tokens win the cascade.
    expect(main.indexOf('design-system.css')).toBeGreaterThan(main.indexOf('index.css'));

    expect(fs.existsSync(path.join(dir, 'DESIGN.md'))).toBe(true);
  });

  it('is a no-op for an unknown design system id', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-apply-noop-'));
    const result = applyDesignSystem(dir, 'nope-xyz-123');
    expect(result.applied).toBe(false);
    expect(fs.existsSync(path.join(dir, 'DESIGN.md'))).toBe(false);
  });
});
