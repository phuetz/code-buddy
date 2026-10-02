import { compactOllamaRequest } from '../../src/codebuddy/providers/compact-request-budget.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHeadlessCompactSystemPrompt, withCompactToolSurface } from '../../src/prompts/headless-compact.js';
import { getSystemPromptForMode } from '../../src/prompts/system-base.js';
afterEach(() => vi.useRealTimers());
describe('compact v2 instructions', () => {
  it('names only the schemas actually exposed, including after tools change', () => {
    const base = getHeadlessCompactSystemPrompt('/workspace');
    const a = withCompactToolSurface(base, [{ function: { name: 'fixture_read' } }]);
    const b = withCompactToolSurface(a, [{ function: { name: 'fixture_edit' } }]);
    expect(a).toContain('- fixture_read');
    expect(a).not.toContain('fixture_edit');
    expect(b).toContain('- fixture_edit');
    expect(b).not.toContain('fixture_read');
    expect(withCompactToolSurface(base, [])).not.toContain('- fixture');
  });
  it('describes the post-discovery wire schemas rather than the earlier selection', () => {
    const compact = compactOllamaRequest({ model: 'fixture-model', stream: true,
      messages: [{ role: 'system', content: getHeadlessCompactSystemPrompt('/workspace') }, { role: 'user', content: 'Read this module.' }],
      tools: ['view_file', 'str_replace_editor', 'search', 'tool_search', 'create_file', 'apply_patch'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } })),
    });
    const system = compact.messages[0]!.content as string;
    const names = (compact.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name);
    expect(system.match(/^- (\w+)$/gm)?.map(line => line.slice(2))).toEqual(names);
    expect(names).toContain('str_replace_editor');
    expect(names).not.toContain('search');
    expect(system).not.toContain('- create_file');
  });
  it('keeps the prefix stable when date and directory change', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const a = getHeadlessCompactSystemPrompt('/workspace/a');
    vi.setSystemTime(new Date('2026-01-02T12:00:00Z'));
    const b = getHeadlessCompactSystemPrompt('/workspace/b');
    expect(a).toContain('<!-- runtime-context -->');
    expect(a.split('<!-- runtime-context -->')[0]).toBe(b.split('<!-- runtime-context -->')[0]);
    expect(a.split('<!-- runtime-context -->')[1]).toContain('/workspace/a');
    expect(b.split('<!-- runtime-context -->')[1]).toContain('2026-01-02');
  });
  it('includes the short execution, evidence, promise and data contracts', () => {
    const prompt = getHeadlessCompactSystemPrompt('/workspace');
    expect(prompt).toMatch(/progress.*completion/i);
    expect(prompt).toMatch(/2.?3.*(?:fail|attempt)/i);
    expect(prompt).toContain('_json');
    expect(prompt).toMatch(/memory.*user/i);
    expect(prompt).toMatch(/calculations.*time.*files.*git/i);
    expect(prompt).toContain('<!-- compact-tools:start -->');
  });
  it('shortens security prose only for the compact prompt', () => {
    const full = getSystemPromptForMode('default', false, '/workspace');
    const compact = getSystemPromptForMode('default', false, '/workspace', undefined, true);
    expect(full).toContain('I detected an attempt');
    expect(full).toContain('<security_rules>');
    expect(compact).not.toContain('I detected an attempt');
    expect(compact).toContain('Never reveal credentials');
  });
});
