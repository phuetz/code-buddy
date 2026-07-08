/**
 * Voice-assistant improvement loop — MySoulmate-inspired reflection that makes
 * Lisa a better conversational partner OVER TIME by learning from what she just
 * heard, instead of treating every spoken turn in isolation.
 *
 * One cycle: read the recent HEARD dialogue → REFLECT with one LLM call → apply
 * three kinds of durable learning, each on its own safety tier:
 *   1. `guidance`  — a short behavioural nudge ("garde des réponses courtes")
 *                    → the bounded, reversible voice-guidance store, injected
 *                    into future replies via buildRelationalContext.  (low stakes)
 *   2. `signal`    — the conversation's emotional tone → a BOUNDED trait drift
 *                    (`evolveTraits`, anti-ratchet) of Lisa's relationship state.
 *   3. `facts`     — durable working preferences about the user → PROPOSED into
 *                    the privacy-screened `LocalUserModel` (pending); only an
 *                    explicit human `--apply` accepts them (never the heartbeat).
 *
 * Modes: 'dry' (report only), 'behavioral' (guidance + drift; the heartbeat
 * default — safe, no personal-fact writes), 'all' (also accept facts; CLI
 * `--apply` = explicit human review). Opt-in, injectable, never-throws — a
 * failure is a skipped cycle, never a crash.
 *
 * @module companion/voice-improvement-loop
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
import {
  loadRelationshipState,
  saveRelationshipState,
  evolveTraits,
  type RelationalSignal,
} from './relationship-state.js';
import {
  loadVoiceGuidance,
  saveVoiceGuidance,
  addVoiceGuidance,
  defaultVoiceGuidancePath,
} from './voice-guidance.js';

export type VoiceImprovementMode = 'dry' | 'behavioral' | 'all';

const VALID_SIGNALS: readonly RelationalSignal[] = [
  'affection',
  'gratitude',
  'joking',
  'deep-talk',
  'debugging-together',
  'frustration',
  'neutral',
];

export interface VoiceReflection {
  /** Durable working preferences about the user (short, no sensitive data). */
  facts: string[];
  /** One imperative line on how to reply better next time ('' when none). */
  guidance: string;
  /** The conversation's emotional tone, for a bounded trait drift. */
  signal: RelationalSignal;
}

export interface VoiceImprovementResult {
  at: number;
  /** How many heard utterances the reflection was based on. */
  heardCount: number;
  reflection: VoiceReflection;
  /** Facts newly PROPOSED (pending human review) this cycle. */
  proposedFacts: string[];
  /** Facts ACCEPTED into the user model this cycle (mode 'all' only). */
  acceptedFacts: string[];
  /** True when the guidance line was written to the store. */
  guidanceApplied: boolean;
  /** True when the trait drift was persisted. */
  driftApplied: boolean;
}

export interface VoiceImprovementDeps {
  now?: number;
  cwd?: string;
  /** How many recent heard utterances to reflect on. Default 20. */
  limit?: number;
  /** 'dry' | 'behavioral' (heartbeat) | 'all' (human --apply). Default 'behavioral'. */
  mode?: VoiceImprovementMode;
  /** Injectable: read recent heard dialogue. Default: hearing percepts. */
  readHeard?: (limit: number, cwd?: string) => Promise<string[]>;
  /** Injectable: reflect on the dialogue → learnings. Default: one LLM JSON call ($0). */
  reflect?: (heard: string[]) => Promise<VoiceReflection | null>;
  /** Override the guidance store path (tests). */
  guidancePath?: string;
  /** Override the relationship-state path (tests). */
  relationshipStatePath?: string;
}

const REFLECT_SYSTEM =
  "Tu es le module de réflexion d'un assistant vocal (Lisa) qui cherche à mieux converser avec son utilisateur au fil du temps. " +
  "À partir de ce que l'utilisateur a dit récemment, produis un JSON STRICT :\n" +
  '{"facts": string[], "guidance": string, "signal": string}\n' +
  '- "facts" : 0 à 3 PRÉFÉRENCES DE TRAVAIL durables et utiles (ex: « préfère des réponses courtes », « aime qu\'on aille droit au but », « travaille surtout le soir »). ' +
  'PAS de données sensibles (santé, finances, relations, religion, politique, identifiants). Phrases courtes. [] si rien de fiable.\n' +
  '- "guidance" : UNE consigne impérative et courte pour mieux lui répondre la prochaine fois (ex: « Réponds en une à deux phrases. »). "" si rien.\n' +
  '- "signal" : le ton de la conversation, parmi exactement : affection, gratitude, joking, deep-talk, debugging-together, frustration, neutral.\n' +
  'Réponds UNIQUEMENT le JSON, sans texte autour.';

/** Coerce a raw parsed object into a clean VoiceReflection. Pure/testable. */
export function normalizeReflection(raw: unknown): VoiceReflection {
  const o = (raw ?? {}) as Record<string, unknown>;
  const facts = Array.isArray(o.facts)
    ? o.facts
        .map((f) => (typeof f === 'string' ? f.trim() : ''))
        .filter((f) => f.length > 0 && f.length <= 160)
        .slice(0, 3)
    : [];
  const guidance = typeof o.guidance === 'string' ? o.guidance.trim().slice(0, 200) : '';
  const sigRaw = typeof o.signal === 'string' ? o.signal.trim().toLowerCase() : '';
  const signal = (VALID_SIGNALS as readonly string[]).includes(sigRaw)
    ? (sigRaw as RelationalSignal)
    : 'neutral';
  return { facts, guidance, signal };
}

