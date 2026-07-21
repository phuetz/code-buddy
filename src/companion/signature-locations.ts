/** Pure catalog of canonical empty environments used by Lisa fashion scenes. */

export type SignatureLocationId =
  | 'european-street-goldenhour'
  | 'stone-staircase'
  | 'balustrade-terrace'
  | 'cozy-loft-interior'
  | 'corner-cafe'
  | 'rooftop-dusk';

export type SignatureLocationAngle =
  | 'wide-establishing'
  | 'medium-frontal'
  | 'threequarter'
  | 'detail';

export type SignatureLocationFocal = '35mm' | '50mm' | '85mm';

export interface SignatureLocation {
  readonly locationId: SignatureLocationId;
  readonly label: string;
  readonly description: string;
  readonly angles: readonly SignatureLocationAngle[];
  readonly lightingSpec: string;
  readonly focal: Readonly<Record<SignatureLocationAngle, SignatureLocationFocal>>;
  readonly paletteTag: string;
}

interface LocationDraft extends SignatureLocation {
  readonly fixedStructures: string;
}

const ALL_ANGLES = [
  'wide-establishing',
  'medium-frontal',
  'threequarter',
  'detail',
] as const satisfies readonly SignatureLocationAngle[];

const DEFAULT_FOCALS: Readonly<Record<SignatureLocationAngle, SignatureLocationFocal>> = Object.freeze({
  'wide-establishing': '35mm',
  'medium-frontal': '50mm',
  threequarter: '50mm',
  detail: '85mm',
});

const DRAFTS: readonly LocationDraft[] = [
  {
    locationId: 'european-street-goldenhour',
    label: 'European Street at Golden Hour',
    description: 'A quiet old-European shopping street forms Lisa\'s warm urban landmark. Repeated stone bays and storefront rhythm make every angle immediately recognizable.',
    angles: ALL_ANGLES,
    lightingSpec: 'Golden hour at 18:40, warm sunlight from camera-left, softly diffused with long gentle shadows.',
    focal: DEFAULT_FOCALS,
    paletteTag: 'honey-stone-burgundy',
    fixedStructures: 'honey limestone facades, dark burgundy fabric awnings, brass storefront frames, parked compact cars, wet cobblestone paving, fixed iron street lamps',
  },
  {
    locationId: 'stone-staircase',
    label: 'Stone Staircase',
    description: 'A broad weathered staircase creates a graphic vertical route through an old masonry courtyard. Its shallow worn steps and twin landings provide stable depth cues.',
    angles: ALL_ANGLES,
    lightingSpec: 'Late morning at 10:20, cool daylight from high camera-right, soft and even with open shadows.',
    focal: DEFAULT_FOCALS,
    paletteTag: 'limestone-sage-charcoal',
    fixedStructures: 'worn pale-limestone steps, carved stone stringers, sage-painted doors, charcoal iron handrails, terracotta planters, fixed wall lanterns',
  },
  {
    locationId: 'balustrade-terrace',
    label: 'Balustrade Terrace',
    description: 'An elevated classical terrace overlooks a still garden and distant tiled roofs. Repeating balusters and clipped greenery give the setting a formal signature.',
    angles: ALL_ANGLES,
    lightingSpec: 'Early evening at 17:50, warm side light from camera-right, lightly diffused with crisp but gentle edge definition.',
    focal: DEFAULT_FOCALS,
    paletteTag: 'cream-stone-cypress-blue',
    fixedStructures: 'cream travertine balustrade, square stone piers, clipped cypress trees, fixed terracotta urns, pale gravel court, distant red-clay roof tiles',
  },
  {
    locationId: 'cozy-loft-interior',
    label: 'Cozy Loft Interior',
    description: 'Lisa\'s loft is a calm lived-in interior built around tall factory windows and warm timber. A consistent sofa, bookcase, and rug anchor its camera geography.',
    angles: ALL_ANGLES,
    lightingSpec: 'Afternoon at 15:30, diffused window light from camera-left, soft and natural with warm interior falloff.',
    focal: DEFAULT_FOCALS,
    paletteTag: 'walnut-rust-cream',
    fixedStructures: 'exposed red brick, black steel factory windows, walnut plank floor, rust linen sofa, cream wool rug, built-in oak bookcase, fixed ceramic table lamp',
  },
  {
    locationId: 'corner-cafe',
    label: 'Corner Café',
    description: 'A compact corner café offers a polished everyday setting behind curved street glazing. Bentwood furniture and a tiled service counter keep the room readable and recurrent.',
    angles: ALL_ANGLES,
    lightingSpec: 'Overcast morning at 09:10, cool window light from camera-front-right, broad and diffused with low contrast.',
    focal: DEFAULT_FOCALS,
    paletteTag: 'forest-green-cream-walnut',
    fixedStructures: 'forest-green painted storefront, curved glazing, cream zellige tile counter, walnut bentwood chairs, round marble tables, brass pendant lights, fixed pastry display',
  },
  {
    locationId: 'rooftop-dusk',
    label: 'Rooftop at Dusk',
    description: 'A restrained city rooftop frames the blue-hour skyline without visual clutter. Low parapets and a timber deck establish clear foreground geometry for vertical shots.',
    angles: ALL_ANGLES,
    lightingSpec: 'Blue hour at 20:35, fading skylight from camera-left with warm practical backlight, soft and balanced with clean silhouettes.',
    focal: DEFAULT_FOCALS,
    paletteTag: 'slate-blue-amber-concrete',
    fixedStructures: 'smooth concrete parapet, weathered timber deck, black steel pergola, fixed amber wall lights, rectangular concrete planters, static distant skyline',
  },
] as const;

