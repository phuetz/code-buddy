/**
 * Anti-drift invariant: every tool EXPOSED to the LLM in pure interactive chat
 * must be RESOLVABLE by the interactive dispatch path.
 *
 * Two independent registries used to drift apart:
 *   - Exposition  → `initializeToolRegistry()` (src/codebuddy/tools.ts) feeds the
 *     legacy ToolRegistry; `getEnabledTools()` is what the LLM sees.
 *   - Dispatch    → `ToolHandler.initializeRegistry()` populates the
 *     FormalToolRegistry singleton; `executeTool()` resolves a name there (else
 *     the mcp__ / plugin__ prefixes, else the edit_file Morph branch) and
 *     otherwise returns "Unknown tool".
 *
 * When a group was added to exposition but its adapter factory was only wired
 * into the HEADLESS registry (`registry/index.ts createAllToolsAsync` /
 * `registerBuiltinTools`), the tool became callable in `buddy server` /
 * multi-agent runs but NOT in plain interactive chat.
 *
 * This test builds the exposed set via the real exposition API and the dispatch
 * set via the real interactive path ONLY (a fresh ToolHandler — it does NOT call
 * createAllToolsAsync/registerBuiltinTools, which would mask the bug), then
 * asserts zero exposed tool is undispatched.
 */
import { describe, it, expect, vi } from 'vitest';

import { ToolHandler } from '../../src/agent/tool-handler.js';
import {
  FormalToolRegistry,
  getFormalToolRegistry,
} from '../../src/tools/registry/tool-registry.js';
import { initializeToolRegistry } from '../../src/codebuddy/tools.js';
import { getToolRegistry } from '../../src/tools/registry.js';

/**
 * Build a ToolHandler wired for the INTERACTIVE dispatch path only. The
 * constructor calls `initializeRegistry()`, which is the single source of truth
 * for interactive dispatch — no headless createAllToolsAsync/registerBuiltinTools.
 */
function makeInteractiveHandler(): ToolHandler {
  return new ToolHandler({
    checkpointManager: {
      checkpointBeforeCreate: vi.fn(),
      checkpointBeforeEdit: vi.fn(),
    } as never,
    hooksManager: { executeHooks: vi.fn().mockResolvedValue([]) } as never,
    marketplace: { executeTool: vi.fn() } as never,
    repairCoordinator: { isRepairEnabled: vi.fn(() => false) } as never,
  });
}

describe('interactive dispatch ⊇ LLM exposition (anti-drift invariant)', () => {
  it('every exposed tool resolves through an interactive dispatch path', () => {
    // --- Interactive dispatch set (FormalToolRegistry via the interactive path ONLY) ---
    FormalToolRegistry.reset();
    makeInteractiveHandler(); // constructor → initializeRegistry()
    const interactiveDispatchable = new Set(getFormalToolRegistry().getNames());

    // --- Exposed set (what the LLM actually sees) ---
    initializeToolRegistry();
    const exposed = getToolRegistry()
      .getEnabledTools()
      .map((t) => t.function.name);

    // Sanity: exposition is non-trivial (guards against an empty-registry false pass).
    expect(exposed.length).toBeGreaterThan(50);

    /**
     * A tool is dispatchable in interactive chat when it is resolvable by any of
     * the branches in `ToolHandler.executeTool()`:
     *  1. registered in the FormalToolRegistry (`this.registry.has(name)`), OR
     *  2. `edit_file` — handled by the dedicated Morph Fast Apply branch (no
     *     registry entry; degrades to a clear error when MORPH_API_KEY is unset), OR
     *  3. an external `mcp__*` / `plugin__*` tool — resolved dynamically by the
     *     MCP manager / plugin marketplace at runtime (documented exception: these
     *     depend on a live external provider, so they can't be asserted statically).
     */
    const isInteractivelyDispatchable = (name: string): boolean =>
      interactiveDispatchable.has(name) ||
      name === 'edit_file' ||
      name.startsWith('mcp__') ||
      name.startsWith('plugin__');

    const orphans = exposed.filter((name) => !isInteractivelyDispatchable(name)).sort();

    expect(
      orphans,
      `Exposed-but-undispatched tools (would return "Unknown tool" in interactive chat). ` +
        `Register their adapter in ToolHandler.initializeRegistry() (or remove them from ` +
        `the exposition groups in src/codebuddy/tools.ts): ${JSON.stringify(orphans)}`,
    ).toEqual([]);
  });

  it('previously-orphaned tools now resolve through interactive dispatch', () => {
    // These were the drift cases fixed alongside this invariant:
    //  - firecrawl_search/scrape: exposition is env-gated (FIRECRAWL_API_KEY),
    //    so the generic check above skips them when the key is unset — assert
    //    the dispatch adapter is present regardless (latent-orphan guard).
    //  - find_bugs / generate_document: real features that were exported but
    //    never wired into interactive dispatch.
    //  - delegate_agent: single tool reaching the specialized agents.
    FormalToolRegistry.reset();
    makeInteractiveHandler();
    const dispatchable = new Set(getFormalToolRegistry().getNames());

    for (const name of [
      'firecrawl_search',
      'firecrawl_scrape',
      'find_bugs',
      'generate_document',
      'delegate_agent',
    ]) {
      expect(dispatchable.has(name), `${name} must be dispatchable in interactive chat`).toBe(true);
    }
  });
});
