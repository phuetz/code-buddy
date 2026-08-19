/**
 * Development plan derived from an app prompt (bolt.new's "plan" step). A
 * deterministic, offline planner: it reads the description, infers the stack and
 * the features, and emits an ordered checklist of build steps. Pure + testable;
 * an LLM planner can replace/augment it later without changing the UI.
 */
export type PlanStepStatus = 'pending' | 'active' | 'done';

export interface PlanStep {
  id: string;
  title: string;
  detail?: string;
  status: PlanStepStatus;
  /** Path keywords whose appearance in a changed file marks this step done. */
  match?: string[];
}

export interface DevPlan {
  title: string;
  stack: string;
  steps: PlanStep[];
}

interface FeatureRule {
  keys: string[];
  title: string;
  detail: string;
}

// Ordered so the plan reads naturally (structure → data → interactions).
const FEATURE_RULES: FeatureRule[] = [
  { keys: ['todo', 'tâche', 'tache', 'task'], title: 'Task list', detail: 'Add, complete and remove items.' },
  { keys: ['auth', 'login', 'connexion', 'sign in', 'signin'], title: 'Authentication', detail: 'Sign-in screen and user state.' },
  { keys: ['dashboard', 'tableau de bord'], title: 'Dashboard', detail: 'Overview with summary cards.' },
  { keys: ['chart', 'graph', 'graphique', 'courbe'], title: 'Charts', detail: 'Charts for the key data.' },
  { keys: ['table', 'tableau', 'grid', 'grille'], title: 'Data table', detail: 'Sortable, filterable columns.' },
  { keys: ['form', 'formulaire'], title: 'Form', detail: 'Validated fields and submission.' },
  { keys: ['calendar', 'calendrier', 'agenda'], title: 'Calendar', detail: 'Monthly view and events.' },
  { keys: ['chat', 'messagerie', 'message'], title: 'Messaging', detail: 'Message thread and composer.' },
  { keys: ['map', 'carte', 'géo', 'geo'], title: 'Map', detail: 'Map rendering and markers.' },
  { keys: ['cart', 'panier', 'shop', 'boutique', 'ecommerce', 'e-commerce'], title: 'Cart & products', detail: 'Catalog and cart.' },
  { keys: ['gallery', 'galerie', 'photo', 'image'], title: 'Gallery', detail: 'Responsive media grid.' },
  { keys: ['timer', 'minuteur', 'chrono', 'pomodoro'], title: 'Timer', detail: 'Countdown and controls.' },
  { keys: ['blog', 'article', 'cms'], title: 'Articles', detail: 'List and article page.' },
  { keys: ['landing', 'vitrine', 'portfolio'], title: 'Landing sections', detail: 'Hero, features and footer.' },
];

function detectStack(p: string): { stack: string; scaffold: string } {
  if (/\bnext(\.js)?\b/.test(p)) return { stack: 'Next.js', scaffold: 'Initialize the Next.js project' };
  if (/\bvue\b/.test(p)) return { stack: 'Vue + Vite', scaffold: 'Initialize the Vue project (Vite)' };
  if (/\bsvelte\b/.test(p)) return { stack: 'SvelteKit', scaffold: 'Initialize the Svelte project' };
  return { stack: 'React + Vite', scaffold: 'Initialize the project (Vite + React)' };
}

function titleFrom(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'New app';
  const firstClause = trimmed.split(/[.,\n]/)[0]!.slice(0, 60).trim();
  return firstClause.charAt(0).toUpperCase() + firstClause.slice(1);
}

/** Build an ordered development plan from a free-text app description. */
export function buildDevPlan(prompt: string): DevPlan {
  const p = (prompt ?? '').toLowerCase();
  const { stack, scaffold } = detectStack(p);

  const steps: PlanStep[] = [];
  const push = (id: string, title: string, detail?: string, match?: string[]): void => {
    steps.push({ id, title, ...(detail ? { detail } : {}), status: 'pending', ...(match ? { match } : {}) });
  };

  push('scaffold', scaffold, 'Structure, dependencies and entry point.');

  const seen = new Set<string>();
  for (const rule of FEATURE_RULES) {
    if (rule.keys.some((k) => p.includes(k)) && !seen.has(rule.title)) {
      seen.add(rule.title);
      push(`feat-${slug(rule.title)}`, `Build: ${rule.title}`, rule.detail, [slug(rule.title), ...rule.keys]);
    }
  }
  if (seen.size === 0) {
    push('feat-core', 'Build the main interface', 'Components and layout from the description.');
  }

  if (/\b(dark|sombre|night)\b/.test(p)) {
    push('theme-dark', 'Add the dark theme', 'Palette and light/dark toggle.', ['theme', 'dark', 'sombre']);
  } else if (/\b(couleur|color|brand|thème|theme|palette|design)\b/.test(p)) {
    push('theme', 'Apply the theme & branding', 'Colors, typography and spacing.', ['theme', 'style', 'brand']);
  }

  push('wire', 'Wire up state & navigation', 'Connect the components and the data.');
  push('run', 'Launch the preview', 'Start the dev server and show the result.');
  push('verify', 'Verify with web_test', 'Browser verification by Code Buddy: console/page errors + assertions.');

  return { title: titleFrom(prompt), stack, steps };
}

