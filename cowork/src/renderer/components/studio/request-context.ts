/**
 * Contexte joint à une demande d'App Studio — modèle pur (sans React ni IPC).
 *
 * Quatre écarts avec bolt.new se règlent ici :
 * - **élément sélectionné dans l'aperçu** : la demande porte sur LUI, avec son
 *   fichier, ses lignes et leur code actuel (le modèle n'a pas à chercher) ;
 * - **journaux** (console du navigateur, serveur de dev) joints à une demande ;
 * - **fichiers inclus / exclus** du contexte, avec une estimation en jetons ;
 * - **secrets** : seuls leurs NOMS sont donnés au modèle, jamais une valeur.
 *
 * @module renderer/components/studio/request-context
 */

export interface ElementDescriptor {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  selector?: string;
  component?: string;
  source?: { fileName: string; lineNumber?: number; columnNumber?: number };
}

export interface ElementLocation {
  file: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  method: 'source' | 'composant' | 'texte' | 'classe' | 'id';
  dataOrigin?: { file: string; line: number };
}

export interface TargetElement {
  element: ElementDescriptor;
  location: ElementLocation | null;
}

export type LogSource = 'navigateur' | 'serveur';

export interface AttachedLogs {
  source: LogSource;
  lines: string[];
}

export interface PinnedFile {
  path: string;
  content: string;
}

export interface RequestContext {
  target?: TargetElement | null;
  logs?: AttachedLogs[];
  files?: PinnedFile[];
  excluded?: string[];
  secretNames?: string[];
  image?: boolean;
}

const METHOD_LABEL: Record<ElementLocation['method'], string> = {
  source: 'source React exacte',
  composant: 'nom du composant',
  texte: 'texte visible',
  classe: 'classes CSS',
  id: 'identifiant',
};

const MAX_LOG_LINES = 40;
const MAX_LOG_LINE = 300;

/** ≈ 4 caractères par jeton (même règle que le processus principal). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Coût forfaitaire compté pour une image jointe (ordre de grandeur d'une vignette). */
export const IMAGE_TOKEN_ESTIMATE = 1000;

function fenceLang(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return ['tsx', 'ts', 'jsx', 'js', 'vue', 'html', 'css', 'svelte'].includes(ext) ? ext : '';
}

/** Libellé court de l'élément : `<button.primary> « Ajouter »`. */
export function elementLabel(element: ElementDescriptor): string {
  const cls = (element.classes ?? []).slice(0, 2).map((c) => `.${c}`).join('');
  const id = element.id ? `#${element.id}` : '';
  const text = element.text ? ` « ${element.text.slice(0, 40)}${element.text.length > 40 ? '…' : ''} »` : '';
  return `<${element.tag}${id}${cls}>${text}`;
}

export function targetBlock(target: TargetElement): string {
  const { element, location } = target;
  const lines = [
    "Élément ciblé dans l'aperçu (cliqué par l'utilisateur) — la demande porte sur CET élément :",
    `- élément : ${elementLabel(element)}`,
  ];
  if (element.component) lines.push(`- composant : ${element.component}`);
  if (element.selector) lines.push(`- sélecteur : ${element.selector}`);
  if (location) {
    lines.push(
      `- source : ${location.file}, lignes ${location.startLine} à ${location.endLine} (localisé par : ${METHOD_LABEL[location.method]})`,
      'Code actuel de ces lignes :',
      '```' + fenceLang(location.file),
      location.excerpt,
      '```',
    );
    if (location.dataOrigin && element.text) {
      const origin = location.dataOrigin;
      lines.push(
        `Attention : ces lignes sont un composant RÉUTILISÉ ; le texte « ${element.text.slice(0, 60)} » de l'élément cliqué vient des données ` +
          `(${origin.file}, ligne ${origin.line}). La demande ne vise que CET élément, pas toutes les instances : ` +
          `ajoute à ${location.file} une prop optionnelle (ou une condition) qui applique le changement, ` +
          `puis active-la seulement pour cette donnée dans ${origin.file}. Les deux modifications sont nécessaires pour que le rendu change ; ` +
          'une classe CSS sans règle ne change rien (ajoute la règle, ou un style en ligne), et toute prop utilisée doit être déstructurée.',
      );
    } else {
      lines.push(
        `Modifie ce passage de ${location.file} (str_replace sur ces lignes) ; ne touche pas au reste de l'app sauf si la demande l'exige. ` +
          'Inutile de parcourir les autres fichiers.',
      );
    }
  } else {
    lines.push("- source : non localisée — retrouve l'élément par son texte et ses classes, puis modifie-le lui seul.");
  }
  return lines.join('\n');
}

