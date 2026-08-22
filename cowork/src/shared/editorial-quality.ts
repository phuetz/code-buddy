export type EditorialCheckStatus = 'pass' | 'warn' | 'fail';

export interface EditorialQualityCheck {
  id: string;
  label: string;
  status: EditorialCheckStatus;
  detail: string;
}

export interface EditorialQualityInput {
  publication: boolean;
  title: string;
  description: string;
  prompt: string;
  aspect: string;
  duration: number;
  syntheticMediaDisclosure: boolean;
  selectedAssets: Array<{ kind: string; contentTier?: string; qaStatus?: string; companionId?: string }>;
  scenes: Array<{ prompt: string; status: string; mediaType?: string }>;
  previousPrompts?: string[];
}

export interface EditorialQualityReport {
  score: number;
  ready: boolean;
  checks: EditorialQualityCheck[];
  maximumPromptSimilarity: number;
}

const STOP_WORDS = new Set(['avec', 'dans', 'pour', 'from', 'that', 'this', 'the', 'and', 'une', 'des', 'les', 'sur', 'sans']);

function words(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .split(/[^a-z0-9]+/u).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)));
}

export function promptSimilarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

export function assessEditorialQuality(input: EditorialQualityInput): EditorialQualityReport {
  if (!input.publication) return { score: 100, ready: true, checks: [], maximumPromptSimilarity: 0 };
  const previous = input.previousPrompts ?? [];
  const maximumPromptSimilarity = previous.reduce((maximum, candidate) => Math.max(maximum, promptSimilarity(input.prompt, candidate)), 0);
  const hasCharacter = input.selectedAssets.some((asset) => asset.kind === 'character' && Boolean(asset.companionId));
  const assetsApproved = input.selectedAssets.length > 0 && input.selectedAssets.every((asset) =>
    asset.contentTier === 'safe' && asset.qaStatus === 'approved');
  const completedVideoScenes = input.scenes.filter((scene) => scene.status === 'done' && scene.mediaType === 'video').length;
  const checks: EditorialQualityCheck[] = [
    check('format', 'Format Short', input.aspect === '9:16' && input.duration >= 6 && input.duration <= 15,
      'Ratio 9:16 et durée de 6 à 15 secondes par plan.'),
    check('identity', 'Identité reconnaissable', hasCharacter,
      hasCharacter ? 'Un compagnon identifié sert de référence.' : 'Sélectionne un compagnon MySoulmate identifié.'),
    check('assets', 'Assets publiables', assetsApproved,
      assetsApproved ? 'Tous les assets sont safe et validés.' : 'Utilise uniquement des assets safe + approved.'),
    graded('editorial', 'Contexte éditorial', input.title.trim().length >= 20 && input.description.trim().length >= 80,
      input.title.trim().length >= 8 && input.description.trim().length >= 30,
      'Titre descriptif (20+ caractères) et description originale (80+ caractères).'),
    graded('story', 'Intention narrative', words(input.prompt).size >= 14, words(input.prompt).size >= 8,
      'Décris une action, un lieu, une émotion et une intention propres à cet épisode.'),
    graded('originality', 'Originalité de la série', maximumPromptSimilarity < 0.62, maximumPromptSimilarity < 0.78,
      maximumPromptSimilarity ? `Similarité maximale avec un projet existant : ${Math.round(maximumPromptSimilarity * 100)} %.` : 'Aucun doublon éditorial détecté.'),
    check('disclosure', 'Divulgation IA', input.syntheticMediaDisclosure,
      'Le contenu photoréaliste doit être déclaré comme synthétique.'),
    graded('final-cut', 'Montage final', completedVideoScenes >= 3, completedVideoScenes >= 1,
      completedVideoScenes ? `${completedVideoScenes} plan(s) vidéo terminé(s).` : 'Génère au moins trois plans distincts avant publication.'),
  ];
  const weights: Record<EditorialCheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };
  const score = Math.round(checks.reduce((total, item) => total + weights[item.status], 0) / checks.length * 100);
  return { score, ready: score >= 80 && checks.every((item) => item.status !== 'fail'), checks, maximumPromptSimilarity };
}

function check(id: string, label: string, passed: boolean, detail: string): EditorialQualityCheck {
  return { id, label, status: passed ? 'pass' : 'fail', detail };
}

function graded(id: string, label: string, passed: boolean, warned: boolean, detail: string): EditorialQualityCheck {
  return { id, label, status: passed ? 'pass' : warned ? 'warn' : 'fail', detail };
}
