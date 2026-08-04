/**
 * Multi-avatar / multi-style bible for Lisa LoRAs.
 *
 * Modelled on Krea 2 character demos (ComfyUI Workflow Blog):
 * https://www.youtube.com/watch?v=GQusMZgc1RE
 *
 * Architecture (same as the video thumbnail):
 *   1 locked FACE identity (one LoRA / one trigger)
 *   + several STYLE packs (studio, wet selfie, rainy street, neon, soft editorial…)
 * so one avatar can appear in many looks without baking one outfit into the LoRA.
 *
 * Default avatar `lisa` is calqued on the dark-brunette muse shown in that video.
 *
 * @module lora/lisa-avatar-bible
 */

/** Built-in avatar ids. */
export const AVATAR_IDS = ['lisa', 'lisa-classic'] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

/**
 * Presentation styles — same woman, different fashion/lighting package.
 * Matches the multi-panel showcase in GQusMZgc1RE.
 */
export const AVATAR_STYLE_IDS = [
  'studio', // studio beauty, hands near face, wet hair strands
  'wet-selfie', // raindrops, phone selfie, glowing skin
  'street-rain', // long black coat, rainy city walk
  'neon-skate', // cyber neon night, bold fashion
  'soft-editorial', // soft white blouse, clean portrait
  'tender',
  'playful',
  'bold',
  'sparkly',
  'calm',
  'mika',
  'portrait',
] as const;
export type AvatarStyleId = (typeof AVATAR_STYLE_IDS)[number];

/** @deprecated alias — moods are styles */
export type LisaAvatarMood = AvatarStyleId;

export interface AvatarProfile {
  id: AvatarId;
  /** Display name */
  name: string;
  /** LoRA / DreamBooth trigger (always first in prompts) */
  trigger: string;
  /** Locked face identity — byte-stable for training */
  identity: string;
  /** Default style when none requested */
  defaultStyle: AvatarStyleId;
  /** Style-specific fragments (do not restate full face) */
  styles: Partial<Record<AvatarStyleId, string>>;
  /** Training scene rotation */
  scenes: readonly string[];
  /** Training outfit rotation */
  outfits: readonly string[];
  /** Training lighting rotation */
  lightings: readonly string[];
  /** Shared negative */
  negative: string;
  /** Source note */
  source?: string;
}

const SHARED_NEGATIVE = [
  'blurry',
  'deformed',
  'extra fingers',
  'mutated hands',
  'bad anatomy',
  'plastic skin',
  'waxy face',
  'duplicate face',
  'different person',
  'age change',
  'male',
  'child',
  'watermark',
  'text',
  'logo',
  'lowres',
  'over-smoothed',
  'cgi mannequin',
].join(', ');

/**
 * Primary Lisa — calqued on the dark brunette muse from
 * https://www.youtube.com/watch?v=GQusMZgc1RE thumbnail / results grid.
 *
 * Keep identity SHORT: long stacked prompts make sd_turbo invent multi-face glitches.
 */