export function logsBlock(logs: AttachedLogs): string {
  const title = logs.source === 'navigateur' ? "console du navigateur (aperçu)" : 'serveur de dev';
  const lines = logs.lines.slice(-MAX_LOG_LINES).map((l) => (l.length > MAX_LOG_LINE ? `${l.slice(0, MAX_LOG_LINE)}…` : l));
  return [`Journaux joints — ${title} (${lines.length} ligne(s)) :`, '```', ...lines, '```'].join('\n');
}

export function filesBlock(files: readonly PinnedFile[]): string {
  if (files.length === 0) return '';
  return [
    'Fichiers joints au contexte (contenu actuel, inutile de les relire) :',
    ...files.map((f) => `<fichier chemin="${f.path}">\n${f.content}\n</fichier>`),
  ].join('\n');
}

/** Bloc de contexte inséré avant la demande (vide s'il n'y a rien à joindre). */
export function buildContextBlock(ctx: RequestContext): string {
  const parts: string[] = [];
  if (ctx.target) parts.push(targetBlock(ctx.target));
  for (const logs of ctx.logs ?? []) if (logs.lines.length > 0) parts.push(logsBlock(logs));
  if (ctx.files && ctx.files.length > 0) parts.push(filesBlock(ctx.files));
  if (ctx.excluded && ctx.excluded.length > 0) {
    parts.push(`Hors contexte — ne lis pas et ne modifie pas : ${ctx.excluded.join(', ')}`);
  }
  if (ctx.secretNames && ctx.secretNames.length > 0) {
    parts.push(
      `Variables d'environnement du projet (valeurs SECRÈTES fournies au serveur de dev, jamais visibles) : ${ctx.secretNames.join(', ')}. ` +
        "Lis-les par import.meta.env.NOM (préfixe VITE_ côté navigateur) ; n'écris jamais de valeur dans le code et ne crée pas de fichier .env.",
    );
  }
  if (ctx.image) {
    parts.push("Une image de référence (maquette ou capture) est jointe : reproduis-en la mise en page, les couleurs et la hiérarchie.");
  }
  return parts.join('\n\n');
}

export function hasContext(ctx: RequestContext): boolean {
  return buildContextBlock({ ...ctx, secretNames: [] }).length > 0;
}

/** Estimation des jetons d'entrée ajoutés par la demande (hors historique de la session). */
export function estimateRequestTokens(prompt: string, ctx: RequestContext): number {
  return estimateTokens(prompt) + (ctx.image ? IMAGE_TOKEN_ESTIMATE : 0);
}

/** Bascule d'un fichier dans la sélection de contexte : neutre → inclus → exclu → neutre. */
export type ContextState = 'inclus' | 'exclu';

export function cycleContextState(current: ContextState | undefined): ContextState | undefined {
  if (current === undefined) return 'inclus';
  if (current === 'inclus') return 'exclu';
  return undefined;
}

/** Garde les lignes utiles d'une console : erreurs et avertissements d'abord si `onlyProblems`. */
export function pickLogLines(
  entries: readonly { level: string; message: string; source?: string; line?: number }[],
  onlyProblems: boolean,
): string[] {
  return entries
    .filter((e) => !onlyProblems || e.level === 'error' || e.level === 'warning')
    .map((e) => `[${e.level}] ${e.message}${e.source ? ` (${e.source}${e.line ? `:${e.line}` : ''})` : ''}`);
}
