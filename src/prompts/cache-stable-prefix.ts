/**
 * Sépare les faits qui changent avec le jour ou le dossier (bloc
 * `<context>` d'environnement, ligne `Project:`) du préfixe stable.
 * Le texte des autres sections n'est pas réécrit.
 */

export interface VolatileSplit {
  /** Prompt sans le bloc d'environnement ni la première ligne `Project:`. */
  stable: string;
  /** Ces faits, dans l'ordre où ils apparaissaient. Vide si rien à déplacer. */
  volatile: string;
}

const ENV_BULLET =
  'Current date|Working directory|Platform|Architecture|Shell|Node\\.js|Timezone|Environment|Mode|Model|Date actuelle|Répertoire de travail';

/** Bloc `<context>` dont chaque ligne est un fait d'environnement connu. */
const ENV_CONTEXT_BLOCK = new RegExp(
  `<context>\\n(?:- (?:${ENV_BULLET}):[^\\n]*\\n)+</context>`,
  'g',
);

/** Première ligne non indentée `Project: …` (nom de dossier de la mémoire). */
const PROJECT_LINE = /^Project: [^\n]+$/m;

interface Span {
  start: number;
  end: number;
  text: string;
}

function expandOneNewline(source: string, start: number, end: number): { start: number; end: number } {
  let from = start;
  let to = end;
  // A blank line before the block loses one newline. The single newline that
  // separates a `Project:` line from the line above stays, so the neighbours
  // are not glued together.
  if (from >= 2 && source[from - 1] === '\n' && source[from - 2] === '\n') from -= 1;
  if (to < source.length && source[to] === '\n') to += 1;
  return { start: from, end: to };
}

/**
 * Retire le bloc d'environnement et la première ligne `Project:` où qu'ils
 * soient. Une nouvelle ligne collée de chaque côté part avec eux ; le reste
 * du prompt n'est pas recompressé.
 */
export function splitVolatileSuffix(prompt: string): VolatileSplit {
  const spans: Span[] = [];
  for (const match of prompt.matchAll(ENV_CONTEXT_BLOCK)) {
    if (match.index === undefined) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }

  const project = PROJECT_LINE.exec(prompt);
  if (project?.index !== undefined) {
    const start = project.index;
    const end = start + project[0].length;
    const overlaps = spans.some(span => start < span.end && end > span.start);
    if (!overlaps) spans.push({ start, end, text: project[0] });
  }

  if (spans.length === 0) return { stable: prompt, volatile: '' };
  spans.sort((a, b) => a.start - b.start);

  const cuts: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const cut = expandOneNewline(prompt, span.start, span.end);
    const prev = cuts[cuts.length - 1];
    if (prev && cut.start <= prev.end) prev.end = Math.max(prev.end, cut.end);
    else cuts.push(cut);
  }

  let stable = '';
  let cursor = 0;
  for (const cut of cuts) {
    stable += prompt.slice(cursor, cut.start);
    cursor = cut.end;
  }
  stable += prompt.slice(cursor);

  return { stable, volatile: spans.map(span => span.text).join('\n') };
}

/** Replace le bloc variable à la fin, après la variation et la troncature. */
export function relocateVolatileSuffix(prompt: string): string {
  const { stable, volatile } = splitVolatileSuffix(prompt);
  if (!volatile) return prompt;
  return `${stable.replace(/[ \t\n]+$/, '')}\n\n${volatile}`;
}

/**
 * Sort le bloc variable du premier message system et le rend après les
 * autres messages. Le premier message (et les outils qui le suivent dans
 * la requête) ne dépend plus du dossier. L'original n'est pas muté.
 * Rien n'est retiré si le préfixe stable serait vide.
 */
export function detachVolatileContext<T extends { role?: string; content?: unknown }>(
  messages: readonly T[],
): T[] {
  const first = messages[0];
  if (!first || first.role !== 'system' || typeof first.content !== 'string') return messages.slice();
  const { stable, volatile } = splitVolatileSuffix(first.content);
  if (!volatile || stable.trim().length === 0) return messages.slice();
  const next = messages.slice();
  next[0] = { ...first, content: stable.replace(/[ \t\n]+$/, '') };
  next.push({ role: 'system', content: volatile } as T);
  return next;
}
