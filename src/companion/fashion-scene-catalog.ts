/** Pure scene vocabulary for original native vertical fashion clips. */

export type FashionPoseFamilyId =
  | 'hair-touch-and-step'
  | 'three-quarter-hip-shift'
  | 'over-shoulder-turn'
  | 'dress-twirl'
  | 'slow-runway-walk'
  | 'staircase-walk-away'
  | 'balustrade-pose'
  | 'bag-carry-city-walk';

export interface FashionPoseFamily {
  id: FashionPoseFamilyId;
  label: string;
  actionBeats: string[];
  cameraGuidance: 'fixed camera' | 'slow tracking camera';
  stabilityRisks: string[];
  compatibleWith: FashionPoseFamilyId[];
}

export const FASHION_SCENE_CATALOG: Readonly<Record<FashionPoseFamilyId, FashionPoseFamily>> = {
  'hair-touch-and-step': {
    id: 'hair-touch-and-step',
    label: 'Hair touch and step',
    actionBeats: ['Take one slow natural step', 'Touch the hair with one hand', 'Shift the gaze from camera to three-quarter'],
    cameraGuidance: 'fixed camera',
    stabilityRisks: ['finger and hair intersections', 'facial drift during the gaze change', 'foot sliding'],
    compatibleWith: ['three-quarter-hip-shift'],
  },
  'three-quarter-hip-shift': {
    id: 'three-quarter-hip-shift',
    label: 'Three-quarter hip shift',
    actionBeats: ['Transfer weight naturally to one leg', 'Settle into a balanced three-quarter pose'],
    cameraGuidance: 'fixed camera',
    stabilityRisks: ['hip and knee alignment', 'body proportion drift', 'fabric warping at the waist'],
    compatibleWith: ['hair-touch-and-step', 'over-shoulder-turn', 'balustrade-pose'],
  },
  'over-shoulder-turn': {
    id: 'over-shoulder-turn',
    label: 'Over-shoulder turn',
    actionBeats: ['Complete a controlled half-turn', 'Pause with stable footing', 'Look back briefly over the shoulder'],
    cameraGuidance: 'fixed camera',
    stabilityRisks: ['identity drift during rotation', 'shoulder and neck anatomy', 'outfit continuity from front to back'],
    compatibleWith: ['three-quarter-hip-shift'],
  },
  'dress-twirl': {
    id: 'dress-twirl',
    label: 'Dress twirl',
    actionBeats: ['Begin a short controlled rotation', 'Let the skirt move with realistic inertia', 'Return to a stable stance'],
    cameraGuidance: 'fixed camera',
    stabilityRisks: ['fabric topology changes', 'feet crossing or sliding', 'identity drift during rotation'],
    compatibleWith: ['staircase-walk-away'],
  },
  'slow-runway-walk': {
    id: 'slow-runway-walk',
    label: 'Slow runway walk',
    actionBeats: ['Take two measured fashion steps', 'Maintain natural arm swing', 'Finish with balanced footing'],
    cameraGuidance: 'slow tracking camera',
    stabilityRisks: ['gait and foot contact', 'limb continuity', 'camera speed variation'],
    compatibleWith: ['bag-carry-city-walk'],
  },
  'staircase-walk-away': {
    id: 'staircase-walk-away',
    label: 'Staircase walk away',
    actionBeats: ['Walk up the stairs at a measured pace', 'Keep the covered back view stable', 'Give one brief backward glance'],
    cameraGuidance: 'slow tracking camera',
    stabilityRisks: ['foot contact with stair edges', 'covered outfit continuity from behind', 'stair geometry and perspective'],
    compatibleWith: ['dress-twirl'],
  },
  'balustrade-pose': {
    id: 'balustrade-pose',
    label: 'Balustrade pose',
    actionBeats: ['Rest one hand lightly on the balustrade', 'Shift the hip without leaning heavily', 'Release the hand and resume one step'],
    cameraGuidance: 'fixed camera',
    stabilityRisks: ['hand contact with the balustrade', 'railing geometry', 'arm and torso intersections'],
    compatibleWith: ['three-quarter-hip-shift'],
  },
  'bag-carry-city-walk': {
    id: 'bag-carry-city-walk',
    label: 'Bag carry city walk',
    actionBeats: ['Walk slowly through the city setting', 'Carry the bag with a relaxed stable grip', 'Let the free arm swing naturally'],
    cameraGuidance: 'slow tracking camera',
    stabilityRisks: ['bag shape and strap continuity', 'hand and handle contact', 'background parallax'],
    compatibleWith: ['slow-runway-walk'],
  },
};

