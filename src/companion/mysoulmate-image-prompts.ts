/**
 * Original MySoulmate image moments inspired by public companion-app patterns:
 * context-aware selfies, natural-language scene prompting, proactive romantic
 * moments, and controlled outfit/pose variations. No competitor prompt or
 * character is copied verbatim.
 */

import type { AvatarStyleId } from '../lora/lisa-avatar-bible.js';

export type GeneratableImageTier = 'safe' | 'sensual';

export interface MySoulmateImageMoment {
  id: string;
  title: string;
  style: AvatarStyleId;
  category:
    | 'everyday'
    | 'romantic'
    | 'adventure'
    | 'creative'
    | 'celebration'
    | 'wellbeing';
  action: string;
  setting: string;
  safeOutfit: string;
  sensualOutfit: string;
  framing: string;
  lighting: string;
  mood: string;
}

export const MYSOULMATE_IMAGE_MOMENTS: readonly MySoulmateImageMoment[] = [
  {
    id: 'studio-confidence', title: 'Studio confidence', style: 'studio', category: 'creative',
    action: 'sitting on a tall studio stool with one hand resting gently near her chin',
    setting: 'a clean warm-grey beauty studio',
    safeOutfit: 'a fitted sleeveless black top with elegant tailored trousers',
    sensualOutfit: 'an elegant black satin camisole with a tasteful neckline and intimate areas fully covered',
    framing: 'waist-up 85mm beauty portrait, direct eye contact',
    lighting: 'soft beauty-dish key light with delicate hair light',
    mood: 'quiet confidence and natural warmth',
  },
  {
    id: 'studio-profile', title: 'Soft studio profile', style: 'studio', category: 'creative',
    action: 'standing in a relaxed three-quarter pose and looking back toward the camera',
    setting: 'a minimal ivory seamless studio',
    safeOutfit: 'a soft cream blouse and dark high-waisted trousers',
    sensualOutfit: 'a refined off-shoulder black evening dress that remains fully covered',
    framing: 'three-quarter editorial portrait, 85mm lens',
    lighting: 'large softbox light with a subtle warm rim',
    mood: 'elegant, intimate, and composed',
  },
  {
    id: 'rainy-window-selfie', title: 'Rainy window selfie', style: 'wet-selfie', category: 'romantic',
    action: 'taking a candid phone selfie beside a rain-covered window',
    setting: 'a cozy apartment on a rainy morning',
    safeOutfit: 'a soft cream knit sweater',
    sensualOutfit: 'a dark satin robe securely closed and fully covering intimate areas',
    framing: 'natural arm-length phone selfie with visible rainy window context',
    lighting: 'diffused cool window light with warm room fill',
    mood: 'affectionate, unhurried, and close',
  },
  {
    id: 'after-rain-mirror', title: 'After-rain mirror', style: 'wet-selfie', category: 'everyday',
    action: 'holding her phone for a relaxed mirror selfie, damp hair tucked behind one ear',
    setting: 'a modern bathroom with a softly misted mirror',
    safeOutfit: 'a fitted black turtleneck and simple gold earrings',
    sensualOutfit: 'a tasteful silk lounge set under a securely closed robe, fully covered',
    framing: 'mid-length mirror selfie with one clear reflection only',
    lighting: 'soft neutral vanity light and gentle window glow',
    mood: 'fresh, playful, and natural',
  },
  {
    id: 'paris-rain-walk', title: 'Paris rain walk', style: 'street-rain', category: 'romantic',
    action: 'walking toward the camera with a calm confident stride',
    setting: 'a rainy Paris street with wet pavement reflections',
    safeOutfit: 'a long black tailored coat over an all-black city outfit',
    sensualOutfit: 'a long black tailored coat over an elegant fitted evening dress, fully covered',
    framing: 'full-body street photograph with room for the surroundings',
    lighting: 'cinematic blue-hour daylight and warm cafe bokeh',
    mood: 'independent, cinematic, and subtly romantic',
  },
  {
    id: 'umbrella-cafe', title: 'Umbrella café', style: 'street-rain', category: 'everyday',
    action: 'pausing under a transparent umbrella and glancing back with a small smile',
    setting: 'a European cafe corner during light rain',
    safeOutfit: 'a belted trench coat, ankle boots, and a soft scarf',
    sensualOutfit: 'a belted dark trench coat over a fitted cocktail dress, fully covered',
    framing: 'three-quarter candid street portrait',
    lighting: 'overcast daylight with amber cafe lights',
    mood: 'spontaneous and inviting',
  },
  {
    id: 'neon-skate-night', title: 'Neon skate night', style: 'neon-skate', category: 'adventure',
    action: 'balancing dynamically on a skateboard with one knee bent',
    setting: 'a single neon-lit skate plaza on a wet city night',
    safeOutfit: 'a vivid cyan-and-magenta bomber jacket with black trousers and sneakers',
    sensualOutfit: 'a vivid cropped fashion jacket over a fully covered fitted top with black shorts and thigh-high sport socks',
    framing: 'full-body action portrait with the skateboard fully visible',
    lighting: 'pink and cyan neon reflections with crisp cinematic contrast',
    mood: 'bold, energetic, and mischievous',
  },
  {
    id: 'neon-arcade', title: 'Neon arcade', style: 'neon-skate', category: 'creative',
    action: 'leaning casually against an arcade cabinet and looking into the camera',
    setting: 'a stylish retro-futuristic arcade with one coherent neon background',
    safeOutfit: 'a dark leather jacket over a graphic tee and fitted jeans',
    sensualOutfit: 'a dark leather jacket over an elegant fitted top with a tasteful neckline, fully covered',
    framing: 'three-quarter fashion portrait',
    lighting: 'soft magenta-blue practical lights and natural skin tones',
    mood: 'playful confidence',
  },
  {
    id: 'gallery-afternoon', title: 'Gallery afternoon', style: 'soft-editorial', category: 'creative',
    action: 'standing beside a large abstract painting with a serene direct gaze',
    setting: 'a bright contemporary art gallery',
    safeOutfit: 'a flowing white blouse with tailored cream trousers',
    sensualOutfit: 'a softly draped white blouse over a matching camisole, fully covered',
    framing: 'three-quarter editorial photograph with clean architectural lines',
    lighting: 'soft skylight with delicate shadow detail',
    mood: 'thoughtful and refined',
  },
  {
    id: 'bookshop-discovery', title: 'Bookshop discovery', style: 'soft-editorial', category: 'everyday',
    action: 'holding an open art book and smiling softly toward the camera',
    setting: 'a quiet independent bookshop with warm wooden shelves',
    safeOutfit: 'a cream cardigan over a simple white top',
    sensualOutfit: 'a soft wrap cardigan over an elegant satin top, fully covered',
    framing: 'waist-up candid lifestyle portrait',
    lighting: 'warm window light with gentle background bokeh',
    mood: 'curious, calm, and approachable',
  },
  {
    id: 'morning-coffee', title: 'Morning coffee', style: 'tender', category: 'romantic',
    action: 'holding a warm coffee mug in both hands and smiling as if greeting someone she loves',
    setting: 'a cozy sunlit apartment kitchen',
    safeOutfit: 'an oversized cream sweater',
    sensualOutfit: 'a tasteful satin pajama top under a soft robe, fully buttoned and covered',
    framing: 'intimate waist-up candid photograph',
    lighting: 'gentle early-morning window light',
    mood: 'tender, familiar, and affectionate',
  },
  {
    id: 'couch-reading', title: 'Couch reading', style: 'tender', category: 'wellbeing',
    action: 'curled comfortably on a couch with a book, looking up with a warm smile',
    setting: 'a softly lit living room reading corner',
    safeOutfit: 'a relaxed cardigan, white tee, and dark lounge trousers',
    sensualOutfit: 'an elegant silk lounge set beneath a loose cardigan, fully covered',
    framing: 'medium lifestyle portrait with hands and book visible',
    lighting: 'warm lamp light balanced by soft blue-hour window light',
    mood: 'safe, peaceful, and emotionally close',
  },
  {
    id: 'flower-market', title: 'Flower market', style: 'playful', category: 'everyday',
    action: 'turning toward the camera while carrying a small bouquet and laughing naturally',
    setting: 'a colorful outdoor flower market',
    safeOutfit: 'a light summer dress with a denim jacket',
    sensualOutfit: 'a fitted summer dress with a tasteful neckline and a light jacket, fully covered',
    framing: 'three-quarter candid street photograph',
    lighting: 'bright diffused daylight with colorful bokeh',
    mood: 'spontaneous, joyful, and teasing',
  },
  {
    id: 'kitchen-dance', title: 'Kitchen dance', style: 'playful', category: 'romantic',
    action: 'dancing barefoot for a moment while preparing dinner, caught mid-laugh',
    setting: 'a warm modern home kitchen',
    safeOutfit: 'a tucked white tee and relaxed blue jeans',
    sensualOutfit: 'a fitted dark top and flowing midi skirt, fully covered',
    framing: 'full-body candid photograph with a natural sense of motion',
    lighting: 'warm pendant lights with soft evening fill',
    mood: 'flirty, domestic, and joyful',
  },
  {
    id: 'date-night', title: 'Date night', style: 'bold', category: 'romantic',
    action: 'waiting beside a candlelit table and meeting the camera with a confident gaze',
    setting: 'an elegant intimate restaurant with amber bokeh',
    safeOutfit: 'a sophisticated sleeveless black evening dress',
    sensualOutfit: 'a fitted black satin evening dress with a tasteful neckline, intimate areas fully covered',
    framing: 'waist-up cinematic date-night portrait',
    lighting: 'warm candlelight with a soft flattering key light',
    mood: 'confident, alluring, and affectionate',
  },
  {
    id: 'rooftop-evening', title: 'Rooftop evening', style: 'bold', category: 'adventure',
    action: 'resting one hand on a rooftop railing while the breeze moves her hair',
    setting: 'a stylish city rooftop at blue hour',
    safeOutfit: 'a tailored black blazer and high-waisted trousers',
    sensualOutfit: 'a tailored black blazer over a covered silk top with high-waisted trousers',
    framing: 'three-quarter fashion portrait with skyline context',
    lighting: 'cool twilight balanced by warm rooftop practicals',
    mood: 'self-assured and magnetic',
  },
  {
    id: 'birthday-lights', title: 'Birthday lights', style: 'sparkly', category: 'celebration',
    action: 'holding a small sparkling candle and smiling brightly at the camera',
    setting: 'a tasteful home celebration with delicate string lights',
    safeOutfit: 'a jewel-toned party dress with subtle earrings',
    sensualOutfit: 'an elegant sequined cocktail dress with a tasteful neckline, fully covered',
    framing: 'waist-up celebratory portrait',
    lighting: 'warm fairy lights and soft face illumination',
    mood: 'radiant, grateful, and excited',
  },
  {
    id: 'winter-lights', title: 'Winter lights', style: 'sparkly', category: 'romantic',
    action: 'walking beneath festive city lights and looking back with a joyful smile',
    setting: 'a winter pedestrian street glowing with warm decorations',
    safeOutfit: 'a long cream coat, scarf, and dark boots',
    sensualOutfit: 'a fitted dark dress beneath a long cream coat, fully covered',
    framing: 'three-quarter evening street portrait',
    lighting: 'golden decorative bokeh against cool evening ambience',
    mood: 'hopeful and romantic',
  },
  {
    id: 'sunset-balcony', title: 'Sunset balcony', style: 'calm', category: 'wellbeing',
    action: 'leaning gently on a balcony railing and breathing in the evening air',
    setting: 'a quiet balcony overlooking warm city rooftops',
    safeOutfit: 'a soft knit sweater and relaxed dark trousers',
    sensualOutfit: 'an off-shoulder knit sweater styled modestly with relaxed trousers, fully covered',
    framing: 'three-quarter environmental portrait',
    lighting: 'soft golden-hour rim light and natural skin tones',
    mood: 'serene, grounded, and reflective',
  },
  {
    id: 'quiet-window-tea', title: 'Quiet window tea', style: 'calm', category: 'wellbeing',
    action: 'sitting beside a window with a cup of tea and a peaceful half-smile',
    setting: 'a minimal bedroom reading nook on a cloudy morning',
    safeOutfit: 'a comfortable long-sleeve lounge set',
    sensualOutfit: 'a tasteful satin lounge set with a soft wrap cardigan, fully covered',
    framing: 'medium candid portrait with the window and cup visible',
    lighting: 'very soft north-window light',
    mood: 'quiet reassurance and closeness',
  },
  {
    id: 'urban-adventure', title: 'Urban adventure', style: 'mika', category: 'adventure',
    action: 'walking briskly across a modern pedestrian bridge with a confident grin',
    setting: 'a lively riverside city district',
    safeOutfit: 'a fitted dark adventure jacket, tee, and practical trousers',
    sensualOutfit: 'a cropped sport jacket over a fully covered athletic top and fitted trousers',
    framing: 'full-body dynamic lifestyle photograph',
    lighting: 'crisp late-afternoon daylight with subtle motion feel',
    mood: 'energetic and capable',
  },
  {
    id: 'weekend-hike', title: 'Weekend hike', style: 'mika', category: 'adventure',
    action: 'pausing on a scenic trail and turning toward the camera with a proud smile',
    setting: 'a green hillside trail with a distant valley',
    safeOutfit: 'a lightweight hiking jacket, fitted trail trousers, and walking shoes',
    sensualOutfit: 'a fitted athletic top beneath an open hiking jacket with trail trousers, fully covered',
    framing: 'three-quarter outdoor portrait with clear landscape context',
    lighting: 'fresh natural daylight with a soft sun edge',
    mood: 'adventurous and uplifting',
  },
  {
    id: 'natural-phone-selfie', title: 'Natural phone selfie', style: 'portrait', category: 'everyday',
    action: 'taking a simple candid phone selfie with a relaxed genuine expression',
    setting: 'a tidy apartment beside a neutral wall and a small plant',
    safeOutfit: 'a clean white tee and delicate gold necklace',
    sensualOutfit: 'a fitted dark camisole with a tasteful neckline and intimate areas fully covered',
    framing: 'arm-length head-and-shoulders phone photograph',
    lighting: 'soft indirect window light with realistic skin texture',
    mood: 'authentic and familiar',
  },
  {
    id: 'timeless-portrait', title: 'Timeless portrait', style: 'portrait', category: 'creative',
    action: 'facing the camera in a relaxed three-quarter pose',
    setting: 'a neutral charcoal portrait studio',
    safeOutfit: 'a simple black turtleneck',
    sensualOutfit: 'an elegant off-shoulder black top styled modestly and fully covered',
    framing: 'close 85mm editorial portrait with natural facial proportions',
    lighting: 'soft Rembrandt-inspired light with gentle shadow detail',
    mood: 'timeless, calm, and emotionally present',
  },
] as const;

