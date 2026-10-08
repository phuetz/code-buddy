/**
 * Contexte en ajout seul.
 *
 * Le préfixe déjà envoyé au modèle ne change plus : un fait nouveau (date,
 * dossier, projet, mémoire, todo, leçon, JIT) est un message ajouté à la fin.
 * La compaction (`prepareTurnMessages` / `compactTurnMessagesInPlace`) est le
 * seul moment où ce préfixe peut être réécrit.
 *
 * Les runtimes locaux qui recollent chaque message system dans le message 0
 * (`mergeSystemMessagesToFront`, Ollama / LM Studio / vLLM) cassent encore ce
 * préfixe. Le contrat tient pour les fournisseurs qui laissent les messages
 * à leur place (OpenRouter et les autres chemins cloud).
 */

import { splitVolatileSuffix } from './cache-stable-prefix.js';

export interface EnvironmentFacts {
  date?: string;
  directory?: string;
  project?: string;
}

export interface EnvironmentDrift {
  date: string;
  directory: string;
  project?: string;
}

type TextMessage = { role?: string; content?: unknown };

const ENVIRONMENT_OPEN = '<environment_context>';
const ENVIRONMENT_CLOSE = '</environment_context>';

const CONTEXT_MARKERS = [
  ENVIRONMENT_OPEN,
  '<context>',
  '<context ',
  '<workspace_context>',
  '<runtime_settings',
  '<persistent_memory>',
  '<user_model_context>',
  '<interaction_context',
  '<companion_current_turn_context',
  '--- Discovered Context ---',
  '<code_exec_policy',
];

const MEMORY_BLOCK = /<persistent_memory>[\s\S]*?<\/persistent_memory>/g;

function textOf(message: TextMessage | undefined): string | null {
  if (!message || typeof message.content !== 'string') return null;
  return message.content;
}

/** Message de contexte ajouté en cours de session (candidat à la déduplication). */
export function isAppendOnlyContext(content: string): boolean {
  return CONTEXT_MARKERS.some(marker => content.includes(marker));
}

/**
 * Queues qui ne doivent pas entrer dans l'historique : le ton du tour, les
 * octets d'un fichier mentionné, et le bloc compagnon du tour courant.
 * Les écrire reconstruirait l'agent mis en cache par Cowork.
 */
export function isUnpersistedTail(content: string): boolean {
  return content.includes('<interaction_context')
    || content.includes('<context type="file_mention"')
    || content.includes('<companion_current_turn_context');
}

export function asEnvironmentMessage(volatile: string): string {
  const body = volatile.trim();
  if (!body) return '';
  if (body.startsWith(ENVIRONMENT_OPEN)) return body;
  return `${ENVIRONMENT_OPEN}\n${body}\n${ENVIRONMENT_CLOSE}`;
}

export function environmentFacts(text: string): EnvironmentFacts {
  const date = text.match(/(?:Current date|Date actuelle): ([^\n]+)/);
  const directory = text.match(/(?:Working directory|Répertoire de travail): ([^\n]+)/);
  const project = text.match(/^Project: ([^\n]+)/m);
  const facts: EnvironmentFacts = {};
  if (date?.[1]) facts.date = date[1].trim();
  if (directory?.[1]) facts.directory = directory[1].trim();
  if (project?.[1]) facts.project = project[1].trim();
  return facts;
}

function environmentInner(content: string): string {
  const open = content.indexOf(ENVIRONMENT_OPEN);
  const close = content.lastIndexOf(ENVIRONMENT_CLOSE);
  if (open !== -1 && close > open) {
    return content.slice(open + ENVIRONMENT_OPEN.length, close).trim();
  }
  return content.trim();
}

function isEnvironmentContent(content: string): boolean {
  if (content.includes(ENVIRONMENT_OPEN)) return true;
  if (content.includes('<context type=')) return false;
  return content.includes('<context>')
    && /(?:Current date|Working directory|Date actuelle|Répertoire de travail):/.test(content);
}

function lastEnvironmentContent(messages: readonly TextMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = textOf(messages[i]);
    if (content && isEnvironmentContent(content)) return content;
  }
  return null;
}