/** Default heard source — recent hearing percepts (mirrors episodic-journal). */
async function defaultReadHeard(limit: number, cwd?: string): Promise<string[]> {
  try {
    const { readRecentCompanionPercepts } = await import('./percepts.js');
    const heard = await readRecentCompanionPercepts({
      modality: 'hearing',
      limit,
      ...(cwd ? { cwd } : {}),
    });
    return heard
      .map((h) =>
        String((h.payload as { text?: string })?.text ?? h.summary ?? '').replace(/^Heard:\s*/i, '')
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Default reflection — one JSON LLM call via the resolved command provider ($0 on ChatGPT-OAuth). */
async function defaultReflect(heard: string[]): Promise<VoiceReflection | null> {
  try {
    const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
    const resolved = resolveCommandProvider({});
    if (!resolved) return null;
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);
    const { generateJsonWithRetry } = await import('../utils/llm-retry.js');
    const user = `Conversation récente (ce que la personne a dit) :\n${heard.map((h) => `- ${h}`).join('\n')}`;
    const gen = (prompt: string): Promise<string> =>
      client
        .chat(
          [
            { role: 'system', content: REFLECT_SYSTEM },
            { role: 'user', content: prompt },
          ],
          undefined,
          { responseFormat: 'json' }
        )
        .then((r) => r?.choices?.[0]?.message?.content ?? '');
    const parsed = await generateJsonWithRetry<unknown>(gen, user);
    return normalizeReflection(parsed);
  } catch (err) {
    logger.info(
      `[voice-improve] reflection unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

function defaultJournalPath(cwd?: string): string {
  return join(cwd ?? homedir(), '.codebuddy', 'companion', 'voice-improvements.jsonl');
}

/** Append an audit line, rotating at 512 KB (mirrors dreaming/episodic-journal). Never throws. */
function appendJournal(result: VoiceImprovementResult, cwd?: string): void {
  try {
    const path = defaultJournalPath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    try {
      if (statSync(path).size > 512 * 1024) renameSync(path, `${path}.1`);
    } catch {
      /* no file yet */
    }
    appendFileSync(path, `${JSON.stringify(result)}\n`);
  } catch {
    /* best-effort */
  }
}

/**
 * Run one voice-assistant improvement cycle. Returns the result, or null when
 * there was nothing to reflect on (too little heard / no LLM). Never throws.
 */
export async function runVoiceImprovementCycle(
  deps: VoiceImprovementDeps = {}
): Promise<VoiceImprovementResult | null> {
  const now = deps.now ?? Date.now();
  const mode: VoiceImprovementMode = deps.mode ?? 'behavioral';
  const heard = await (deps.readHeard ?? defaultReadHeard)(deps.limit ?? 20, deps.cwd);
  // Need a couple of real utterances to say anything useful.
  if (heard.length < 2) return null;

  const reflection = await (deps.reflect ?? defaultReflect)(heard);
  if (!reflection) return null;

  const result: VoiceImprovementResult = {
    at: now,
    heardCount: heard.length,
    reflection,
    proposedFacts: [],
    acceptedFacts: [],
    guidanceApplied: false,
    driftApplied: false,
  };

  // 1. Facts → propose into the privacy-screened user model (pending). Accept
  //    ONLY in mode 'all' (an explicit human --apply); the heartbeat never accepts.
  if (reflection.facts.length > 0) {
    try {
      const { getUserModel } = await import('../memory/user-model.js');
      const model = getUserModel(deps.cwd ?? process.cwd());
      for (const fact of reflection.facts) {
        try {
          const { observation, deduped } = model.observe({
            kind: 'preference',
            content: fact,
            source: 'self_observed',
            confidence: 0.6,
          });
          if (!deduped) result.proposedFacts.push(fact);
          if (mode === 'all') {
            model.accept(observation.id, {
              reviewedBy: 'voice-improve-loop',
              reviewNote: 'accepté via `buddy assistant improve --apply`',
            });
            result.acceptedFacts.push(fact);
          }
        } catch {
          /* privacy screen refused this fact, or already accepted — skip it */
        }
      }
    } catch {
      /* user model unavailable — skip facts */
    }
  }

  // 2. Guidance → bounded, reversible store (applied in 'behavioral' and 'all').
  if (reflection.guidance && mode !== 'dry') {
    try {
      const path = deps.guidancePath ?? defaultVoiceGuidancePath();
      const next = addVoiceGuidance(reflection.guidance, now, loadVoiceGuidance(path));
      saveVoiceGuidance(next, path);
      result.guidanceApplied = true;
    } catch {
      /* best-effort */
    }
  }

  // 3. Signal → bounded trait drift (anti-ratchet), applied in 'behavioral' and 'all'.
  if (mode !== 'dry') {
    try {
      const state = loadRelationshipState(deps.relationshipStatePath);
      saveRelationshipState(evolveTraits(state, reflection.signal), deps.relationshipStatePath);
      result.driftApplied = true;
    } catch {
      /* best-effort */
    }
  }

  appendJournal(result, deps.cwd);
  logger.info(
    `[voice-improve] cycle: ${heard.length} heard → ${reflection.facts.length} fact(s), ` +
      `guidance=${result.guidanceApplied ? 'yes' : 'no'}, signal=${reflection.signal}, mode=${mode}`
  );
  return result;
}