export interface BuildFashionScenePromptOptions {
  families: [FashionPoseFamilyId, ...FashionPoseFamilyId[]];
  outfit: string;
  setting: string;
  tier: 'safe' | 'sensual';
  trigger?: string;
}

export function buildFashionScenePrompt(options: BuildFashionScenePromptOptions): string {
  if (options.families.length > 2) {
    throw new Error('A fashion scene may combine at most two pose families');
  }
  const [firstId, secondId] = options.families;
  const first = FASHION_SCENE_CATALOG[firstId];
  if (secondId) {
    const second = FASHION_SCENE_CATALOG[secondId];
    if (firstId === secondId || !first.compatibleWith.includes(secondId) || !second.compatibleWith.includes(firstId)) {
      throw new Error(`Incompatible fashion pose families: ${firstId} and ${secondId}`);
    }
  }

  const families = options.families.map((id) => FASHION_SCENE_CATALOG[id]);
  const trigger = options.trigger?.trim();
  const tierDirection = options.tier === 'sensual'
    ? 'adult woman, elegant covered outfit, tasteful non-explicit, intimate areas fully covered'
    : 'safe elegant fashion presentation';
  const action = families.flatMap((family) => family.actionBeats).join('; ');
  const camera = families.some((family) => family.cameraGuidance === 'slow tracking camera')
    ? 'slow tracking camera'
    : 'fixed camera';

  return [
    ...(trigger ? [trigger] : []),
    'original fashion scene',
    tierDirection,
    `outfit: ${options.outfit.trim()}`,
    `setting: ${options.setting.trim()}`,
    'near full-body subject',
    'native vertical 9:16 composition',
    `${camera}, deliberately slow and continuous camera movement`,
    `action sequence: ${action}`,
    'stable identity, coherent anatomy, continuous outfit and stable decor',
    'no logos or copied choreography',
  ].join(', ');
}

export interface PilotFashionScene {
  sceneId: 'pilot-black-dress-turn' | 'pilot-floral-staircase';
  families: readonly [FashionPoseFamilyId, FashionPoseFamilyId];
  outfit: string;
  setting: string;
  tier: 'safe';
  targetDurationSeconds: 12;
  prompt: string;
}

const BLACK_DRESS_FAMILIES: [FashionPoseFamilyId, FashionPoseFamilyId] = [
  'over-shoulder-turn',
  'three-quarter-hip-shift',
];
const FLORAL_STAIRCASE_FAMILIES: [FashionPoseFamilyId, FashionPoseFamilyId] = [
  'staircase-walk-away',
  'dress-twirl',
];

export const PILOT_FASHION_SCENES: readonly PilotFashionScene[] = [
  {
    sceneId: 'pilot-black-dress-turn',
    families: BLACK_DRESS_FAMILIES,
    outfit: 'elegant covered black dress',
    setting: 'original softly lit stone terrace',
    tier: 'safe',
    targetDurationSeconds: 12,
    prompt: buildFashionScenePrompt({
      families: BLACK_DRESS_FAMILIES,
      outfit: 'elegant covered black dress',
      setting: 'original softly lit stone terrace',
      tier: 'safe',
    }),
  },
  {
    sceneId: 'pilot-floral-staircase',
    families: FLORAL_STAIRCASE_FAMILIES,
    outfit: 'elegant covered floral dress with natural fabric movement',
    setting: 'original sunlit garden staircase',
    tier: 'safe',
    targetDurationSeconds: 12,
    prompt: buildFashionScenePrompt({
      families: FLORAL_STAIRCASE_FAMILIES,
      outfit: 'elegant covered floral dress with natural fabric movement',
      setting: 'original sunlit garden staircase',
      tier: 'safe',
    }),
  },
] as const;
