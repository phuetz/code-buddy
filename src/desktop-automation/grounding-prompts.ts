/**
 * Invites et lecture des réponses de l'ancrage visuel (computer use).
 *
 * Deux modes :
 *  - LISTE FERMÉE : le modèle rend le numéro d'un candidat (éléments de l'arbre
 *    d'accessibilité, ou régions visuelles numérotées quand l'arbre est vide).
 *  - COORDONNÉES 0-1000 : le modèle prédit un point. Repli fragile, désormais
 *    derrière un drapeau (`CODEBUDDY_VISION_GROUNDING_COORDS=1`).
 *
 * Extrait de `codebuddy-agent.ts` pour être testable et partagé avec le banc de
 * mesure : le banc et l'agent envoient exactement les mêmes invites.
 */

export interface GroundingCandidate {
  ref: number;
  role: string;
  name: string;
  /** Centre en pixels écran (présent pour les régions visuelles). */
  center?: { x: number; y: number };
  size?: { width: number; height: number };
  /** Origine : 'visual-region' pour une région découpée dans la capture. */
  source?: string;
}

export function formatCandidateLine(c: GroundingCandidate): string {
  const where = c.center ? ` center=(${c.center.x},${c.center.y})` : '';
  const size = c.size ? ` size=${c.size.width}x${c.size.height}` : '';
  const name = c.name ? c.name : '(no text)';
  return `[${c.ref}] role="${c.role}" name="${name}"${where}${size}`;
}

export function buildClosedListPrompt(intent: string, candidates: GroundingCandidate[], roleHint?: string, withImage = true): string {
  const visual = candidates.some((c) => c.source === 'visual-region');
  const origin = visual
    ? 'The accessibility tree is empty, so these candidates are numbered regions cut from the screenshot (OCR text boxes and detected controls).'
    : 'Here are the candidate elements present in the screenshot:';
  const look = withImage
    ? 'Look at the screenshot and find the element matching the user\'s intent.'
    : 'Find the element matching the user\'s intent from this list.';
  return `You are a visual grounding agent. Your task is to identify the unique [ref] number of the interactive element${withImage ? ' in the provided screenshot' : ''} that matches the user's intent: "${intent}".${roleHint ? ` Expected role hint: "${roleHint}".` : ''}

${origin}
${candidates.map(formatCandidateLine).join('\n')}

${look} Output only the reference number (e.g. 42) or "none" if no matching element can be found. Do not write any explanations or other text.`;
}

/**
 * Lit la réponse d'une liste fermée. Seul un numéro PRÉSENT dans la liste est
 * accepté : l'ancienne lecture prenait le premier entier venu, si bien qu'un
 * petit modèle qui répond « 220 » (une coordonnée) ou « Element 4 at (288,161) »
 * désignait un élément inexistant.
 */
export function parseClosedListReply(reply: string | null | undefined, allowedRefs: Iterable<number>): number | null {
  if (!reply) return null;
  const allowed = new Set(allowedRefs);
  const text = reply.trim();
  if (/^\s*["'`]?none["'`]?\s*\.?\s*$/i.test(text)) return null;
  // Retire le raisonnement éventuel d'un modèle « thinking », puis tout ce qui
  // ressemble à une position ou à une taille : « (288, 161) », « x=288 », « 62x31 ».
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g, ' ')
    .replace(/\b\d+\s*x\s*\d+\b/gi, ' ')
    .replace(/\b[xy]\s*[:=]\s*-?\d+(?:\.\d+)?/gi, ' ')
    .replace(/\d+\.\d+/g, ' ');
  // Priorité à un numéro entre crochets, puis à un numéro isolé.
  for (const re of [/\[(\d+)\]/g, /\b(\d+)\b/g]) {
    for (const m of cleaned.matchAll(re)) {
      const n = Number.parseInt(m[1]!, 10);
      if (allowed.has(n)) return n;
    }
  }
  return null;
}

export function buildCoordinatePrompt(intent: string, roleHint?: string): string {
  return `You are a visual grounding agent. Your task is to find the pixel coordinate of the element matching the user's intent: "${intent}".${roleHint ? ` Expected role hint: "${roleHint}".` : ''}

Identify the target element in the provided screenshot. Return the target's center coordinates on a relative scale from 0 to 1000, where (0, 0) is the top-left corner and (1000, 1000) is the bottom-right corner of the image.

Output ONLY a JSON object in this exact format:
{
  "x": <integer between 0 and 1000>,
  "y": <integer between 0 and 1000>
}
Do not write any other text or explanations.`;
}

export function parseCoordinateReply(reply: string | null | undefined): { x: number; y: number } | null {
  if (!reply) return null;
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  const json = cleaned.match(/\{[\s\S]*?\}/);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { x?: unknown; y?: unknown };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return { x: parsed.x, y: parsed.y };
    } catch {
      /* repli par expression régulière ci-dessous */
    }
  }
  const x = cleaned.match(/"?x"?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i)?.[1];
  const y = cleaned.match(/"?y"?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i)?.[1];
  if (x !== undefined && y !== undefined) return { x: Number(x), y: Number(y) };
  return null;
}

/** Le repli en coordonnées n'est permis que sur demande explicite. */
export function isCoordinateGroundingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_VISION_GROUNDING_COORDS === '1' || env.CODEBUDDY_VISION_GROUNDING_COORDS === 'true';
}

/**
 * Les régions visuelles sont actives dès que l'ancrage visuel l'est, sauf refus
 * explicite (`CODEBUDDY_VISUAL_REGIONS=0`) ; `CODEBUDDY_VISUAL_REGIONS=1` les
 * active seules, sans ancrage par modèle (le choix se fait alors par nom, ou
 * par le modèle principal qui lit la liste du snapshot).
 */
export function isVisualRegionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CODEBUDDY_VISUAL_REGIONS;
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  if (flag === '1' || flag === 'true' || flag === 'on') return true;
  return env.CODEBUDDY_VISION_GROUNDING === '1' || env.CODEBUDDY_REAL_COMPUTER_USE === '1';
}
