/**
 * Tool mutator port — applies/reverts an authored tool across BOTH registries
 * with a proven inverse, so the engine can keep it (auto-apply) or cleanly
 * un-register it (propose-only / rejection):
 *   - FormalToolRegistry  → makes it CALLABLE (dispatch reads this),
 *   - legacy ToolRegistry → makes its schema VISIBLE to the model next turn.
 *
 * @module agent/self-improvement/tool-skill-mutator
 */

import type { CodeBuddyTool } from '../../codebuddy/client.js';
import type { ToolMetadata } from '../../tools/types.js';
import { FormalToolRegistry } from '../../tools/registry/tool-registry.js';
import { getToolRegistry } from '../../tools/registry.js';
import { AUTHORED_PREFIX, buildAuthoredTool, type AuthoredToolSpec } from './authored-tool-runtime.js';
import { AuthoredToolStore } from './authored-tool-store.js';
import { inspectAuthoredCode } from './authored-artifact-gate.js';

export interface ToolMutatorPort {
  register(spec: AuthoredToolSpec): { name: string };
  unregister(name: string): boolean;
  has(name: string): boolean;
  getSpec(name: string): AuthoredToolSpec | null;
}

export interface LiveToolMutatorOptions {
  /** Persist kept tools to disk so they survive a restart (default true). */
  persist?: boolean;
  store?: AuthoredToolStore;
}

/** Dual-registry mutator over the live singletons, with optional disk persistence. */
export class LiveToolMutator implements ToolMutatorPort {
  private readonly persist: boolean;
  private readonly store: AuthoredToolStore;
  private readonly registeredSpecs = new Map<string, AuthoredToolSpec>();

  constructor(options: LiveToolMutatorOptions = {}) {
    this.persist = options.persist ?? true;
    this.store = options.store ?? new AuthoredToolStore();
  }

  register(spec: AuthoredToolSpec): { name: string } {
    // Hard backstop for the namespace invariant: registration uses
    // `override: true`, so a spec named `bash`/`read_file` would silently
    // REPLACE the built-in and route the model's calls to sandboxed authored
    // code (bypassing e.g. the bash command validator). Only the LLM proposer
    // applies `toAuthoredName`; a hand-built ToolProposal, a StaticToolProposer
    // fixture, or a tampered persisted spec would otherwise slip through.
    if (!spec.name.startsWith(AUTHORED_PREFIX)) {
      throw new Error(
        `refusing to register tool "${spec.name}": authored tools must be namespaced "${AUTHORED_PREFIX}*" (never shadow a built-in)`,
      );
    }
    // Même backstop pour la sûreté du code : les appelants légitimes
    // (register_tool, tool-gate) pré-scannent, mais un spec persisté trafiqué
    // ou un appel direct ne doit avoir AUCUN chemin d'enregistrement sans le
    // scan G1. Si le test gardien no-backdoor casse, STOP — sécuriser d'abord.
    const scan = inspectAuthoredCode(spec.code, 'code');
    if (!scan.ok) {
      throw new Error(`refusing to register tool "${spec.name}": ${scan.reasons.join('; ')}`);
    }
    const tool = buildAuthoredTool(spec);
    FormalToolRegistry.getInstance().register(tool, { override: true });
    const definition: CodeBuddyTool = {
      type: 'function',
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters as unknown as CodeBuddyTool['function']['parameters'],
      },
    };
    const metadata: ToolMetadata = {
      name: spec.name,
      category: 'system',
      keywords: ['authored', 'self-extension', 'tool'],
      priority: 5,
      description: spec.description,
    };
    getToolRegistry().registerTool(definition, metadata);
    this.registeredSpecs.set(spec.name, spec);
    if (this.persist) this.store.add(spec);
    return { name: spec.name };
  }

  unregister(name: string): boolean {
    const a = FormalToolRegistry.getInstance().unregister(name);
    const b = getToolRegistry().removeTool(name);
    this.registeredSpecs.delete(name);
    if (this.persist) this.store.remove(name);
    return a || b;
  }

  has(name: string): boolean {
    return FormalToolRegistry.getInstance().has(name) || getToolRegistry().getTool(name) !== undefined;
  }

  getSpec(name: string): AuthoredToolSpec | null {
    return this.registeredSpecs.get(name) ?? this.store.list().find((spec) => spec.name === name) ?? null;
  }
}

/**
 * Re-register persisted authored tools into both registries at startup. Does NOT
 * re-persist (it's loading what's already on disk). Returns the names loaded.
 * Every persisted spec is re-gated by `register`; callers may load it at boot.
 */
export function loadAuthoredTools(workDir?: string): string[] {
  const store = new AuthoredToolStore(workDir ? { workDir } : {});
  const specs = store.list();
  if (specs.length === 0) return [];
  const loader = new LiveToolMutator({ persist: false, store });
  const loaded: string[] = [];
  for (const spec of specs) {
    try {
      loader.register(spec);
      loaded.push(spec.name);
    } catch {
      /* skip a malformed persisted spec */
    }
  }
  return loaded;
}
