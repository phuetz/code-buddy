import type { FlowCameraMove, FlowMediaMode } from './flow-studio-model';

export type FlowPresetId = 'companion-moment' | 'fashion-loop' | 'ootd-transition' | 'luxury-diary' | 'beauty-closeup' | 'persona-story';

export interface FlowStudioPreset {
  id: FlowPresetId;
  label: string;
  description: string;
  mode: FlowMediaMode;
  aspect: '1:1' | '16:9' | '9:16';
  duration: number;
  camera: FlowCameraMove;
  audio: boolean;
  voice: boolean;
  prompt: string;
  publication: boolean;
  editorial?: {
    title: string;
    description: string;
    series: string;
  };
}

export const FLOW_STUDIO_PRESETS: readonly FlowStudioPreset[] = [
  {
    id: 'companion-moment',
    label: 'Moment compagne',
    description: 'Image intime mais safe, naturelle et cohérente avec son identité.',
    mode: 'image', aspect: '1:1', duration: 6, camera: 'static', audio: false, voice: false, publication: false,
    prompt: 'Portrait lifestyle photoréaliste et chaleureux de la compagne numérique, expression naturelle, regard vivant, lumière douce, décor quotidien crédible, peau détaillée sans effet plastique.',
  },
  {
    id: 'fashion-loop',
    label: 'Fashion Short',
    description: 'Boucle verticale élégante, conçue pour une production régulière.',
    mode: 'video', aspect: '9:16', duration: 8, camera: 'dolly-back', audio: true, voice: false, publication: true,
    prompt: 'Vertical editorial fashion walk, full outfit visible, elegant confident movement, realistic fabric physics, premium street setting, golden-hour light, subtle seamless loop, tasteful styling, no text in image.',
    editorial: { title: 'Une promenade dorée avec Lisa', series: 'Les échappées de Lisa', description: 'Lisa traverse une rue baignée par la lumière de fin de journée. Un épisode court centré sur son allure, son expression et les détails vivants de la ville.' },
  },
  {
    id: 'ootd-transition',
    label: 'Tenue / OOTD',
    description: 'Transition de tenue avec silhouette et visage constants.',
    mode: 'video', aspect: '9:16', duration: 8, camera: 'orbit', audio: true, voice: false, publication: true,
    prompt: 'Vertical outfit-of-the-day reveal with one clean transition, same adult digital character before and after, perfectly consistent face and body, realistic garments, modern aspirational styling, crisp natural motion.',
    editorial: { title: 'Deux styles, une même personnalité', series: 'Le vestiaire de Lisa', description: 'Une transition de tenue pensée comme un petit choix de personnalité : même visage, même énergie, mais une allure transformée par quelques détails précis.' },
  },
  {
    id: 'luxury-diary',
    label: 'Journal lifestyle',
    description: 'Courte scène narrative dans un lieu aspirationnel crédible.',
    mode: 'video', aspect: '9:16', duration: 10, camera: 'pan-left', audio: true, voice: false, publication: true,
    prompt: 'A candid vertical lifestyle diary moment with an adult digital companion in an elegant café or city street, understated luxury, genuine micro-expression, environmental motion, cinematic but believable light.',
    editorial: { title: 'Une pause café loin du bruit', series: 'Le journal de Lisa', description: 'Lisa s’accorde une parenthèse calme au cœur de la ville. La scène privilégie les gestes naturels, les sons du lieu et une émotion discrète plutôt qu’une pose parfaite.' },
  },
  {
    id: 'beauty-closeup',
    label: 'Beauté éditoriale',
    description: 'Gros plan premium, mouvement minimal et détails réalistes.',
    mode: 'video', aspect: '9:16', duration: 6, camera: 'static', audio: true, voice: false, publication: true,
    prompt: 'Premium vertical beauty close-up of an adult digital model, subtle head turn and blink, realistic skin texture and hair strands, editorial makeup, soft key light, restrained motion, luxury campaign quality.',
    editorial: { title: 'La lumière change tout', series: 'Portraits de Lisa', description: 'Un portrait rapproché où la lumière révèle progressivement le regard et la texture naturelle de la peau. Le mouvement reste minimal pour laisser vivre l’expression.' },
  },
  {
    id: 'persona-story',
    label: 'Micro-récit incarné',
    description: 'Personnage reconnaissable, voix et intention en un seul plan.',
    mode: 'video', aspect: '9:16', duration: 10, camera: 'static', audio: true, voice: true, publication: true,
    prompt: 'A recognizable adult virtual host delivers one short, warm and useful thought to camera, natural gestures, clean lip sync, consistent voice and identity, uncluttered vertical composition, authentic creator tone.',
    editorial: { title: 'La pensée douce du jour', series: 'Une minute avec Lisa', description: 'Lisa partage une idée simple et personnelle face caméra. Cet épisode privilégie une voix naturelle, un conseil concret et une présence reconnaissable.' },
  },
] as const;

export function findFlowPreset(id: string): FlowStudioPreset | undefined {
  return FLOW_STUDIO_PRESETS.find((preset) => preset.id === id);
}