function embeddedVolatile(messages: readonly TextMessage[]): string {
  const first = messages[0];
  const content = textOf(first);
  if (!first || first.role !== 'system' || content === null) return '';
  return splitVolatileSuffix(content).volatile.trim();
}

function latestEnvironmentText(messages: readonly TextMessage[]): string | null {
  return lastEnvironmentContent(messages) ?? (embeddedVolatile(messages) || null);
}

export function withEnvironmentFacts(body: string, facts: EnvironmentFacts): string {
  let next = body;
  if (facts.date) {
    if (/(?:Current date|Date actuelle): [^\n]*/.test(next)) {
      next = next.replace(/(Current date|Date actuelle): [^\n]*/, `$1: ${facts.date}`);
    } else if (next.includes('</context>')) {
      next = next.replace('</context>', `- Current date: ${facts.date}\n</context>`);
    } else {
      next = `${next}\n- Current date: ${facts.date}`;
    }
  }
  if (facts.directory) {
    if (/(?:Working directory|Répertoire de travail): [^\n]*/.test(next)) {
      next = next.replace(
        /(Working directory|Répertoire de travail): [^\n]*/,
        `$1: ${facts.directory}`,
      );
    } else if (next.includes('</context>')) {
      next = next.replace('</context>', `- Working directory: ${facts.directory}\n</context>`);
    } else {
      next = `${next}\n- Working directory: ${facts.directory}`;
    }
  }
  if (facts.project) {
    if (/^Project: [^\n]+/m.test(next)) {
      next = next.replace(/^Project: [^\n]+/m, `Project: ${facts.project}`);
    } else {
      next = `Project: ${facts.project}\n${next}`;
    }
  }
  return next;
}

function sameDrift(current: EnvironmentFacts, drift: EnvironmentDrift): boolean {
  if (current.date !== drift.date) return false;
  if (current.directory !== drift.directory) return false;
  if (drift.project !== undefined && current.project !== drift.project) return false;
  return true;
}

/**
 * Ajoute le bloc d'environnement porté par un prompt reconstruit, seulement
 * si ses faits diffèrent du dernier bloc déjà envoyé.
 */
export function appendEnvironmentFromVolatile<T extends TextMessage>(
  messages: T[],
  volatile: string,
): boolean {
  const wrapped = asEnvironmentMessage(volatile);
  if (!wrapped) return false;
  const latest = latestEnvironmentText(messages);
  if (latest && environmentInner(latest) === environmentInner(wrapped)) return false;
  const nextFacts = environmentFacts(wrapped);
  if (latest && nextFacts.date && nextFacts.directory && sameDrift(environmentFacts(latest), {
    date: nextFacts.date,
    directory: nextFacts.directory,
    ...(nextFacts.project ? { project: nextFacts.project } : {}),
  })) {
    return false;
  }
  messages.push({ role: 'system', content: wrapped } as T);
  return true;
}

/**
 * Ré-émet la date, le dossier et le projet quand ils ont bougé. N'invente
 * pas de bloc si la session n'en a jamais eu : le premier détachement s'en
 * charge.
 */
export function appendEnvironmentChange<T extends TextMessage>(
  messages: T[],
  drift: EnvironmentDrift,
): boolean {
  const latest = latestEnvironmentText(messages);
  if (!latest) return false;
  if (sameDrift(environmentFacts(latest), drift)) return false;
  const patched = asEnvironmentMessage(withEnvironmentFacts(environmentInner(latest), drift));
  if (!patched || patched === latest.trim() || environmentInner(patched) === environmentInner(latest)) {
    return false;
  }
  messages.push({ role: 'system', content: patched } as T);
  return true;
}