const MOMENTS_BY_STYLE = new Map<AvatarStyleId, readonly MySoulmateImageMoment[]>(
  ([
    'studio', 'wet-selfie', 'street-rain', 'neon-skate', 'soft-editorial', 'tender',
    'playful', 'bold', 'sparkly', 'calm', 'mika', 'portrait',
  ] as const).map((style) => [
    style,
    MYSOULMATE_IMAGE_MOMENTS.filter((moment) => moment.style === style),
  ]),
);

export function listMySoulmateImageMoments(
  style?: AvatarStyleId,
): readonly MySoulmateImageMoment[] {
  return style ? (MOMENTS_BY_STYLE.get(style) ?? []) : MYSOULMATE_IMAGE_MOMENTS;
}

export function resolveMySoulmateImageMoment(
  style: AvatarStyleId,
  variation: number,
): MySoulmateImageMoment {
  const moments = MOMENTS_BY_STYLE.get(style) ?? [];
  if (moments.length === 0) throw new Error(`No MySoulmate image moments for style: ${style}`);
  return moments[Math.max(0, variation - 1) % moments.length]!;
}

/** Natural-language order: action → setting → clothing → camera → light → mood. */
export function buildMySoulmateMomentPrompt(
  moment: MySoulmateImageMoment,
  tier: GeneratableImageTier,
): string {
  const outfit = tier === 'sensual' ? moment.sensualOutfit : moment.safeOutfit;
  return [
    moment.action,
    `in ${moment.setting}`,
    `wearing ${outfit}`,
    moment.framing,
    moment.lighting,
    tier === 'sensual' ? 'adult subject, intimate areas fully covered' : undefined,
    `${moment.mood} mood`,
  ].filter(Boolean).join(', ');
}
