/**
 * Widget engine — the self-learning loop: curated hit, opt-in generation, gate,
 * keep, reuse. Isolated temp authored dir; LLM propose step is injected.
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveOrGenerate,
  keepAuthoredWidget,
  listAuthoredWidgets,
  readAuthoredTemplate,
} from '../../src/widgets/widget-engine.js';
import type { WidgetProposal } from '../../src/widgets/widget-types.js';

function tmpEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'wdg-eng-'));
  return { CODEBUDDY_WIDGETS_DIR: dir, ...extra } as NodeJS.ProcessEnv;
}

const STOCK = { type: 'stock', symbol: 'ACME', price: 42 };
const CLEAN_TPL = '<style>.cbw-stock{padding:8px}</style><div class="cbw-stock">{{ symbol }} {{ price }}</div>';

describe('resolveOrGenerate', () => {
  it('renders a curated widget immediately (no generation needed)', async () => {
    const env = tmpEnv(); // generation OFF, but curated always works
    const doc = await resolveOrGenerate({ type: 'weather', location: 'Paris', current: { temperature: 20, condition: 'clair' } }, { env });
    expect(doc).toContain('Paris');
    expect(doc).toContain('<!doctype html>');
  });

  it('returns null for an unknown kind when generation is OFF (opt-in)', async () => {
    const env = tmpEnv(); // CODEBUDDY_WIDGETS unset
    const propose = jest.fn();
    const doc = await resolveOrGenerate(STOCK, { env, propose });
    expect(doc).toBeNull();
    expect(propose).not.toHaveBeenCalled();
  });

  it('generates, gates, keeps and RENDERS a new widget when enabled; reuses next time', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true' });
    const propose = jest.fn(
      async (kind: string, sample: unknown): Promise<WidgetProposal> => ({ kind, template: CLEAN_TPL, sample })
    );
    const doc = await resolveOrGenerate(STOCK, { env, propose });
    expect(doc).toContain('ACME 42');
    expect(listAuthoredWidgets(env)).toContain('stock');
    expect(readAuthoredTemplate('stock', env)).toBe(CLEAN_TPL);

    // Second call is a registry hit → propose NOT called again.
    propose.mockClear();
    const doc2 = await resolveOrGenerate({ type: 'stock', symbol: 'BETA', price: 7 }, { env, propose });
    expect(doc2).toContain('BETA 7');
    expect(propose).not.toHaveBeenCalled();
  });

  it('rejects an unsafe proposal and keeps NOTHING', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true' });
    const propose = async (kind: string, sample: unknown): Promise<WidgetProposal> => ({
      kind,
      template: '<div class="cbw-stock"><script>fetch("//evil")</script>{{ symbol }}</div>',
      sample,
    });
    const doc = await resolveOrGenerate(STOCK, { env, propose });
    expect(doc).toBeNull();
    expect(listAuthoredWidgets(env)).not.toContain('stock');
  });

  it('never-throws when the proposer returns null', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true' });
    const doc = await resolveOrGenerate(STOCK, { env, propose: async () => null });
    expect(doc).toBeNull();
  });
});

describe('keepAuthoredWidget', () => {
  it('writes widget.html + meta.json', () => {
    const env = tmpEnv();
    expect(keepAuthoredWidget({ kind: 'stock', template: CLEAN_TPL, sample: STOCK }, env)).toBe(true);
    const dir = join(env.CODEBUDDY_WIDGETS_DIR!, 'authored-stock');
    expect(existsSync(join(dir, 'widget.html'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).source).toBe('authored');
  });

  it('refuses to shadow a curated widget', () => {
    const env = tmpEnv();
    expect(keepAuthoredWidget({ kind: 'weather', template: '<div>evil</div>', sample: {} }, env)).toBe(false);
    expect(listAuthoredWidgets(env)).not.toContain('weather');
  });
});
