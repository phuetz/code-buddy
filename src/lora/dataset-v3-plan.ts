/** Deterministic generation plan for the v3 Lisa identity dataset. */

export const DATASET_V3_TRIGGER = 'ohwx lisa' as const;

export type DatasetV3Framing = 'face' | 'bust' | 'half' | 'full' | 'back';
export type DatasetV3Angle =
  | 'front'
  | 'threequarter-left'
  | 'threequarter-right'
  | 'profile-left'
  | 'profile-right'
  | 'gaze-up'
  | 'gaze-down'
  | 'back'
  | 'threequarter-back-left'
  | 'threequarter-back-right';
export type DatasetV3Expression =
  | 'neutral-closed'
  | 'smile-closed'
  | 'smile-open'
  | 'pensive'
  | 'laugh';
export type DatasetV3Lighting =
  | 'studio-soft'
  | 'window-daylight'
  | 'cinematic-side'
  | 'golden-hour';
export type DatasetV3FocalHint = '35mm' | '50mm' | '85mm';
export type DatasetV3OutfitTag =
  | 'black-knit'
  | 'navy-blazer'
  | 'burgundy-sweater'
  | 'denim-casual'
  | 'ivory-blouse'
  | 'navy-dress'
  | 'knee-skirt-blouse'
  | 'tailored-shorts'
  | 'slit-evening-dress'
  | 'short-summer-dress'
  | 'backless-evening-dress';
export type DatasetV3SettingTag =
  | 'gray-studio'
  | 'cream-studio'
  | 'modern-interior'
  | 'urban-overcast'
  | 'garden-path'
  | 'gallery-hall';

export interface DatasetV3Slot {
  readonly slotId: string;
  readonly framing: DatasetV3Framing;
  readonly angle: DatasetV3Angle;
  readonly expression: DatasetV3Expression;
  readonly lighting: DatasetV3Lighting;
  readonly outfitTag: DatasetV3OutfitTag;
  readonly settingTag: DatasetV3SettingTag;
  readonly focalHint: DatasetV3FocalHint;
  readonly prompt: string;
  readonly overgenCount: 3 | 4;
}

interface SlotDraft extends Omit<DatasetV3Slot, 'prompt'> {
  readonly pose: string;
}

const OUTFITS = {
  'black-knit': 'black long-sleeve knit top with the signature silver pendant',
  'navy-blazer': 'navy blazer over an ivory crew-neck top with the signature silver pendant',
  'burgundy-sweater': 'burgundy crew-neck sweater with the signature silver pendant',
  'denim-casual': 'dark denim jacket over a white top with the signature silver pendant',
  'ivory-blouse': 'modest ivory blouse with the signature silver pendant',
  'navy-dress': 'knee-length navy dress with the signature silver pendant and flat shoes',
  'knee-skirt-blouse': 'fitted knee-length black skirt with a tucked ivory blouse, the signature silver pendant and classic heels',
  'tailored-shorts': 'high-waisted tailored beige shorts with a fitted white top, the signature silver pendant and sandals',
  'slit-evening-dress': 'elegant dark evening dress with a tasteful leg slit, the signature silver pendant and heels',
  'short-summer-dress': 'flowing knee-length floral summer dress with the signature silver pendant and sandals',
  'backless-evening-dress': 'elegant floor-length evening dress with an open back, the signature silver pendant and heels',
} as const;

const SETTINGS = {
  'gray-studio': 'seamless neutral gray studio',
  'cream-studio': 'minimal cream studio',
  'modern-interior': 'quiet modern interior',
  'urban-overcast': 'clean overcast city street',
  'garden-path': 'leafy garden path',
  'gallery-hall': 'bright contemporary gallery hall',
} as const;

const LIGHTING_PROMPTS: Record<DatasetV3Lighting, string> = {
  'studio-soft': 'soft controlled studio lighting',
  'window-daylight': 'diffused natural window daylight',
  'cinematic-side': 'controlled cinematic side lighting with a subtle rim',
  'golden-hour': 'clean warm golden-hour light',
};

const FRAMING_PROMPTS: Record<DatasetV3Framing, string> = {
  face: 'tight face close-up',
  bust: 'head-and-shoulders bust portrait',
  half: 'waist-up half-body portrait with hands visible when in frame',
  full: 'sharp full-body photograph with hands and feet fully visible',
  back: 'rear-view portrait showing the back or rear three-quarter pose',
};

function promptFor(slot: SlotDraft): string {
  return [
    DATASET_V3_TRIGGER,
    OUTFITS[slot.outfitTag],
    `${slot.pose}, ${slot.expression}`,
    LIGHTING_PROMPTS[slot.lighting],
    SETTINGS[slot.settingTag],
    `${FRAMING_PROMPTS[slot.framing]}, simulated ${slot.focalHint} lens`,
    'identity-edit photograph, sharp natural detail, no sunglasses, no blur, no filters, no occlusion',
  ].join(', ');
}

