import { describe, expect, it } from 'vitest';
import { renderAnsi } from '../../src/rendering/ansi';

const ESC = String.fromCharCode(27);

describe('renderAnsi', () => {
  it('emits ANSI codes for bold and keeps the text', () => {
    const out = renderAnsi('**bold**');
    expect(out).toContain('bold');
    expect(out).toContain(ESC);
  });

  it('strips ANSI when color is disabled', () => {
    const out = renderAnsi('**bold** and `code`', { color: false });
    expect(out).not.toContain(ESC);
    expect(out).toContain('bold');
    expect(out).toContain('code');
  });

  it('never throws on partial / weird markdown', () => {
    expect(() => renderAnsi('**unclosed `x [y](')).not.toThrow();
  });

  it('handles empty input', () => {
    expect(renderAnsi('')).toBe('');
  });
});
