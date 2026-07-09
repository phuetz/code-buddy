/**
 * Widget engine — the self-learning loop (mirrors the authored-skills/tools
 * engine): resolve a widget for a data payload, and when none exists, GENERATE
 * one on the fly, GATE it (fail-closed), KEEP it under `authored-<kind>/`, and
 * render — so the next time the same `kind` appears it is an instant registry
 * hit. Authored templates are inert Mustache (see template-engine + widget-gate).
 *
 * Opt-in via `CODEBUDDY_WIDGETS=true` (default off ⇒ generation never runs, only
 * curated widgets render). never-throws — any failure falls back to null (the UI
 * shows plain text). Every proposal (kept or rejected) is appended to an audit
 * ledger.
 *
 * @module widgets/widget-engine
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { widgetKind, type WidgetProposal } from './widget-types.js';
import {
  authoredWidgetsDir,
  hasWidgetForData,
  renderWidgetForData,
  resolveWidgetSource,
} from './widget-registry.js';
import { gateWidget } from './widget-gate.js';
import { proposeWidget, type ProposeWidgetDeps } from './widget-proposer.js';

export interface ResolveOrGenerateDeps extends ProposeWidgetDeps {
  /** Human-readable brief passed to the proposer. */
  brief?: string;
  /** Override the propose step (tests). */
  propose?: (kind: string, sample: unknown, brief?: string) => Promise<WidgetProposal | null>;
}

function authoredDir(kind: string, env: NodeJS.ProcessEnv): string {
  return join(authoredWidgetsDir(env), `authored-${kind}`);
}

function ledgerPath(env: NodeJS.ProcessEnv): string {
  return join(authoredWidgetsDir(env), 'archive.jsonl');
}

/** Append a proposal outcome to the audit ledger (append-only). never-throws. */
function recordLedger(entry: Record<string, unknown>, env: NodeJS.ProcessEnv): void {
  try {
    mkdirSync(authoredWidgetsDir(env), { recursive: true });
    appendFileSync(ledgerPath(env), JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  } catch {
    /* audit is best-effort */
  }
}

/** Persist an accepted authored widget template. never-throws (returns false on failure). */
export function keepAuthoredWidget(proposal: WidgetProposal, env: NodeJS.ProcessEnv = process.env): boolean {
  const kind = proposal.kind.trim().toLowerCase();
  // authored-* can NEVER shadow a curated widget.
  if (resolveWidgetSource(kind, env) === 'curated') return false;
  try {
    const dir = authoredDir(kind, env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'widget.html'), proposal.template);
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ kind, source: 'authored', createdAt: Date.now(), brief: proposal.brief ?? null }, null, 2)
    );
    return true;
  } catch {
    return false;
  }
}

/** List authored widget kinds present on disk. */
export function listAuthoredWidgets(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    return readdirSync(authoredWidgetsDir(env), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('authored-'))
      .map((d) => d.name.slice('authored-'.length))
      .filter((k) => existsSync(join(authoredWidgetsDir(env), `authored-${k}`, 'widget.html')));
  } catch {
    return [];
  }
}

/** Read an authored widget's raw template (or null). */
export function readAuthoredTemplate(kind: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const p = join(authoredDir(kind.trim().toLowerCase(), env), 'widget.html');
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a widget document for `data`; if none exists and generation is enabled,
 * author one, gate it, keep it, then render. Returns the full HTML doc or null.
 * never-throws.
 */
export async function resolveOrGenerate(
  data: unknown,
  deps: ResolveOrGenerateDeps = {}
): Promise<string | null> {
  const env = deps.env ?? process.env;
  try {
    // Registry hit (curated or an already-authored kind) → render immediately.
    if (hasWidgetForData(data, env)) {
      return renderWidgetForData(data, env);
    }

    // Miss. Generation is strictly opt-in.
    if (env.CODEBUDDY_WIDGETS !== 'true') return null;

    const kind = widgetKind(data)?.toLowerCase();
    if (!kind) return null;

    const propose = deps.propose ?? ((k, s, b) => proposeWidget(k, s, b, deps));
    const proposal = await propose(kind, data, deps.brief);
    if (!proposal) {
      recordLedger({ kind, accepted: false, reason: 'no-proposal' }, env);
      return null;
    }

    const verdict = gateWidget(proposal);
    if (!verdict.accepted) {
      recordLedger({ kind, accepted: false, reason: verdict.reason, reasons: verdict.reasons }, env);
      return null;
    }

    const kept = keepAuthoredWidget(proposal, env);
    recordLedger({ kind, accepted: kept, reason: kept ? 'kept' : 'keep-failed' }, env);
    if (!kept) return null;

    // Render fresh from the newly-kept authored template.
    return renderWidgetForData(data, env);
  } catch {
    return null;
  }
}