export const SIGNATURE_LOCATIONS: Readonly<Record<SignatureLocationId, SignatureLocation>> = Object.freeze(
  Object.fromEntries(DRAFTS.map(({ fixedStructures: _fixedStructures, ...location }) => [
    location.locationId,
    Object.freeze(location),
  ])) as Record<SignatureLocationId, SignatureLocation>,
);

const LOCATION_DRAFTS: Readonly<Record<SignatureLocationId, LocationDraft>> = Object.freeze(
  Object.fromEntries(DRAFTS.map((location) => [location.locationId, location])) as Record<SignatureLocationId, LocationDraft>,
);

const ANGLE_DIRECTIONS: Readonly<Record<SignatureLocationAngle, string>> = Object.freeze({
  'wide-establishing': 'wide establishing view, eye-level camera, full spatial layout and foreground-to-background depth clearly visible',
  'medium-frontal': 'medium frontal view, eye-level camera, central architectural axis and fixed furnishings clearly readable',
  threequarter: 'three-quarter view from camera-right, layered architectural planes and stable perspective clearly readable',
  detail: 'architectural detail view, close study of the signature materials and fixed objects with the wider setting still identifiable',
});

/** Build a deterministic, production-ready photographic prompt for an empty plate. */
export function buildPlatePrompt(
  locationId: SignatureLocationId,
  angle: SignatureLocationAngle,
): string {
  const location = LOCATION_DRAFTS[locationId];
  if (!location) throw new Error(`Unknown signature location: ${locationId}`);
  if (!location.angles.includes(angle)) {
    throw new Error(`Angle ${angle} is not available for signature location ${locationId}`);
  }

  return [
    'strict photorealistic location plate',
    'native vertical 9:16 composition, 1080x1920',
    `${location.label}: ${location.fixedStructures}`,
    ANGLE_DIRECTIONS[angle],
    `simulated ${location.focal[angle]} photographic lens`,
    location.lightingSpec,
    `controlled ${location.paletteTag} color palette`,
    'static legible geometry, realistic material texture, natural depth, subtle fine photographic grain',
    'empty scene, no people',
    'no text, no letters, no logos, no watermarks, no moving vehicles',
  ].join(', ');
}
