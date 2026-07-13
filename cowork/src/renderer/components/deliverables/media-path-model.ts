/**
 * Media deliverables (image/video studios) — the deliverable IS the file the
 * media tool produced. The agent replies with the absolute output path; these
 * pure helpers extract the newest one from the session messages.
 */

export interface MediaSourceMessage {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

const IMAGE_PATH_RE = /(?:[A-Za-z]:[\\/]|\/)[^\s`"'()<>]+?\.(?:jpg|jpeg|png|webp)/gi;
const VIDEO_PATH_RE = /(?:[A-Za-z]:[\\/]|\/)[^\s`"'()<>]+?\.(?:mp4|webm|mov)/gi;

type MediaPathKind = 'image' | 'video';

/**
 * Renderer-side provenance filter. This is deliberately not the security
 * boundary (the main process independently realpaths the source), but it keeps
 * an assistant reply such as `/etc/private.png` from becoming a Design View
 * candidate in the first place.
 */
export function isGeneratedMediaPath(value: string, kind: MediaPathKind): boolean {
  if (!value || [...value].some((character) => character.charCodeAt(0) < 0x20)) return false;
  const normalized = value.replace(/\\/g, '/');
  if (!normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)) return false;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return false;
  const marker = segments.lastIndexOf('.codebuddy');
  if (marker < 0 || segments[marker + 1] !== 'media-generation') return false;
  const bucket = segments[marker + 2];
  if (kind === 'image' && bucket !== 'images') return false;
  if (kind === 'video' && bucket !== 'videos' && bucket !== 'films') return false;
  if (segments.length <= marker + 3) return false;
  return kind === 'image'
    ? /\.(?:jpg|jpeg|png|webp)$/i.test(normalized)
    : /\.(?:mp4|webm|mov)$/i.test(normalized);
}

function latestPath(
  messages: ReadonlyArray<MediaSourceMessage>,
  partial: string | undefined,
  re: RegExp,
  kind: MediaPathKind,
): string | null {
  const scan = (text: string): string | null => {
    const matches = text.match(re)?.filter((candidate) => isGeneratedMediaPath(candidate, kind));
    return matches && matches.length > 0 ? matches[matches.length - 1]! : null;
  };
  if (partial) {
    const live = scan(partial);
    if (live) return live;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const text = m.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    const found = scan(text);
    if (found) return found;
  }
  return null;
}

/** Newest generated image path in the session (streaming partial wins). */
export function latestImagePath(messages: ReadonlyArray<MediaSourceMessage>, partial?: string): string | null {
  return latestPath(messages, partial, IMAGE_PATH_RE, 'image');
}

/** Newest generated video path in the session (streaming partial wins). */
export function latestVideoPath(messages: ReadonlyArray<MediaSourceMessage>, partial?: string): string | null {
  return latestPath(messages, partial, VIDEO_PATH_RE, 'video');
}

/** The generation prompt for an image. */
export function buildImageGenerationPrompt(subject: string): string {
  return [
    `Génère une image : ${subject}`,
    '',
    "Utilise l'outil `image_generate` (charge-le via `tool_search(\"image_generate\")` s'il n'est pas dans ta liste)",
    'avec un prompt ANGLAIS détaillé et fidèle au sujet (style, lumière, composition).',
    'Réponds UNIQUEMENT avec le chemin absolu du fichier créé, rien d\'autre.',
  ].join('\n');
}

/** A variation request keeps the same session (same subject context). */
export function buildImageVariationPrompt(): string {
  return 'Génère une VARIANTE de la même image (même sujet, composition ou ambiance différente) avec image_generate. Réponds UNIQUEMENT avec le chemin absolu du nouveau fichier.';
}

/** The generation prompt for a short video. */
export function buildVideoGenerationPrompt(subject: string): string {
  return [
    `Génère une courte vidéo : ${subject}`,
    '',
    "Utilise l'outil `video_generate` (charge-le via `tool_search(\"video_generate\")` s'il n'est pas dans ta liste)",
    'avec un prompt ANGLAIS détaillé (mouvement, style, cadrage).',
    "Réponds UNIQUEMENT avec le chemin absolu du fichier créé, rien d'autre.",
  ].join('\n');
}

/** A variation request for the video. */
export function buildVideoVariationPrompt(): string {
  return 'Génère une VARIANTE de la même vidéo (même sujet, mouvement ou ambiance différente) avec video_generate. Réponds UNIQUEMENT avec le chemin absolu du nouveau fichier.';
}
