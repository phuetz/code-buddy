export type FlowMediaMode = 'image' | 'video';
export type FlowReferenceMode = 'text' | 'ingredients' | 'frames';
export type FlowCameraMove = 'static' | 'pan-left' | 'dolly-back' | 'orbit';

export interface FlowIngredient {
  id: string;
  name: string;
  kind: 'character' | 'object' | 'place' | 'style';
  path?: string;
  url: string;
  assetId?: string;
  source?: 'workspace' | 'avatar-bible' | 'mysoulmate';
  contentTier?: 'safe' | 'sensual' | 'explicit';
  qaStatus?: 'pending' | 'approved' | 'rejected';
  companionId?: string;
  /** Opaque provenance only; the private bible filesystem path is never stored here. */
  avatarBibleId?: string;
}

export interface FlowScene {
  id: string;
  title: string;
  prompt: string;
  durationSeconds: number;
  status: 'draft' | 'generating' | 'done' | 'error';
  url?: string;
  path?: string;
  youtubeMetadataPath?: string;
  mediaType?: FlowMediaMode;
  parentSceneId?: string;
}

export interface FlowPromptInput {
  prompt: string;
  ingredients: FlowIngredient[];
  camera: FlowCameraMove;
  startFrame?: FlowIngredient;
  endFrame?: FlowIngredient;
  audioEnabled: boolean;
  voiceEnabled: boolean;
  publication?: boolean;
}

const CAMERA_LABEL: Record<FlowCameraMove, string> = {
  static: 'caméra fixe',
  'pan-left': 'panoramique lent vers la gauche',
  'dolly-back': 'travelling arrière lent',
  orbit: 'orbite cinématique autour du sujet',
};

export function ingredientNameFromPath(path: string): string {
  const filename = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Ingredient';
  const words = filename.replace(/[^a-zA-Z0-9À-ÿ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const joined = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  return joined || 'Ingredient';
}

export function insertIngredientReference(prompt: string, ingredient: FlowIngredient): string {
  const reference = `@${ingredient.name}`;
  if (prompt.includes(reference)) return prompt;
  return `${prompt.trim()}${prompt.trim() ? ' ' : ''}${reference} `;
}

export function removeIngredientReference(prompt: string, ingredient: FlowIngredient): string {
  const reference = `@${ingredient.name}`;
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return prompt.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function buildFlowPrompt(input: FlowPromptInput): string {
  const references = input.ingredients.map((ingredient) => `@${ingredient.name}`).join(', ');
  const frames = [
    input.startFrame ? `image de départ @${input.startFrame.name}` : '',
    input.endFrame ? `image de fin @${input.endFrame.name}` : '',
  ].filter(Boolean).join(', ');
  return [
    input.prompt.trim(),
    references ? `Références visuelles cohérentes : ${references}.` : '',
    frames ? `Contraintes de transition : ${frames}.` : '',
    `Mouvement caméra : ${CAMERA_LABEL[input.camera]}.`,
    input.audioEnabled ? `Audio : ambiance synchronisée${input.voiceEnabled ? ' et voix cohérente' : ', sans voix'}.` : 'Audio désactivé.',
    input.publication ? 'Publication : ajouter dans les métadonnées ou la légende une divulgation claire indiquant que le personnage et les images sont générés par IA.' : '',
    'Préserver strictement l’identité, les vêtements, la palette, la lumière et la géométrie des références entre les plans.',
  ].filter(Boolean).join('\n');
}

export function createFlowScene(index: number, durationSeconds = 6): FlowScene {
  return {
    id: `flow-scene-${Date.now()}-${index}`,
    title: `Plan ${String(index).padStart(2, '0')}`,
    prompt: '',
    durationSeconds,
    status: 'draft',
  };
}

export function extendFlowScene(scene: FlowScene, index: number): FlowScene {
  return {
    ...createFlowScene(index, scene.durationSeconds),
    parentSceneId: scene.id,
    prompt: `${scene.prompt.trim()}\nContinuation fluide depuis la dernière image du plan précédent.`.trim(),
    url: scene.url,
    mediaType: scene.mediaType,
  };
}

/** Source clips only; an already assembled master must never feed the next assembly. */
export function sourceVideoClips(scenes: readonly FlowScene[]): string[] {
  return scenes.flatMap((scene) =>
    scene.mediaType === 'video' && scene.path && !scene.youtubeMetadataPath ? [scene.path] : []);
}
