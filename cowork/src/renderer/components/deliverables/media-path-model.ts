/**
 * Media deliverables (image/video studios) — the deliverable IS the file the
 * media tool produced. The agent replies with the absolute output path; these
 * pure helpers extract the newest one from the session messages.
 */

export interface MediaSourceMessage {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

const IMAGE_PATH_RE = /\/[^\s`"'()]+\.(?:jpg|jpeg|png|webp)/gi;
const VIDEO_PATH_RE = /\/[^\s`"'()]+\.(?:mp4|webm|mov)/gi;

function latestPath(messages: ReadonlyArray<MediaSourceMessage>, partial: string | undefined, re: RegExp): string | null {
  const scan = (text: string): string | null => {
    const matches = text.match(re);
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
  return latestPath(messages, partial, IMAGE_PATH_RE);
}

/** Newest generated video path in the session (streaming partial wins). */
export function latestVideoPath(messages: ReadonlyArray<MediaSourceMessage>, partial?: string): string | null {
  return latestPath(messages, partial, VIDEO_PATH_RE);
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
