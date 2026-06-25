import { describe, expect, it } from 'vitest';
import { renderPlain } from '../../src/rendering/plain';

describe('renderPlain', () => {
  it('strips bold / italic / inline-code markers', () => {
    expect(renderPlain('**bold** _it_ `c`')).toBe('bold it c');
  });

  it('uppercases headings', () => {
    expect(renderPlain('# Title')).toBe('TITLE');
  });

  it('keeps code-block content verbatim', () => {
    expect(renderPlain('```\nx = 1\n```')).toBe('x = 1');
  });

  it('renders lists with bullets / numbers', () => {
    expect(renderPlain('- a\n- b')).toBe('• a\n• b');
    expect(renderPlain('1. a\n2. b')).toBe('1. a\n2. b');
  });

  it('renders a table aligned in monospace', () => {
    const out = renderPlain('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('A  B');
    expect(out).toContain('1  2');
  });

  it('renders links as "text (url)"', () => {
    expect(renderPlain('[site](https://e.com)')).toBe('site (https://e.com)');
  });

  it('handles empty input', () => {
    expect(renderPlain('')).toBe('');
  });
});