function slot(draft: SlotDraft): DatasetV3Slot {
  return Object.freeze({
    slotId: draft.slotId,
    framing: draft.framing,
    angle: draft.angle,
    expression: draft.expression,
    lighting: draft.lighting,
    outfitTag: draft.outfitTag,
    settingTag: draft.settingTag,
    focalHint: draft.focalHint,
    prompt: promptFor(draft),
    overgenCount: draft.overgenCount,
  });
}

const DRAFTS: readonly SlotDraft[] = [
  { slotId: 'face-front-neutral', framing: 'face', angle: 'front', expression: 'neutral-closed', lighting: 'studio-soft', outfitTag: 'black-knit', settingTag: 'gray-studio', focalHint: '85mm', pose: 'straight-on eye-level portrait', overgenCount: 4 },
  { slotId: 'face-front-smile-closed', framing: 'face', angle: 'front', expression: 'smile-closed', lighting: 'window-daylight', outfitTag: 'ivory-blouse', settingTag: 'cream-studio', focalHint: '85mm', pose: 'straight-on eye-level portrait', overgenCount: 3 },
  { slotId: 'face-front-smile-open', framing: 'face', angle: 'front', expression: 'smile-open', lighting: 'cinematic-side', outfitTag: 'navy-blazer', settingTag: 'modern-interior', focalHint: '85mm', pose: 'straight-on eye-level portrait', overgenCount: 4 },
  { slotId: 'face-threequarter-left-neutral', framing: 'face', angle: 'threequarter-left', expression: 'neutral-closed', lighting: 'window-daylight', outfitTag: 'burgundy-sweater', settingTag: 'cream-studio', focalHint: '85mm', pose: 'three-quarter pose turned left', overgenCount: 3 },
  { slotId: 'face-threequarter-left-pensive', framing: 'face', angle: 'threequarter-left', expression: 'pensive', lighting: 'cinematic-side', outfitTag: 'black-knit', settingTag: 'gallery-hall', focalHint: '85mm', pose: 'three-quarter pose turned left', overgenCount: 4 },
  { slotId: 'face-threequarter-right-neutral', framing: 'face', angle: 'threequarter-right', expression: 'neutral-closed', lighting: 'studio-soft', outfitTag: 'navy-blazer', settingTag: 'gray-studio', focalHint: '85mm', pose: 'three-quarter pose turned right', overgenCount: 3 },
  { slotId: 'face-threequarter-right-laugh', framing: 'face', angle: 'threequarter-right', expression: 'laugh', lighting: 'golden-hour', outfitTag: 'denim-casual', settingTag: 'garden-path', focalHint: '85mm', pose: 'three-quarter pose turned right', overgenCount: 4 },
  { slotId: 'face-profile-left-neutral', framing: 'face', angle: 'profile-left', expression: 'neutral-closed', lighting: 'cinematic-side', outfitTag: 'ivory-blouse', settingTag: 'gray-studio', focalHint: '85mm', pose: 'exact left profile', overgenCount: 3 },
  { slotId: 'face-profile-right-neutral', framing: 'face', angle: 'profile-right', expression: 'neutral-closed', lighting: 'cinematic-side', outfitTag: 'burgundy-sweater', settingTag: 'gray-studio', focalHint: '85mm', pose: 'exact right profile', overgenCount: 4 },
  { slotId: 'face-gaze-up-pensive', framing: 'face', angle: 'gaze-up', expression: 'pensive', lighting: 'golden-hour', outfitTag: 'denim-casual', settingTag: 'urban-overcast', focalHint: '85mm', pose: 'front orientation with gaze lifted upward', overgenCount: 3 },
  { slotId: 'face-gaze-down-neutral', framing: 'face', angle: 'gaze-down', expression: 'neutral-closed', lighting: 'window-daylight', outfitTag: 'black-knit', settingTag: 'modern-interior', focalHint: '85mm', pose: 'front orientation with gaze lowered', overgenCount: 4 },

  { slotId: 'bust-front-neutral', framing: 'bust', angle: 'front', expression: 'neutral-closed', lighting: 'studio-soft', outfitTag: 'navy-blazer', settingTag: 'gray-studio', focalHint: '85mm', pose: 'upright straight-on pose', overgenCount: 3 },
  { slotId: 'bust-front-smile-closed', framing: 'bust', angle: 'front', expression: 'smile-closed', lighting: 'window-daylight', outfitTag: 'ivory-blouse', settingTag: 'modern-interior', focalHint: '85mm', pose: 'relaxed straight-on pose', overgenCount: 4 },
  { slotId: 'bust-front-laugh', framing: 'bust', angle: 'front', expression: 'laugh', lighting: 'golden-hour', outfitTag: 'denim-casual', settingTag: 'garden-path', focalHint: '50mm', pose: 'relaxed straight-on pose', overgenCount: 3 },
  { slotId: 'bust-left-neutral', framing: 'bust', angle: 'threequarter-left', expression: 'neutral-closed', lighting: 'cinematic-side', outfitTag: 'burgundy-sweater', settingTag: 'gallery-hall', focalHint: '85mm', pose: 'shoulders turned three-quarter left', overgenCount: 4 },
  { slotId: 'bust-left-smile-open', framing: 'bust', angle: 'threequarter-left', expression: 'smile-open', lighting: 'studio-soft', outfitTag: 'black-knit', settingTag: 'cream-studio', focalHint: '50mm', pose: 'shoulders turned three-quarter left', overgenCount: 3 },
  { slotId: 'bust-right-smile-closed', framing: 'bust', angle: 'threequarter-right', expression: 'smile-closed', lighting: 'window-daylight', outfitTag: 'navy-blazer', settingTag: 'modern-interior', focalHint: '85mm', pose: 'shoulders turned three-quarter right', overgenCount: 4 },
  { slotId: 'bust-right-pensive', framing: 'bust', angle: 'threequarter-right', expression: 'pensive', lighting: 'cinematic-side', outfitTag: 'ivory-blouse', settingTag: 'gray-studio', focalHint: '50mm', pose: 'shoulders turned three-quarter right', overgenCount: 3 },
  { slotId: 'bust-profile-left-neutral', framing: 'bust', angle: 'profile-left', expression: 'neutral-closed', lighting: 'golden-hour', outfitTag: 'denim-casual', settingTag: 'urban-overcast', focalHint: '85mm', pose: 'left profile with relaxed shoulders', overgenCount: 4 },
  { slotId: 'bust-profile-right-smile-closed', framing: 'bust', angle: 'profile-right', expression: 'smile-closed', lighting: 'studio-soft', outfitTag: 'burgundy-sweater', settingTag: 'cream-studio', focalHint: '85mm', pose: 'right profile with relaxed shoulders', overgenCount: 3 },

  { slotId: 'half-front-neutral', framing: 'half', angle: 'front', expression: 'neutral-closed', lighting: 'studio-soft', outfitTag: 'black-knit', settingTag: 'gray-studio', focalHint: '50mm', pose: 'standing frontally with both hands relaxed and visible', overgenCount: 4 },
  { slotId: 'half-front-smile-open', framing: 'half', angle: 'front', expression: 'smile-open', lighting: 'window-daylight', outfitTag: 'ivory-blouse', settingTag: 'modern-interior', focalHint: '50mm', pose: 'standing frontally with one hand resting at the waist', overgenCount: 3 },
  { slotId: 'half-left-pensive', framing: 'half', angle: 'threequarter-left', expression: 'pensive', lighting: 'cinematic-side', outfitTag: 'navy-blazer', settingTag: 'gallery-hall', focalHint: '50mm', pose: 'standing three-quarter left with loosely folded arms', overgenCount: 4 },
  { slotId: 'half-left-laugh', framing: 'half', angle: 'threequarter-left', expression: 'laugh', lighting: 'golden-hour', outfitTag: 'denim-casual', settingTag: 'garden-path', focalHint: '50mm', pose: 'standing three-quarter left with open relaxed posture', overgenCount: 3 },
  { slotId: 'half-right-neutral', framing: 'half', angle: 'threequarter-right', expression: 'neutral-closed', lighting: 'window-daylight', outfitTag: 'burgundy-sweater', settingTag: 'cream-studio', focalHint: '50mm', pose: 'standing three-quarter right with both hands visible', overgenCount: 4 },
  { slotId: 'half-right-smile-closed', framing: 'half', angle: 'threequarter-right', expression: 'smile-closed', lighting: 'studio-soft', outfitTag: 'navy-dress', settingTag: 'modern-interior', focalHint: '50mm', pose: 'standing three-quarter right with one hand at the hip', overgenCount: 3 },

  { slotId: 'full-walking-front', framing: 'full', angle: 'front', expression: 'smile-closed', lighting: 'golden-hour', outfitTag: 'denim-casual', settingTag: 'urban-overcast', focalHint: '35mm', pose: 'walking naturally toward camera mid-stride', overgenCount: 4 },
  { slotId: 'full-seated-left', framing: 'full', angle: 'threequarter-left', expression: 'pensive', lighting: 'window-daylight', outfitTag: 'navy-dress', settingTag: 'modern-interior', focalHint: '50mm', pose: 'seated naturally on a simple chair, hands and feet visible', overgenCount: 3 },
  { slotId: 'full-arms-raised-right', framing: 'full', angle: 'threequarter-right', expression: 'smile-open', lighting: 'studio-soft', outfitTag: 'black-knit', settingTag: 'gray-studio', focalHint: '35mm', pose: 'standing with both arms raised in a natural celebratory movement', overgenCount: 4 },
  { slotId: 'full-standing-front', framing: 'full', angle: 'front', expression: 'smile-closed', lighting: 'cinematic-side', outfitTag: 'navy-blazer', settingTag: 'gallery-hall', focalHint: '50mm', pose: 'standing in a balanced catalog pose with hands and feet visible', overgenCount: 3 },
  { slotId: 'full-turning-left', framing: 'full', angle: 'threequarter-left', expression: 'laugh', lighting: 'golden-hour', outfitTag: 'ivory-blouse', settingTag: 'garden-path', focalHint: '35mm', pose: 'turning dynamically while taking a step, hands and feet visible', overgenCount: 4 },

  { slotId: 'back-straight', framing: 'back', angle: 'back', expression: 'pensive', lighting: 'studio-soft', outfitTag: 'navy-dress', settingTag: 'gray-studio', focalHint: '50mm', pose: 'standing fully turned away from camera', overgenCount: 3 },
  { slotId: 'back-threequarter-right', framing: 'back', angle: 'threequarter-back-right', expression: 'smile-closed', lighting: 'golden-hour', outfitTag: 'denim-casual', settingTag: 'garden-path', focalHint: '50mm', pose: 'walking away in a rear three-quarter right pose', overgenCount: 3 },

  // Extension 2026-07-20 (demande Patrice) : plus de jambes visibles et de dos —
  // toujours tier couvert (jupes/robes/short, dos nu élégant = fashion, pas d'explicite).
  { slotId: 'full-skirt-walk-legs', framing: 'full', angle: 'front', expression: 'smile-closed', lighting: 'golden-hour', outfitTag: 'knee-skirt-blouse', settingTag: 'urban-overcast', focalHint: '35mm', pose: 'walking toward camera in a knee-length skirt, full legs and heels clearly visible', overgenCount: 4 },
  { slotId: 'full-shorts-standing-legs', framing: 'full', angle: 'threequarter-right', expression: 'smile-open', lighting: 'window-daylight', outfitTag: 'tailored-shorts', settingTag: 'modern-interior', focalHint: '50mm', pose: 'standing relaxed in tailored shorts, long bare legs fully visible, one knee slightly bent', overgenCount: 4 },
  { slotId: 'full-slit-dress-profile-legs', framing: 'full', angle: 'profile-left', expression: 'pensive', lighting: 'cinematic-side', outfitTag: 'slit-evening-dress', settingTag: 'gallery-hall', focalHint: '85mm', pose: 'standing in profile, elegant dress with a leg-revealing slit, one leg forward', overgenCount: 4 },
  { slotId: 'full-seated-crossed-legs', framing: 'full', angle: 'front', expression: 'smile-closed', lighting: 'studio-soft', outfitTag: 'short-summer-dress', settingTag: 'gray-studio', focalHint: '50mm', pose: 'seated on a stool with legs elegantly crossed, calves and heels visible', overgenCount: 4 },
  { slotId: 'back-backless-dress', framing: 'back', angle: 'back', expression: 'smile-closed', lighting: 'cinematic-side', outfitTag: 'backless-evening-dress', settingTag: 'gallery-hall', focalHint: '85mm', pose: 'standing turned away in an elegant backless evening dress, bare back visible, glancing over her shoulder', overgenCount: 4 },
  { slotId: 'back-walk-away-legs', framing: 'back', angle: 'back', expression: 'neutral-closed', lighting: 'golden-hour', outfitTag: 'knee-skirt-blouse', settingTag: 'urban-overcast', focalHint: '35mm', pose: 'walking away from camera in a knee-length skirt, legs and heels visible mid-stride', overgenCount: 4 },
] as const;

/** The frozen canonical plan. Callers may safely reuse it without I/O or randomness. */
export const DATASET_V3_SLOTS: readonly DatasetV3Slot[] = Object.freeze(DRAFTS.map(slot));

/** Return the canonical deterministic v3 slot sequence.
 * An optional trigger substitutes the persona trigger word in every prompt
 * (multi-persona roster support) — same slots, same determinism. */
export function createDatasetV3Plan(trigger: string = DATASET_V3_TRIGGER): readonly DatasetV3Slot[] {
  if (trigger === DATASET_V3_TRIGGER) return DATASET_V3_SLOTS;
  const normalized = trigger.trim();
  if (!normalized) throw new Error('createDatasetV3Plan trigger must be non-empty');
  return Object.freeze(DATASET_V3_SLOTS.map((slot) => Object.freeze({
    ...slot,
    prompt: slot.prompt.replace(DATASET_V3_TRIGGER, normalized),
  })));
}