/** Retire la ligne `Project:` : elle vit dans le message d'environnement. */
export function normalizeMemory(block: string): string {
  return block
    .split('\n')
    .filter(line => !/^Project: /.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function memoryBlocks(text: string): string[] {
  return [...text.matchAll(MEMORY_BLOCK)].map(match => normalizeMemory(match[0]));
}

/** Ajoute la mémoire persistante quand son texte (hors `Project:`) a changé. */
export function appendMemoryIfChanged<T extends TextMessage>(
  messages: T[],
  rebuiltPrompt: string,
): boolean {
  const found = rebuiltPrompt.match(/<persistent_memory>[\s\S]*?<\/persistent_memory>/);
  if (!found) return false;
  const next = normalizeMemory(found[0]);
  if (!next.includes('<persistent_memory>')) return false;
  if (lastNormalizedMemory(messages) === next) return false;
  messages.push({ role: 'system', content: next } as T);
  return true;
}

/** Dernière mémoire déjà envoyée, pas une copie plus ancienne. */
function lastNormalizedMemory(messages: readonly TextMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const content = textOf(message);
    if (!message || message.role !== 'system' || content === null) continue;
    const last = memoryBlocks(content).at(-1);
    if (last && last.includes('<persistent_memory>')) return last;
  }
  return null;
}

/**
 * Marqueur du bloc. Chaque flux (todo, leçon, JIT…) garde son propre dernier
 * état : un voisin différent ne doit pas faire répéter un bloc inchangé.
 */
function contextSlot(content: string): string {
  const start = content.trimStart();
  const typed = start.match(/^<context\s+type="([^"]+)"/);
  if (typed?.[1]) return `type:${typed[1]}`;
  if (start.startsWith(ENVIRONMENT_OPEN)) return 'environment';
  if (start.startsWith('<workspace_context>')) return 'workspace';
  if (start.startsWith('<runtime_settings')) return 'runtime_settings';
  if (start.startsWith('<persistent_memory>')) return 'persistent_memory';
  if (start.startsWith('<user_model_context>')) return 'user_model';
  if (start.startsWith('--- Discovered Context ---')) return 'jit';
  if (start.startsWith('<code_exec_policy')) return 'code_exec_policy';
  if (start.startsWith('<context>')) return 'context';
  for (const marker of CONTEXT_MARKERS) {
    if (content.includes(marker)) return `marker:${marker}`;
  }
  return 'context';
}

/**
 * Oublie un contexte seulement s'il répète le dernier bloc déjà retenu pour
 * le même marqueur. Une valeur identique à un bloc plus ancien est ajoutée :
 * c'est l'état courant, et l'ajout en fin ne réécrit pas le préfixe.
 */
export function dedupeContextMessages<T extends TextMessage>(messages: readonly T[]): T[] {
  const lastBySlot = new Map<string, string>();
  const kept: T[] = [];
  for (const message of messages) {
    const content = textOf(message);
    if (
      message.role === 'system'
      && content
      && isAppendOnlyContext(content)
      && !isUnpersistedTail(content)
    ) {
      const slot = contextSlot(content);
      if (lastBySlot.get(slot) === content) continue;
      lastBySlot.set(slot, content);
    }
    kept.push(message);
  }
  return kept;
}

function detachAndWrap<T extends TextMessage>(messages: readonly T[]): T[] {
  const copy = messages.slice();
  const first = copy[0];
  const content = textOf(first);
  if (!first || first.role !== 'system' || content === null) return copy;
  const { stable, volatile } = splitVolatileSuffix(content);
  if (!volatile || stable.trim().length === 0) return copy;
  copy[0] = { ...first, content: stable.replace(/[ \t\n]+$/, '') };
  const wrapped = asEnvironmentMessage(volatile);
  if (wrapped) copy.push({ role: 'system', content: wrapped } as T);
  return copy;
}

/**
 * Fige `outbound` dans `history` avant l'ajout de la réponse. Le tableau
 * renvoyé est celui envoyé au fournisseur. Les queues non persistées restent
 * sur cette copie et hors de l'historique.
 *
 * Après cet appel, `history` est le préfixe engagé. Seule la compaction peut
 * encore le remplacer.
 */
export function sealAppendOnlyTranscript<T extends TextMessage>(
  history: T[],
  outbound: readonly T[],
  drift?: EnvironmentDrift,
): T[] {
  let next = detachAndWrap(outbound);
  if (drift) appendEnvironmentChange(next, drift);
  next = dedupeContextMessages(next);
  const committed = next.filter(message => {
    const content = textOf(message);
    return !(content && isUnpersistedTail(content));
  });
  history.splice(0, history.length, ...committed);
  return committed.length === next.length ? history : next;
}
