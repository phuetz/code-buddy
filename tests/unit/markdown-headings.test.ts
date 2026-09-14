import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import '../../src/ui/utils/markdown-renderer.js';

describe('real terminal markdown heading callbacks', () => {
  it.each([1, 2, 3, 4, 5, 6])('renders heading level %i without an undefined prefix', (level) => {
    const rendered = marked.parse(`${'#'.repeat(level)} Skills installés`) as string;
    expect(rendered).toContain('Skills installés');
    expect(rendered).not.toContain('undefined');
    expect(rendered.match(/Skills installés/g)).toHaveLength(1);
  });
});
