/**
 * Tool-surface gate (jarvis-OS-style baseline snapshot, 2026-07-07).
 *
 * Two invariants, born from the 2026-07-04 interconnection audit that found
 * whole tool groups exposed to the LLM but resolving to "Unknown tool" in
 * interactive chat (spotify/kanban/…):
 *
 * 1. `interactive dispatch ⊇ LLM exposition` — every built-in tool the model
 *    can see must be executable by ToolHandler's FormalToolRegistry path.
 * 2. The exposed surface matches a committed baseline — adding/removing/
 *    renaming an exposed tool is a conscious, reviewed act:
 *      npx tsx scripts/update-tool-surface-baseline.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Dynamic registrations must not leak into the committed built-in surface.
// These flags must run before the module-singleton initialization below.
delete process.env.CODEBUDDY_SELF_IMPROVE;
process.env.CODEBUDDY_LOAD_AUTHORED_TOOLS = 'false';

const { initializeToolRegistry } = await import('../../src/codebuddy/tools.js');
const { getToolRegistry } = await import('../../src/tools/registry.js');
const { createInteractiveToolAdapters } = await import('../../src/tools/registry/interactive-adapters.js');
const { TOOL_METADATA } = await import('../../src/tools/metadata.js');
const { TOOL_ALIASES } = await import('../../src/tools/registry/tool-aliases.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let exposed: string[] = [];

beforeAll(() => {
  initializeToolRegistry();
  exposed = getToolRegistry()
    .getAllTools()
    .map((t) => t.function.name)
    .sort();
});

describe('tool surface (exposition ↔ dispatch)', () => {
  it('exposes a sane number of built-in tools', () => {
    expect(exposed.length).toBeGreaterThan(100);
  });

  it('every LLM-exposed tool is dispatchable in interactive chat (dispatch ⊇ exposed)', () => {
    // Force both optional groups on: the test asserts the invariant on the
    // superset dispatch list, independent of host platform and env.
    const dispatchable = new Set(
      createInteractiveToolAdapters({
        includeWindowsTools: true,
        includeSelfImproveTools: true,
        includeContextZoomTools: true,
      }).map((t) => t.name),
    );
    // ToolHandler.executeTool handles these before the registry lookup.
    dispatchable.add('edit_file'); // Morph Fast Apply special-case branch

    const missing = exposed.filter((name) => !dispatchable.has(name));
    expect(
      missing,
      `Tools exposed to the LLM but NOT dispatchable in interactive chat ` +
        `(they would resolve to "Unknown tool"): ${missing.join(', ')}\n` +
        `Register a dispatch adapter in src/tools/registry/interactive-adapters.ts ` +
        `(see the 2026-07-04 interconnection-audit note in that file).`,
    ).toEqual([]);
  });

  it('exposed tool surface matches the committed baseline', () => {
    const baselinePath = path.join(__dirname, 'tool-surface.baseline.txt');
    const baseline = fs.readFileSync(baselinePath, 'utf8').split('\n').filter(Boolean);

    const baselineSet = new Set(baseline);
    const exposedSet = new Set(exposed);
    const added = exposed.filter((n) => !baselineSet.has(n));
    const removed = baseline.filter((n) => !exposedSet.has(n));

    expect(
      { added, removed },
      `Exposed tool surface drifted from tests/tools/tool-surface.baseline.txt.\n` +
        `If this change is intentional, regenerate the baseline and commit it:\n` +
        `  npx tsx scripts/update-tool-surface-baseline.ts\n` +
        `added: ${added.join(', ') || '(none)'}\nremoved: ${removed.join(', ') || '(none)'}`,
    ).toEqual({ added: [], removed: [] });
  });

  // Audit 2026-09-02 — invariant inverse (famille « enregistré d'un côté,
  // jamais consommé de l'autre ») : tout nom qu'un `alwaysInclude` de
  // production force dans la sélection doit EXISTER dans la surface exposée.
  // Le sélecteur (`tool-selector.ts`) ignore silencieusement un alwaysInclude
  // absent de la toolMap — `apply_patch` (exigé par WritePolicy strict) et
  // `memory_propose` (ordonné par le prompt système) sont restés inatteignables
  // ainsi jusqu'à cet audit.
  it('every production alwaysInclude name is actually exposed (alwaysInclude ⊆ exposed)', async () => {
    const { DEFAULT_TOOL_SELECTION_CONFIG } = await import(
      '../../src/agent/execution/tool-selection-strategy.js'
    );
    // Liste du profil « improve » d'agent-executor.ts (~1360) — dupliquée ici
    // à dessein : si elle change là-bas sans exister ici, le test du baseline
    // ne verra rien, celui-ci doit être mis à jour consciemment.
    const improveProfile = ['self_describe', 'view_file', 'search', 'apply_patch', 'bash'];
    const exposedSet = new Set(exposed);
    // `edit_file` est dispatché par une branche spéciale (Morph), gaté env.
    const wanted = [
      ...new Set([...(DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude ?? []), ...improveProfile]),
    ].filter((n) => n !== 'edit_file');
    const missing = wanted.filter((n) => !exposedSet.has(n));
    expect(
      missing,
      `Noms forcés par alwaysInclude mais ABSENTS de la surface exposée au LLM ` +
        `(le sélecteur les ignore en silence) : ${missing.join(', ')}`,
    ).toEqual([]);
  });
});

/**
 * Audit 2026-09-02 (R9 / never-tools) — invariant inverse de
 * « dispatch ⊇ exposed » : un adaptateur enregistré AVEC métadonnées RAG
 * doit avoir une définition OpenAI, sinon le modèle ne peut jamais
 * l'appeler (toolMap du sélecteur ignore le nom). Les seules exceptions
 * sont cette allowlist EXPLICITE et commentée — ne pas y ajouter un
 * nouvel adaptateur pour faire taire le test : écrire la définition.
 *
 * Gates d'environnement (`context_expand`, `edit_file`, `firecrawl_*`,
 * `office_macro_execute`, `workspace_*`) ont déjà une définition au
 * catalogue (`getAllTools`) : elles ne figurent pas ici.
 * Les alias Codex (`TOOL_ALIASES`) héritent schéma + M de la cible : ils
 * ne sont pas des définitions primaires, vérifiés à part.
 * Les surfaces legacy (`browser_action`, `gui_control`, `ocr_extract`, …)
 * n'ont pas d'entrée M centrale — la capacité est exposée sous le nom
 * unifié (`browser`, `computer_control`, `ocr`).
 */
