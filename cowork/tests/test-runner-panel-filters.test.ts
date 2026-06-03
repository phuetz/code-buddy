import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'src/renderer/components/TestRunnerPanel.tsx');
const localePaths = ['en', 'fr', 'zh'].map((locale) =>
  path.resolve(process.cwd(), `src/renderer/i18n/locales/${locale}.json`)
);

const filterKeys = [
  'visibleCount',
  'catalogSearchPlaceholder',
  'filterAll',
  'filterSafe',
  'filterManual',
  'filterReal',
  'kindFilterLabel',
  'kindAll',
] as const;

describe('TestRunnerPanel catalog filters', () => {
  it('exposes search, mode, and kind filters for the harness catalog', () => {
    const source = fs.readFileSync(panelPath, 'utf8');
    expect(source).toContain('catalogQuery');
    expect(source).toContain('catalogMode');
    expect(source).toContain('catalogKind');
    expect(source).toContain('filteredCatalog');
    expect(source).toContain('data-testid="test-runner-catalog-filters"');
    expect(source).toContain('data-testid="test-runner-catalog-search"');
    expect(source).toContain('data-testid="test-runner-kind-filter"');
    expect(source).toContain('data-testid={`test-runner-filter-${option.value}`}');
    expect(source).toContain("value: 'safe' as CatalogModeFilter");
    expect(source).toContain("value: 'real' as CatalogModeFilter");
  });

  it('runs catalog batches from the filtered visible catalog', () => {
    const source = fs.readFileSync(panelPath, 'utf8');
    expect(source).toContain('includeAll ? filteredCatalog');
    expect(source).toContain('filteredCatalog.filter((item) => item.safeToRun)');
    expect(source).toContain('visible: filteredCatalog.length');
  });

  it('strips ANSI control sequences before rendering runner output', () => {
    const source = fs.readFileSync(panelPath, 'utf8');
    expect(source).toContain('function stripAnsi(text: string): string');
    expect(source).toContain('setOutput((prev) => prev + stripAnsi(payload.text))');
  });

  it('keeps functional chat coverage tied to the IPC runner capture', () => {
    const source = fs.readFileSync(panelPath, 'utf8');
    expect(source).toContain('Prompt rapide + chat IPC runner verifie');
    expect(source).toContain('59-test-runner-cowork-ipc-chat.png');
    expect(source).not.toContain('28-chat-ui-mock.png');
  });

  it('ships localized filter labels for all supported locales', () => {
    for (const localePath of localePaths) {
      const locale = JSON.parse(fs.readFileSync(localePath, 'utf8')) as {
        testRunner: Record<string, string> & { kind: Record<string, string> };
      };
      for (const key of filterKeys) {
        expect(locale.testRunner[key], `${path.basename(localePath)}:${key}`).toBeTruthy();
      }
      expect(locale.testRunner.kind.quality).toBeTruthy();
      expect(locale.testRunner.kind.integration).toBeTruthy();
      expect(locale.testRunner.kind.realProvider).toBeTruthy();
    }
  });
});