export const AVATAR_LISA_BRUNETTE: AvatarProfile = {
  id: 'lisa',
  name: 'Lisa (Krea brunette muse)',
  trigger: 'ohwx lisa',
  source: 'https://www.youtube.com/watch?v=GQusMZgc1RE',
  defaultStyle: 'studio',
  identity: [
    'ohwx lisa',
    'one woman only, single face, locked identity',
    'beautiful young woman mid-20s',
    'olive warm skin, dewy natural glow',
    'dark brown eyes, long dark wavy brunette hair',
    'high cheekbones, full soft lips',
    'photoreal portrait, 85mm lens',
  ].join(', '),
  styles: {
    studio:
      'studio beauty portrait, wet-look dark hair strands on face, hands gently near chin, soft glam key light, intimate eye contact, editorial fashion',
    'wet-selfie':
      'mirror-style selfie holding black smartphone, rain droplets on skin and hair, soft bathroom or window light, intimate candid, glowing wet skin',
    'street-rain':
      'walking rainy european city street, long black tailored coat, wet pavement reflections, full-body to three-quarter, cinematic overcast light, confident stride',
    'neon-skate':
      'night city neon lights, bold futuristic fashion, dynamic skateboard pose, vibrant pink cyan color splash, same locked face identity, high energy',
    'soft-editorial':
      'soft clean studio portrait, sheer white blouse, hair gently pulled back with loose waves, pearl drop earring, serene direct gaze, high-end beauty retouch natural',
    tender:
      'soft warm key light, intimate close portrait, gentle affectionate smile, looking at camera with quiet love, cozy atmosphere',
    playful:
      'playful mischievous half-smile, lively eyes, slight head tilt, candid lifestyle portrait, vibrant soft colors',
    bold:
      'confident soft-glam portrait, dramatic yet natural lighting, alluring direct gaze, elegant modern fashion, tasteful',
    sparkly:
      'joyful bright smile, celebratory energy, sparkling eyes, cheerful fashion, crisp daylight',
    calm:
      'serene calm expression, soft muted palette, peaceful lifestyle portrait, quiet morning light',
    mika:
      'dynamic energetic pose, adventure-ready dark jacket, outdoor city bokeh, confident grin, motion feel',
    portrait:
      'clean editorial portrait, natural skin micro-detail, sharp dark eyes, neutral seamless background, photoreal Krea finish',
  },
  scenes: [
    'clean white studio seamless backdrop',
    'soft bathroom window light with rain on glass',
    'rainy paris street corner, cool blue hour reflections',
    'neon-lit wet night avenue, cinematic teal-magenta',
    'soft bokeh cafe interior, warm window light',
    'sunlit flower market, colorful bokeh',
    'quiet bookstore aisle, soft overhead light',
    'golden hour balcony, soft sky',
    'cozy bar evening, amber practical lights',
    'home living room couch, lamp light',
  ],
  outfits: [
    'black delicate spaghetti-strap top',
    'long black tailored wool coat',
    'sheer soft white blouse',
    'white camisole top',
    'glossy dark fashion set for night',
    'simple black turtleneck',
    'casual denim jacket over white tee',
    'elegant dark silk blouse',
    'soft cream knit sweater',
    'minimal black slip dress with jacket',
  ],
  lightings: [
    'soft beauty dish key light',
    'wet-skin specular glow, soft fill',
    'overcast rainy daylight',
    'neon night practicals',
    'golden hour rim light',
    'studio softbox beauty lighting',
    'cool blue morning light',
    'warm practical lamp light',
  ],
  negative:
    SHARED_NEGATIVE +
    ', oily skin, orange tan, blonde hair, light brown hair, freckles heavy, ' +
    'multiple faces, double face, triple face, two heads, extra eyes, fused faces, ' +
    'split face, collage, montage, mirrored face artifact',
};

/** Previous soft chestnut companion look (optional second avatar). */
export const AVATAR_LISA_CLASSIC: AvatarProfile = {
  id: 'lisa-classic',
  name: 'Lisa classic (soft chestnut)',
  trigger: 'ohwx lisa classic',
  defaultStyle: 'portrait',
  identity: [
    'ohwx lisa classic',
    'same woman every image, locked face identity',
    'young French woman mid-20s, exclusive digital companion presence',
    'soft oval face, high cheekbones, delicate jawline',
    'warm honey-brown eyes, long dark lashes, gentle brows',
    'straight-to-wavy medium-long chestnut brown hair with soft honey highlights',
    'natural healthy skin with fine pores, soft glam makeup, no plastic sheen',
    'subtle freckles across nose bridge, warm peach lips',
    'slender elegant build, photoreal Krea-style rendering',
    '85mm portrait lens, shallow depth of field',
  ].join(', '),
  styles: {
    tender:
      'soft warm key light, intimate close portrait, gentle affectionate smile, cozy atmosphere',
    playful:
      'playful mischievous half-smile, lively eyes, slight head tilt, candid lifestyle portrait',
    bold: 'confident soft-glam portrait, dramatic yet natural lighting, alluring direct gaze',
    sparkly: 'joyful bright smile, celebratory energy, sparkling eyes, daylight',
    calm: 'serene calm expression, soft muted palette, quiet morning light',
    mika: 'dynamic energetic pose, outdoor city bokeh, confident grin',
    portrait:
      'clean editorial portrait, natural skin micro-detail, sharp eyes, neutral background',
    studio: 'studio softbox beauty portrait, centered face, eye contact',
    'wet-selfie': 'soft selfie, natural indoor light, phone in hand',
    'street-rain': 'city street walk, soft coat, overcast light',
    'neon-skate': 'night city lights, casual bold fashion, energetic pose',
    'soft-editorial': 'soft white blouse, clean studio, serene gaze',
  },
  scenes: [
    'soft bokeh cafe interior, warm window light',
    'rainy city street corner, cool blue hour reflections',
    'clean white studio seamless backdrop',
    'home living room couch, lamp light',
    'paris balcony morning, soft sky',
    'neon night street, cinematic teal-orange',
  ],
  outfits: [
    'simple black turtleneck',
    'soft cream knit sweater',
    'light linen shirt',
    'casual denim jacket over white tee',
    'elegant dark silk blouse',
    'soft pink blouse, delicate gold earrings',
  ],
  lightings: [
    'soft north-window light',
    'golden hour rim light',
    'studio softbox beauty lighting',
    'overcast daylight',
    'warm practical lamp light',
    'cool blue morning light',
  ],
  negative: SHARED_NEGATIVE,
};

const REGISTRY: Record<AvatarId, AvatarProfile> = {
  lisa: AVATAR_LISA_BRUNETTE,
  'lisa-classic': AVATAR_LISA_CLASSIC,
};

