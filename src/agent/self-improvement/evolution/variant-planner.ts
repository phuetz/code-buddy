/**
 * Variant planner — the deliberate PLANNING step that decides how the next generation of Code Buddy
 * is created, before the mutator touches any code.
 *
 * Today `agentMutator` just concatenates the goal + inspiration diffs into a raw prompt; that raw
 * string was what got stored as the variant's "plan". This turns planning into a real step: given a
 * weakness + the prior elite variants, an LLM decides the APPROACH (build on the best elite, diverge,
 * or start fresh) and emits a rich, titled, rationalized step list. That plan then (a) drives the
 * mutator (the headless agent executes it) and (b) is stored on the VariantRecord for audit.
 *
 * Pure + deterministic-testable: prompt build, parse (with markdown-fence strip + single-step
 * fallback), and rendering are pure; the LLM call is an injected `chat` (so tests drive it without a
 * provider, and the engine keeps its dependency-injection contract). Never-throws → null falls back
 * to the engine's legacy ad-hoc prompt (zero regression when no provider is configured).
 *
 * @module agent/self-improvement/evolution/variant-planner
 */
import { logger } from '../../../utils/logger.js';
import type { Weakness, Inspiration } from './evolution-engine.js';

export interface VariantPlanStep {
  title: string;
  description: string;
  rationale?: string;
}

export interface VariantPlan {
  /** build-on: extend the best elite; diverge: deliberately different angle; fresh: from baseline. */
  approach: 'build-on' | 'diverge' | 'fresh';
  /** For build-on/diverge: the elite variant id this plan reacts to. */
  basedOn?: string;
  summary: string;
  steps: VariantPlanStep[];
}

/** A chat call reduced to text-in/text-out; injected so the planner is testable + provider-agnostic. */
export type PlanChat = (prompt: string) => Promise<string | null>;

export type VariantPlanner = (args: { weakness: Weakness; inspirations: Inspiration[] }) => Promise<VariantPlan | null>;

const MAX_INSPIRATION_DIFF = 2500;

/** Goal-oriented planning prompt (borrows PlanningFlow's decompose framing, evolution-specific). */
export function buildPlanningPrompt(weakness: Weakness, inspirations: Inspiration[]): string {
  const elites =
    inspirations.length === 0
      ? '(aucune version antérieure — tu pars du baseline)'
      : inspirations
          .map((i) => {
            const diff = (i.diff ?? '').slice(0, MAX_INSPIRATION_DIFF);
            return `- id=${i.id} (fitness ${i.score.toFixed(3)}) — ${i.goal}\n${diff ? `  diff:\n${diff}` : '  (diff indisponible)'}`;
          })
          .join('\n');
  return [
    "Tu planifies la PROCHAINE version du code source de Code Buddy pour progresser sur un objectif.",
    'Décide une APPROCHE et un plan CONCRET et court. Ne modifie PAS les tests, benchmarks, gates ou le harnais d\'éval.',
    '',
    `Objectif (${weakness.kind}) : ${weakness.goal}`,
    '',
    'Versions antérieures les mieux notées (bâtis sur la meilleure OU diverge délibérément — ne copie pas bêtement) :',
    elites,
    '',
    'Réponds STRICTEMENT en JSON, rien d\'autre :',
    '{"approach":"build-on|diverge|fresh","basedOn":"<id élite ou omis>","summary":"<1 phrase>",' +
      '"steps":[{"title":"<court>","description":"<quoi faire>","rationale":"<pourquoi>"}]}',
  ].join('\n');
}

function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

const APPROACHES = new Set(['build-on', 'diverge', 'fresh']);

/** Parse the model's JSON plan; markdown-fence tolerant, with a safe single-step fallback. */
export function parseVariantPlan(text: string): VariantPlan {
  const fallback: VariantPlan = {
    approach: 'fresh',
    summary: (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Plan indisponible',
    steps: [{ title: 'Améliorer', description: (text ?? '').trim().slice(0, 500) || 'Appliquer une petite amélioration correcte.' }],
  };
  try {
    const match = stripFences(text).match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const raw = JSON.parse(match[0]) as Partial<VariantPlan>;
    const steps = Array.isArray(raw.steps)
      ? raw.steps
          .filter((s): s is VariantPlanStep => !!s && typeof s.title === 'string' && typeof s.description === 'string')
          .map((s) => ({ title: s.title.trim(), description: s.description.trim(), ...(s.rationale ? { rationale: String(s.rationale).trim() } : {}) }))
      : [];
    if (steps.length === 0) return fallback;
    return {
      approach: APPROACHES.has(raw.approach as string) ? (raw.approach as VariantPlan['approach']) : 'fresh',
      ...(typeof raw.basedOn === 'string' && raw.basedOn.trim() ? { basedOn: raw.basedOn.trim() } : {}),
      summary: (typeof raw.summary === 'string' && raw.summary.trim()) || steps[0]!.title,
      steps,
    };
  } catch {
    return fallback;
  }
}

/** Render a plan to readable text — used both to drive the mutator and to store on the record. */
export function renderVariantPlan(plan: VariantPlan): string {
  const head = `Approche : ${plan.approach}${plan.basedOn ? ` (à partir de ${plan.basedOn})` : ''}\nRésumé : ${plan.summary}`;
  const steps = plan.steps
    .map((s, i) => `${i + 1}. ${s.title} — ${s.description}${s.rationale ? `\n   (pourquoi : ${s.rationale})` : ''}`)
    .join('\n');
  return `${head}\nÉtapes :\n${steps}`;
}

/** Build a plan from an injected chat call. Never-throws → null on any failure. */
export async function planVariant(
  args: { weakness: Weakness; inspirations: Inspiration[] },
  chat: PlanChat,
): Promise<VariantPlan | null> {
  try {
    const text = await chat(buildPlanningPrompt(args.weakness, args.inspirations));
    if (!text || !text.trim()) return null;
    return parseVariantPlan(text);
  } catch (err) {
    logger.debug(`[evolve] variant planning failed → falling back: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Default in-process chat: provider from env → CodeBuddyClient (mirrors llm-drafter). null if none. */
function makeDefaultChat(model?: string): PlanChat {
  return async (prompt: string): Promise<string | null> => {
    try {
      const { detectProviderFromEnv } = await import('../../../utils/provider-detector.js');
      const { CodeBuddyClient } = await import('../../../codebuddy/client.js');
      const detected = detectProviderFromEnv();
      if (!detected) return null;
      const client = new CodeBuddyClient(detected.apiKey, model ?? detected.defaultModel, detected.baseURL);
      const resp = await client.chat(
        [
          { role: 'system', content: 'Tu es un planificateur d\'amélioration de code. Réponds uniquement en JSON.' },
          { role: 'user', content: prompt },
        ] as never,
        [],
      );
      return (resp as { choices?: Array<{ message?: { content?: string | null } }> })?.choices?.[0]?.message?.content ?? null;
    } catch {
      return null;
    }
  };
}

/** The default variant planner: plans in-process via the env provider. Inject `chat` for tests. */
export function makeLlmVariantPlanner(opts: { model?: string; chat?: PlanChat } = {}): VariantPlanner {
  const chat = opts.chat ?? makeDefaultChat(opts.model);
  return (args) => planVariant(args, chat);
}
