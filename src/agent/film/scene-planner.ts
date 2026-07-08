/**
 * Scene planner — turns a one-line pitch into a structured video plan (scenes
 * with title, subtitle, spoken narration, and a visual spec) via a single LLM
 * call. Reuses the command-provider resolution + CodeBuddyClient + JSON-retry
 * helpers; $0 through the ChatGPT-OAuth backend. The LLM is injectable so the
 * planner is unit-testable without a provider.
 *
 * @module agent/film/scene-planner
 */

import { generateJsonWithRetry } from '../../utils/llm-retry.js';
import { logger } from '../../utils/logger.js';

export interface PlannedVisual {
  kind: 'text' | 'diagram';
  /** Valid Mermaid source when kind==='diagram'. */
  mermaid?: string;
}

export interface PlannedScene {
  title: string;
  subtitle?: string;
  narration: string;
  visual: PlannedVisual;
}

export interface PlanScenesOptions {
  /** Target number of scenes (intro + body + outro). Default 6. */
  count?: number;
  /** Narration language. Default 'français'. */
  lang?: string;
  /** Model override for the planner. */
  model?: string;
}

export interface PlanScenesDeps {
  /** Injectable LLM: (systemPrompt, userPrompt) → raw JSON text. Default = ChatGPT-OAuth/current model. */
  chat?: (system: string, user: string) => Promise<string>;
}

export function buildPlannerSystemPrompt(count: number, lang: string): string {
  return (
    `Tu es un scénariste de vidéos de présentation courtes et percutantes. ` +
    `À partir d'un sujet, produis un plan d'environ ${count} scènes formant un arc clair : ` +
    `une intro accrocheuse, le corps (les points clés), une conclusion.\n` +
    `Pour CHAQUE scène :\n` +
    `- "title": titre court (≤ 5 mots), sans ponctuation finale ;\n` +
    `- "subtitle": sous-titre optionnel (≤ 8 mots) ;\n` +
    `- "narration": une narration PARLÉE, naturelle, en ${lang}, 1 à 2 phrases, ton clair et engageant ` +
    `(c'est ce qui sera lu à voix haute) ;\n` +
    `- "visual": {"kind":"diagram","mermaid":"<code Mermaid flowchart valide>"} UNIQUEMENT quand un schéma ` +
    `clarifie vraiment (architecture, étapes, relations) ; sinon {"kind":"text"}.\n` +
    `Réponds STRICTEMENT en JSON, sans texte autour :\n` +
    `{"scenes":[{"title":"...","subtitle":"...","narration":"...","visual":{"kind":"text"}}]}`
  );
}

function buildPlannerUserPrompt(pitch: string, count: number): string {
  return `Sujet de la vidéo : ${pitch}\nProduis environ ${count} scènes (intro + corps + conclusion).`;
}

/** Default LLM: resolve the current provider and run one JSON chat. Throws if no provider. */
async function defaultChat(system: string, user: string, model?: string): Promise<string> {
  const { resolveCommandProvider } = await import('../../commands/llm-provider-resolution.js');
  const resolved = resolveCommandProvider(model ? { explicitModel: model } : {});
  if (!resolved) {
    throw new Error(
      'Aucun modèle LLM configuré pour planifier les scènes. Lancez `buddy login` (ChatGPT, $0) ou configurez une clé provider.'
    );
  }
  const { CodeBuddyClient } = await import('../../codebuddy/client.js');
  const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);
  const resp = await client.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    undefined,
    { responseFormat: 'json' }
  );
  return resp?.choices?.[0]?.message?.content ?? '';
}

/** Coerce a raw parsed object into clean PlannedScene[] (drop invalid, clamp count). */
export function normalizeScenes(raw: unknown, count: number): PlannedScene[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { scenes?: unknown })?.scenes)
      ? (raw as { scenes: unknown[] }).scenes
      : [];
  const scenes: PlannedScene[] = [];
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const narration = typeof o.narration === 'string' ? o.narration.trim() : '';
    if (!title && !narration) continue;
    const vraw = (o.visual ?? {}) as Record<string, unknown>;
    const mermaid = typeof vraw.mermaid === 'string' ? vraw.mermaid.trim() : '';
    const kind: PlannedVisual['kind'] = vraw.kind === 'diagram' && mermaid ? 'diagram' : 'text';
    scenes.push({
      title: title || 'Sans titre',
      ...(typeof o.subtitle === 'string' && o.subtitle.trim()
        ? { subtitle: o.subtitle.trim() }
        : {}),
      narration: narration || title,
      visual: kind === 'diagram' ? { kind, mermaid } : { kind: 'text' },
    });
  }
  // Keep a sane bound (LLM may over/under-shoot).
  return scenes.slice(0, Math.max(count + 3, 12));
}

export async function planScenes(
  pitch: string,
  options: PlanScenesOptions = {},
  deps: PlanScenesDeps = {}
): Promise<PlannedScene[]> {
  const count = options.count ?? 6;
  const lang = options.lang ?? 'français';
  const system = buildPlannerSystemPrompt(count, lang);
  const user = buildPlannerUserPrompt(pitch, count);
  const chat = deps.chat ?? ((s: string, u: string) => defaultChat(s, u, options.model));

  const gen = (prompt: string): Promise<string> => chat(system, prompt);
  const parsed = await generateJsonWithRetry<unknown>(gen, user);
  const scenes = normalizeScenes(parsed, count);
  if (scenes.length === 0) throw new Error("Le planner LLM n'a produit aucune scène exploitable.");
  logger.info(
    `[scene-planner] ${scenes.length} scène(s) planifiée(s) pour « ${pitch.slice(0, 60)} »`
  );
  return scenes;
}
