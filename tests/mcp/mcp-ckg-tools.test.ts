import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Minimal fake McpServer capturing server.tool(name, desc, schema, handler).
type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
class FakeServer {
  tools = new Map<string, { description: string; schema: unknown; handler: Handler }>();
  tool(name: string, description: string, schema: unknown, handler: Handler): void {
    this.tools.set(name, { description, schema, handler });
  }
}

const recallHybrid = vi.fn();
const ingest = vi.fn();

vi.mock('../../src/memory/collective-knowledge-graph.js', () => ({
  getCollectiveKnowledgeGraph: () => ({ recallHybrid, ingest }),
}));

async function register() {
  const { registerCkgTools } = await import('../../src/mcp/mcp-ckg-tools.js');
  const s = new FakeServer();
  registerCkgTools(s as unknown as Parameters<typeof registerCkgTools>[0]);
  return s;
}

describe('registerCkgTools', () => {
  beforeEach(() => {
    vi.resetModules();
    recallHybrid.mockReset();
    ingest.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('exposes the collective graph, which memory_search does NOT reach', async () => {
    const s = await register();
    expect(s.tools.has('ckg_recall')).toBe(true);
    expect(s.tools.has('ckg_ingest')).toBe(true);
  });

  it('reports corroboration in plain words — the whole point of a COLLECTIVE graph', async () => {
    // A fact three independent agents reached is not the same as one agent repeating
    // itself. If the output does not say so, the client cannot tell them apart and the
    // shared graph is just a bigger notebook.
    recallHybrid.mockResolvedValue([
      { id: '1', type: 'lesson', name: 'never-prune', text: 'Orphan commits hold real work.',
        salience: 0.9, mentions: 4, confidence: 0.94, corroborations: 3, agentId: 'ministar/fleet', source: 'worklog' },
      { id: '2', type: 'fact', name: 'solo', text: 'Only one agent said this.',
        salience: 0.4, mentions: 1, confidence: 0.6, corroborations: 1 },
    ]);

    const s = await register();
    const out = await s.tools.get('ckg_recall')!.handler({ query: 'prune' });

    const text = out.content[0]!.text;
    expect(text).toContain('corroborated by 3 independent agents');
    expect(text).toContain('asserted by a single agent');
    expect(text).toContain('Orphan commits hold real work.');
    expect(out.isError).toBeUndefined();
  });

  it('passes the type filter through instead of silently ignoring it', async () => {
    recallHybrid.mockResolvedValue([]);
    const s = await register();
    await s.tools.get('ckg_recall')!.handler({ query: 'x', limit: 3, types: ['lesson'] });
    expect(recallHybrid).toHaveBeenCalledWith('x', expect.objectContaining({ limit: 3, types: ['lesson'] }));
  });

  it('says plainly when the graph has nothing, rather than returning an empty success', async () => {
    recallHybrid.mockResolvedValue([]);
    const s = await register();
    const out = await s.tools.get('ckg_recall')!.handler({ query: 'unknown' });
    expect(out.content[0]!.text).toContain('Nothing in the collective graph');
    expect(out.isError).toBeUndefined();
  });

  it('omits absent optional fields so ingest defaults apply', async () => {
    // exactOptionalPropertyTypes is not on yet, so passing `type: undefined` would
    // reach ingest() and could override its default. The keys must be absent.
    ingest.mockResolvedValue({ name: 'n', type: 'fact', corroborations: 1, confidence: 0.8 });
    const s = await register();
    await s.tools.get('ckg_ingest')!.handler({ text: 'A fact.' });

    const arg = ingest.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toEqual({ text: 'A fact.' });
    expect('type' in arg).toBe(false);
    expect('name' in arg).toBe(false);
  });

  it('surfaces a failure as an error instead of a reassuring message', async () => {
    recallHybrid.mockRejectedValue(new Error('ledger unreadable'));
    const s = await register();
    const out = await s.tools.get('ckg_recall')!.handler({ query: 'x' });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain('ledger unreadable');
  });
});
