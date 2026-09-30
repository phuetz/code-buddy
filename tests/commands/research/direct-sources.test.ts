/**
 * Direct (simple) research must keep the consulted URLs in a trailing
 * "## Sources" section — the non-interactive path used to return a
 * sourceless LLM essay.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  appendDirectResearchSources,
  runDirectResearch,
  resolveDirectResearchTimeoutMs,
} from '../../../src/commands/research/index.js';

describe('appendDirectResearchSources', () => {
  it('appends a Sources section with consulted URLs', () => {
    const out = appendDirectResearchSources('# Report\n\nPipeWire attenuates output.', [
      { title: 'PipeWire wiki', url: 'https://gitlab.freedesktop.org/pipewire/pipewire' },
      { title: 'Arch Wiki', url: 'https://wiki.archlinux.org/title/PipeWire' },
    ]);
    expect(out).toContain('## Sources');
    expect(out).toContain('https://gitlab.freedesktop.org/pipewire/pipewire');
    expect(out).toContain('https://wiki.archlinux.org/title/PipeWire');
  });

  it('dedups URLs and ignores empty ones', () => {
    const out = appendDirectResearchSources('body', [
      { title: 'A', url: 'https://a.example/' },
      { title: 'A again', url: 'https://a.example/' },
      { title: 'nope', url: '' },
    ]);
    expect(out.match(/https:\/\/a\.example\//g)).toHaveLength(1);
    expect(out).not.toContain('nope');
  });
});

describe('runDirectResearch', () => {
  it('labels search excerpts and never claims to have read the linked pages', async () => {
    const chat = vi.fn(async () => 'A limited synthesis.');
    const report = await runDirectResearch('topic', { timeoutMs: 5000,
      search: async () => [{ title: 'A', url: 'https://a.example/', snippet: 'Observed excerpt' }], chat });
    expect(chat.mock.calls[0]?.[0].map((m: { content: string }) => m.content).join('\n')).toContain('Search excerpts');
    expect(report).toContain('pages linked below were not fetched');
  });
  it('aborts the active provider request on timeout', async () => {
    let observed: AbortSignal | undefined;
    await expect(runDirectResearch('topic', { timeoutMs: 10,
      search: async () => [{ title: 'A', url: 'https://a.example/' }],
      chat: async (_messages, signal) => { observed = signal; return new Promise(() => {}); },
    })).rejects.toThrow('timed out');
    expect(observed?.aborted).toBe(true);
  });
  it('allows local synthesis beyond 120 seconds while respecting an explicit overall deadline', () => {
    expect(resolveDirectResearchTimeoutMs(300000, true, {})).toBe(300000);
    expect(resolveDirectResearchTimeoutMs(300000, false, {})).toBe(120000);
    expect(resolveDirectResearchTimeoutMs(60000, true, {})).toBe(60000);
    expect(resolveDirectResearchTimeoutMs(300000, true, { CODEBUDDY_DIRECT_RESEARCH_TIMEOUT_MS: '180000' })).toBe(180000);
  });
  it('keeps consulted URLs even when the model writes no citations', async () => {
    const search = vi.fn(async () => [
      { title: 'PipeWire volume', url: 'https://docs.pipewire.org/volume', snippet: '75%' },
      { title: 'dB vs %', url: 'https://example.com/pipewire-db' },
    ]);
    const chat = vi.fn(async () => 'PipeWire maps 75% to an attenuation curve. No links here.');

    const report = await runDirectResearch('pourquoi PipeWire atténue-t-il une sortie à 75 %', {
      timeoutMs: 5_000,
      search,
      chat,
    });

    expect(search).toHaveBeenCalled();
    expect(report).toContain('## Sources');
    expect(report).toContain('https://docs.pipewire.org/volume');
    expect(report).toContain('https://example.com/pipewire-db');
    expect(chat.mock.calls[0]?.[0].some((m: { content: string }) =>
      m.content.includes('https://docs.pipewire.org/volume'),
    )).toBe(true);
  });

  it.each(['empty', 'failed'])('refuses a source-free essay when search is %s', async (mode) => {
    const chat = vi.fn(async () => 'Invented research.');
    await expect(runDirectResearch('topic', {
      timeoutMs: 5_000,
      search: async () => { if (mode === 'failed') throw new Error('network down'); return []; },
      chat,
    })).rejects.toThrow('NO_RESEARCH_SOURCES');
    expect(chat).not.toHaveBeenCalled();
  });

  it('releases its deadline after a successful synthesis', async () => {
    vi.useFakeTimers();
    try {
      await runDirectResearch('topic', { timeoutMs: 5_000,
        search: async () => [{ title: 'A', url: 'https://a.example/' }],
        chat: async () => 'Cited report.',
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