const ADAPTER_WITH_METADATA_WITHOUT_DEFINITION = new Set<string>([
  // Dynamic: schema injected only when the App Studio prompt marker is present
  // (src/agent/execution/tool-selection-strategy.ts). Not in the default catalog.
  'design_system',
]);

/** TOOL_METADATA names with neither adapter nor schema. Cleanup is out of R9. */
const ORPHAN_METADATA_WITHOUT_ADAPTER = new Set<string>([
  'csv_analyze',
  'terminate',
]);

describe('tool surface (adapter + metadata ⇒ definition)', () => {
  const catalog = () => new Set(exposed);
  const dispatchable = () => {
    const names = new Set(
      createInteractiveToolAdapters({
        includeWindowsTools: true,
        includeSelfImproveTools: true,
      includeContextZoomTools: true,
      }).map((t) => t.name),
    );
    names.add('edit_file');
    return names;
  };
  const metadata = () => new Set(TOOL_METADATA.map((entry) => entry.name));

  it('every LLM-exposed tool has TOOL_METADATA (exposed ⊆ M)', () => {
    const missing = exposed.filter((name) => !metadata().has(name));
    expect(
      missing,
      `Outils exposés au LLM SANS entrée TOOL_METADATA (RAG/BM25 muet) : ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every adapter with metadata has an OpenAI definition, except the explicit allowlist', () => {
    const cat = catalog();
    const meta = metadata();
    const missing = [...dispatchable()].filter(
      (name) =>
        meta.has(name) &&
        !cat.has(name) &&
        !ADAPTER_WITH_METADATA_WITHOUT_DEFINITION.has(name),
    ).sort();
    expect(
      missing,
      `Adaptateurs dispatchables AVEC métadonnées mais SANS définition OpenAI ` +
        `(le modèle ne peut jamais les appeler ; famille apply_patch/R9) : ${missing.join(', ')}\n` +
        `Écrire une définition dans src/codebuddy/tool-definitions/ — ne pas élargir l'allowlist.`,
    ).toEqual([]);
  });

  it('allowlist names stay metadata-only (drop them once they gain a definition)', () => {
    const cat = catalog();
    const meta = metadata();
    const stale = [...ADAPTER_WITH_METADATA_WITHOUT_DEFINITION]
      .filter((name) => !meta.has(name) || cat.has(name))
      .sort();
    expect(
      stale,
      `Allowlist périmée (plus dans M, ou désormais au catalogue) : ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('orphan TOOL_METADATA names are exactly the reviewed list (M ⊆ X except orphans)', () => {
    const names = dispatchable();
    const unexpected = [...metadata()]
      .filter((name) => !names.has(name) && !ORPHAN_METADATA_WITHOUT_ADAPTER.has(name))
      .sort();
    const stale = [...ORPHAN_METADATA_WITHOUT_ADAPTER]
      .filter((name) => names.has(name) || !metadata().has(name))
      .sort();
    expect(
      { unexpected, stale },
      `Métadonnées sans adaptateur hors allowlist, ou allowlist orpheline périmée.\n` +
        `unexpected: ${unexpected.join(', ') || '(none)'}\n` +
        `stale: ${stale.join(', ') || '(none)'}`,
    ).toEqual({ unexpected: [], stale: [] });
  });

  it('every Codex alias and its target is dispatchable', () => {
    const names = dispatchable();
    const broken = Object.entries(TOOL_ALIASES)
      .filter(([alias, target]) => !names.has(alias) || !names.has(target))
      .map(([alias, target]) => `${alias}→${target}`);
    expect(
      broken,
      `Alias Codex dont l'alias ou la cible n'est pas dispatchable : ${broken.join(', ')}`,
    ).toEqual([]);
  });
});
