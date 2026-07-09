/**
 * Widget proposer — asks the LLM (one-shot, $0 via the resolved command provider)
 * to author a NEW widget for a data `kind` it doesn't have yet. The model returns
 * a SAFE Mustache-style HTML+CSS template (no script, self-contained) which the
 * gate then validates before anything is kept. The `chat` fn is injectable for
 * deterministic tests. never-throws (returns null on any failure).
 *
 * @module widgets/widget-proposer
 */
import type { WidgetProposal } from './widget-types.js';

export type WidgetChat = (system: string, user: string) => Promise<string>;

export interface ProposeWidgetDeps {
  chat?: WidgetChat;
  env?: NodeJS.ProcessEnv;
}

const SYSTEM = [
  'Tu es un designer UI. On te donne un type de données structurées et un exemple JSON.',
  "Tu produis UN composant HTML AUTO-CONTENU qui affiche ces données joliment, INLINE dans une conversation.",
  '',
  'RÈGLES STRICTES (sinon rejeté) :',
  '- Format Mustache SÛR uniquement : {{ chemin.valeur }} pour interpoler (toujours échappé),',
  "  {{#each liste}} … {{/each}} pour itérer (à l'intérieur : {{ this }} ou {{ champ }}),",
  '  {{#if champ}} … {{else}} … {{/if}} pour un conditionnel. AUCUNE autre syntaxe.',
  "- ZÉRO <script>, zéro gestionnaire d'événement (onclick…), zéro javascript:.",
  '- ZÉRO ressource externe : pas de src=http, pas de <link> feuille de style externe, pas de @import,',
  '  pas de url(http…), pas de police/CDN distant, pas de <iframe>/<object>/<embed>.',
  "- Tout le style dans un <style> scopé sous une classe racine .cbw-<type> (police système).",
  '- Thème clair ET sombre (via @media (prefers-color-scheme: dark)).',
  '- Largeur max ~520px, coins arrondis, soigné. Les liens <a href> externes sont autorisés.',
  '',
  'Réponds UNIQUEMENT en JSON : {"template": "<style>…</style><div class=\\"cbw-<type>\\">…</div>"}',
].join('\n');

function buildUser(kind: string, sample: unknown, brief?: string): string {
  const json = JSON.stringify(sample, null, 2).slice(0, 2000);
  return [
    `Type de données : "${kind}".`,
    brief ? `Intention : ${brief}` : '',
    'Exemple de données (window de rendu) :',
    '```json',
    json,
    '```',
    `Crée le template Mustache du widget "${kind}". Référence les vrais chemins de l'exemple.`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function defaultChat(env: NodeJS.ProcessEnv): Promise<WidgetChat | null> {
  try {
    const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
    const resolved = resolveCommandProvider({});
    if (!resolved) return null;
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);
    return async (system: string, user: string) => {
      const resp = await client.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        undefined,
        { responseFormat: 'json' }
      );
      return resp?.choices?.[0]?.message?.content ?? '';
    };
  } catch {
    void env;
    return null;
  }
}

/** Propose an authored widget template for `kind` given a sample payload. null on failure. */
export async function proposeWidget(
  kind: string,
  sample: unknown,
  brief?: string,
  deps: ProposeWidgetDeps = {}
): Promise<WidgetProposal | null> {
  const env = deps.env ?? process.env;
  try {
    const chat = deps.chat ?? (await defaultChat(env));
    if (!chat) return null;
    const { generateJsonWithRetry } = await import('../utils/llm-retry.js');
    const gen = (u: string): Promise<string> => chat(SYSTEM, u);
    const parsed = await generateJsonWithRetry<{ template?: unknown }>(gen, buildUser(kind, sample, brief));
    const template = typeof parsed?.template === 'string' ? parsed.template.trim() : '';
    if (!template) return null;
    return { kind, template, sample, ...(brief ? { brief } : {}) };
  } catch {
    return null;
  }
}
