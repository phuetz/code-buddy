import { detectWidgetable, matchAuthored } from '../../src/widgets/widget-matcher.js';

const longText = (suffix: string = ''): string => `${'Réponse structurée. '.repeat(14)}${suffix}`;

describe('detectWidgetable', () => {
  it('detects a typed data payload', () => {
    const data = { type: 'sales', total: 42 };
    expect(detectWidgetable(longText(), [{ output: 'ok', data }])).toEqual({
      kind: 'payload',
      dataType: 'sales',
      data,
    });
  });

  it('detects a markdown table at the 3-row by 2-column minimum', () => {
    const candidate = detectWidgetable(
      longText(`\n\n| City | Score |\n| --- | ---: |\n| Paris | 98 |\n| Lyon | 91 |`),
      []
    );
    expect(candidate?.kind).toBe('table');
    expect(candidate?.dataType).toBe('table');
    expect(candidate?.data).toEqual({
      type: 'table',
      headers: [{ label: 'City' }, { label: 'Score' }],
      rows: [
        { cells: [{ value: 'Paris' }, { value: '98' }] },
        { cells: [{ value: 'Lyon' }, { value: '91' }] },
      ],
    });
  });

  it('returns null for plain text', () => {
    expect(detectWidgetable(longText(' Aucun tableau ici.'), [])).toBeNull();
  });

  it('detects structured data regardless of answer length', () => {
    const data = { type: 'sales', total: 42 };
    expect(detectWidgetable('Trop court', [{ data }])).toEqual({
      kind: 'payload',
      dataType: 'sales',
      data,
    });
  });

  it('uses 200 characters as the inclusive answer-length threshold', () => {
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const exact = `${'x'.repeat(200 - table.length - 1)}\n${table}`;
    const short = `${'x'.repeat(199 - table.length - 1)}\n${table}`;
    expect(exact).toHaveLength(200);
    expect(detectWidgetable(exact, [])?.dataType).toBe('table');
    expect(short).toHaveLength(199);
    expect(detectWidgetable(short, [])).toBeNull();
  });
});

describe('matchAuthored', () => {
  it('matches a declared dataType case-insensitively', () => {
    const widget = { kind: 'sales-card', dataTypes: ['Sales'], usedCount: 2 };
    expect(matchAuthored('sales', [widget])).toBe(widget);
  });

  it('never matches legacy entries without dataTypes', () => {
    expect(matchAuthored('sales', [{ kind: 'legacy-card', usedCount: 99 }])).toBeNull();
  });

  it('selects the most-used candidate', () => {
    const low = { kind: 'low', dataTypes: ['sales'], usedCount: 2 };
    const high = { kind: 'high', dataTypes: ['sales'], usedCount: 8 };
    expect(matchAuthored('sales', [low, high])).toBe(high);
  });
});