export interface PlanSignals {
  /** The project tree has files → scaffolding happened. */
  hasFiles: boolean;
  /** The dev server is serving the app. */
  previewRunning: boolean;
  /** The agent is mid-turn (building). */
  busy: boolean;
  /** Paths the agent created/edited — completes a matching feature step. */
  changedPaths?: string[];
}

/**
 * Reflect real project state into step statuses (bolt.new's plan advances as it
 * builds). Honest by construction: scaffold (files exist), run (preview
 * running), and a feature step whose keyword appears in a changed file path are
 * marked done; the first still-pending step is shown active while building.
 */
export function advancePlan(plan: DevPlan, s: PlanSignals): DevPlan {
  const steps = plan.steps.map((step) => ({ ...step }));
  const find = (id: string): PlanStep | undefined => steps.find((x) => x.id === id);
  const paths = (s.changedPaths ?? []).map((p) => p.toLowerCase());

  const scaffold = find('scaffold');
  if (scaffold) scaffold.status = s.hasFiles ? 'done' : s.busy ? 'active' : 'pending';

  // A feature/theme step is done when a changed file path matches its keywords.
  for (const step of steps) {
    if (step.match && step.status !== 'done' && step.match.some((k) => paths.some((p) => p.includes(k)))) {
      step.status = 'done';
    }
  }

  if (s.previewRunning) {
    // App is built + served; everything up to run is done. Verifying is the
    // actionable next step (the user clicks "Vérifier" → Code Buddy web_test).
    for (const step of steps) if (step.id !== 'run' && step.id !== 'verify') step.status = 'done';
  }

  const run = find('run');
  if (run) run.status = s.previewRunning ? 'done' : 'pending';

  const verify = find('verify');
  if (verify) verify.status = s.previewRunning ? 'active' : 'pending';

  if (s.busy) {
    const firstPending = steps.find((x) => x.status === 'pending' && x.id !== 'run' && x.id !== 'verify');
    if (firstPending) firstPending.status = 'active';
  }

  return { ...plan, steps };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ---------------------------------------------------------------------------
// LLM plan — the agent emits its own development plan as a fenced ```plan
// JSON block at the start of its reply (asked by buildAiGenerationPrompt).
// Parsed + normalized here; the deterministic buildDevPlan stays the fallback.
// ---------------------------------------------------------------------------

const PLAN_BLOCK_RE = /```plan\s*\n([\s\S]*?)```/;

/** Max steps an LLM plan may carry (keeps the card readable). */
const MAX_LLM_STEPS = 12;

/**
 * Parse a ```plan fenced JSON block out of an assistant reply into a DevPlan.
 * Normalized so `advancePlan` semantics hold: the first step anchors as
 * `scaffold` when no step claims that id, and `run`/`verify` steps are
 * appended when missing. Returns null when there is no valid block.
 */
export function parsePlanBlock(text: string): DevPlan | null {
  const match = (text ?? '').match(PLAN_BLOCK_RE);
  if (!match) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]!);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || !obj.title.trim()) return null;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return null;

  const steps: PlanStep[] = [];
  for (const entry of obj.steps.slice(0, MAX_LLM_STEPS)) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    if (typeof s.title !== 'string' || !s.title.trim()) continue;
    const id = typeof s.id === 'string' && s.id.trim() ? slug(s.id) : slug(s.title);
    if (!id || steps.some((x) => x.id === id)) continue;
    const matchKeys = Array.isArray(s.match)
      ? s.match.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map((k) => k.toLowerCase())
      : [];
    steps.push({
      id,
      title: s.title.trim(),
      ...(typeof s.detail === 'string' && s.detail.trim() ? { detail: s.detail.trim() } : {}),
      status: 'pending',
      ...(matchKeys.length > 0 ? { match: matchKeys } : {}),
    });
  }
  if (steps.length === 0) return null;

  if (!steps.some((s) => s.id === 'scaffold')) steps[0]!.id = 'scaffold';
  if (!steps.some((s) => s.id === 'run')) {
    steps.push({ id: 'run', title: 'Launch the preview', detail: 'Start the dev server and show the result.', status: 'pending' });
  }
  if (!steps.some((s) => s.id === 'verify')) {
    steps.push({ id: 'verify', title: 'Verify with web_test', detail: 'Browser verification by Code Buddy: console/page errors + assertions.', status: 'pending' });
  }

  const stack = typeof obj.stack === 'string' && obj.stack.trim() ? obj.stack.trim() : 'Web app';
  return { title: obj.title.trim().slice(0, 60), stack, steps };
}

/** Remove ```plan blocks from a reply's visible text (the card renders them). */
export function stripPlanBlocks(text: string): string {
  return text.replace(/```plan\s*\n[\s\S]*?```/g, '').trim();
}

export interface PlanSourceMessage {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/**
 * The most recent LLM-emitted plan in a session: the streaming partial reply
 * wins (live plan as it lands), else assistant messages scanned newest-first.
 */
export function latestLlmPlan(messages: ReadonlyArray<PlanSourceMessage>, partial?: string): DevPlan | null {
  if (partial) {
    const live = parsePlanBlock(partial);
    if (live) return live;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const text = m.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    const plan = parsePlanBlock(text);
    if (plan) return plan;
  }
  return null;
}