/** Env: CODEBUDDY_LISA_AVATAR=lisa|lisa-classic */
export function resolveAvatarId(
  raw?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): AvatarId {
  const v = (raw ?? env.CODEBUDDY_LISA_AVATAR ?? 'lisa').trim().toLowerCase();
  if (v === 'lisa-classic' || v === 'classic' || v === 'chestnut') return 'lisa-classic';
  return 'lisa';
}

export function getAvatarProfile(id?: string | null): AvatarProfile {
  return REGISTRY[resolveAvatarId(id)] ?? AVATAR_LISA_BRUNETTE;
}

export function listAvatarProfiles(): AvatarProfile[] {
  return AVATAR_IDS.map((id) => REGISTRY[id]);
}

export function listAvatarStyles(avatarId?: string | null): AvatarStyleId[] {
  const p = getAvatarProfile(avatarId);
  return AVATAR_STYLE_IDS.filter((s) => Boolean(p.styles[s]));
}

export function resolveAvatarStyle(
  raw?: string | null,
  avatarId?: string | null,
): AvatarStyleId {
  const p = getAvatarProfile(avatarId);
  const v = (raw ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!v) return p.defaultStyle;
  const hit = AVATAR_STYLE_IDS.find((s) => s === v || s.replace(/-/g, '') === v.replace(/-/g, ''));
  if (hit && p.styles[hit]) return hit;
  // aliases from speech / CLI
  if (v === 'street' || v === 'rain' || v === 'manteau') return 'street-rain';
  if (v === 'wet' || v === 'selfie' || v === 'pluie') return 'wet-selfie';
  if (v === 'neon' || v === 'cyber' || v === 'skate') return 'neon-skate';
  if (v === 'soft' || v === 'editorial' || v === 'blouse') return 'soft-editorial';
  if (v === 'studio' || v === 'beauty') return 'studio';
  return p.defaultStyle;
}

// ─── Back-compat exports (previous single-bible API) ───────────────────────

export const LISA_AVATAR_TRIGGER = AVATAR_LISA_BRUNETTE.trigger;
export const LISA_AVATAR_IDENTITY = AVATAR_LISA_BRUNETTE.identity;
export const LISA_AVATAR_NEGATIVE = AVATAR_LISA_BRUNETTE.negative;
export const LISA_AVATAR_SCENES = AVATAR_LISA_BRUNETTE.scenes;
export const LISA_AVATAR_OUTFITS = AVATAR_LISA_BRUNETTE.outfits;
export const LISA_AVATAR_LIGHTINGS = AVATAR_LISA_BRUNETTE.lightings;
export const LISA_AVATAR_MOOD_SCENES = AVATAR_LISA_BRUNETTE.styles as Record<
  LisaAvatarMood,
  string
>;

/**
 * Build a generation prompt:
 * trigger → locked identity → style pack → optional free scene → quality.
 */
export function buildLisaAvatarPrompt(options: {
  avatarId?: string | null;
  mood?: LisaAvatarMood | string | null;
  style?: string | null;
  scene?: string;
  forWhom?: string;
  includeIdentity?: boolean;
}): string {
  const profile = getAvatarProfile(options.avatarId);
  const style = resolveAvatarStyle(options.style ?? options.mood, profile.id);
  const styleLine = profile.styles[style] ?? profile.styles[profile.defaultStyle] ?? '';
  // identity already starts with trigger — do not duplicate
  const identityOrShort =
    options.includeIdentity === false
      ? `${profile.trigger}, photoreal portrait, single face, locked identity`
      : profile.identity;
  const parts = [
    identityOrShort,
    styleLine,
    options.scene?.trim().slice(0, 220),
    options.forWhom ? `looking at ${options.forWhom}` : 'looking at camera',
    'high detail face, natural skin texture, no text, no watermark, no logo',
  ];
  return parts.filter(Boolean).join(', ');
}

/** Human-readable catalog for CLI / doctor. */
export function formatAvatarCatalog(): string {
  const lines = ['Lisa avatar catalog (multi-style, one LoRA face each)', '='.repeat(50), ''];
  for (const p of listAvatarProfiles()) {
    lines.push(`${p.id} — ${p.name}`);
    lines.push(`  trigger: ${p.trigger}`);
    lines.push(`  default style: ${p.defaultStyle}`);
    lines.push(`  styles: ${listAvatarStyles(p.id).join(', ')}`);
    if (p.source) lines.push(`  source: ${p.source}`);
    lines.push('');
  }
  lines.push('Env: CODEBUDDY_LISA_AVATAR=lisa|lisa-classic');
  lines.push('Selfie: buddy lora selfie --style studio|wet-selfie|street-rain|neon-skate|soft-editorial');
  return lines.join('\n');
}
