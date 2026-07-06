/**
 * ```pod block — the agent emits a machine-readable podcast script in its
 * reply (same proven pattern as ```plan / ```deck / ```sheet / ```doc):
 * parsed here into PodcastComposer segments, hidden from the chat text.
 */
import type { PodSegment } from '../../utils/podcast-script.js';

const POD_BLOCK_RE = /```pod\s*\n([\s\S]*?)```/;

/** Keeps the episode scannable — a Genspark-style pod is 3-10 segments. */
const MAX_SEGMENTS = 20;

export interface ParsedPod {
  title: string;
  segments: PodSegment[];
}

/** Parse a ```pod fenced JSON block: {"title","segments":[{title,voice,script}]}. */
export function parsePodBlock(text: string): ParsedPod | null {
  const match = (text ?? '').match(POD_BLOCK_RE);
  if (!match) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]!);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.segments) || obj.segments.length === 0) return null;

  const segments: PodSegment[] = [];
  for (const entry of obj.segments.slice(0, MAX_SEGMENTS)) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const script = typeof s.script === 'string' && s.script.trim() ? s.script.trim() : '';
    if (!script) continue;
    segments.push({
      id: `seg-${segments.length + 1}`,
      title:
        typeof s.title === 'string' && s.title.trim()
          ? s.title.trim().slice(0, 80)
          : `Segment ${segments.length + 1}`,
      voice: typeof s.voice === 'string' && s.voice.trim() ? s.voice.trim() : 'narrateur',
      script,
    });
  }
  if (segments.length === 0) return null;

  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 80) : 'Épisode',
    segments,
  };
}

/** Remove ```pod blocks from the visible reply (the composer renders them). */
export function stripPodBlocks(text: string): string {
  return text.replace(/```pod\s*\n[\s\S]*?```/g, '').trim();
}

export interface PodSourceMessage {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/** Most recent pod script in the session: streaming partial wins. */
export function latestPodBlock(messages: ReadonlyArray<PodSourceMessage>, partial?: string): ParsedPod | null {
  if (partial) {
    const live = parsePodBlock(partial);
    if (live) return live;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const text = m.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    const pod = parsePodBlock(text);
    if (pod) return pod;
  }
  return null;
}

/** The generation prompt: emit the pod script first, no tools. */
export function buildPodGenerationPrompt(subject: string): string {
  return [
    `Écris un script de podcast (AI Pod) sur : ${subject}`,
    '',
    'COMMENCE ta réponse par le script complet dans un bloc ```pod (JSON strict) :',
    '```pod',
    '{"title":"<titre de l\'épisode>","segments":[{"title":"<titre du segment>","voice":"narrateur","script":"<texte à lire, 2-5 phrases naturelles>"}]}',
    '```',
    "4 à 8 segments : une intro accrocheuse, un fil narratif concret (faits, exemples), une conclusion avec l'idée à retenir.",
    'Le script est fait pour être LU À VOIX HAUTE : phrases courtes, rythme parlé, pas de listes ni de markdown dans script.',
    "N'utilise AUCUN outil et n'écris AUCUN fichier — le bloc ```pod suffit, l'interface le rend en aperçu.",
    "Après le bloc, résume l'épisode en 2 phrases.",
  ].join('\n');
}

/** The export prompt: synthesize the full episode with the real TTS tool. */
export function buildPodExportPrompt(pod: ParsedPod): string {
  const fullScript = pod.segments.map((s) => s.script).join('\n\n');
  return [
    `Synthétise cet épisode en fichier audio avec l'outil \`text_to_speech\` : un SEUL appel, tout le script,`,
    `output_path « ${pod.title}.wav » dans le dossier de travail courant (provider auto-détecté — piper local si disponible).`,
    'Réponds avec le chemin du fichier créé et sa durée si connue.',
    '',
    'Script complet à lire :',
    '"""',
    fullScript,
    '"""',
  ].join('\n');
}
