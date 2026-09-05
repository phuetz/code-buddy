/**
 * AssistantView — full-page panel for the local voice assistant mode.
 *
 * The renderer stays schema-driven: the core module provides settings, current
 * values, and Pocket voices through the preload `assistant` API.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  Download,
  FileAudio,
  Headphones,
  Keyboard,
  Loader2,
  Mic2,
  Power,
  Play,
  Radio,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';

type AssistantSettingGroup = 'voice' | 'speech' | 'behavior' | 'companion';
type AssistantSettingType = 'toggle' | 'enum' | 'text' | 'voice' | 'volume';

interface AssistantSetting {
  key: string;
  label: string;
  group: AssistantSettingGroup;
  type: AssistantSettingType;
  options?: string[];
  default: string;
  help: string;
}

interface AssistantErrorResponse {
  ok: false;
  error: string;
}

interface AssistantVoiceTransition {
  sequence: number;
  at: string;
  turnId: string;
  phase: string;
  decisionReason?: string;
  suppressionReason?: string;
  scene?: string;
  sceneConfidence?: number;
  firstAudioMs?: number;
  totalMs?: number;
  aecActive?: boolean;
}

interface AssistantVoiceDiagnostics {
  updatedAt: string;
  phase: string;
  attention?: {
    engaged: boolean;
    source?: string;
    remainingMs: number;
    dialogueAgeMs: number;
    closeReason?: string;
  };
  counters: {
    captured: number;
    accepted: number;
    spoken: number;
    suppressed: number;
    interrupted: number;
    failed: number;
  };
  recent: AssistantVoiceTransition[];
}

interface VoiceboxStudioProfile {
  id: string;
  name: string;
  description?: string | null;
  language?: string;
  voice_type?: string;
  default_engine?: string | null;
  preset_engine?: string | null;
  preset_voice_id?: string | null;
  sample_count?: number;
  generation_count?: number;
}

interface VoiceboxStudioSnapshot {
  available: boolean;
  baseUrl: string;
  configuredProfile?: string;
  profiles: VoiceboxStudioProfile[];
  models: Array<{
    model_name: string;
    display_name: string;
    downloaded: boolean;
    downloading?: boolean;
    loaded?: boolean;
    size_mb?: number | null;
  }>;
  presetVoices: Array<{
    voice_id: string;
    name: string;
    gender: string;
    language: string;
    engine: 'kokoro' | 'qwen_custom_voice';
  }>;
  health?: {
    status: string;
    model_loaded: boolean;
    gpu_available: boolean;
    gpu_type?: string | null;
    vram_used_mb?: number | null;
    backend_type?: string | null;
    backend_variant?: string | null;
  };
  languages: readonly string[];
  engine: string;
  error?: string;
  hint?: string;
}

type VoiceboxModel = VoiceboxStudioSnapshot['models'][number];

async function playWavBytes(audio: Uint8Array): Promise<void> {
  const copy = new Uint8Array(audio.byteLength);
  copy.set(audio);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'audio/wav' }));
  try {
    await new Promise<void>((resolve, reject) => {
      const player = new Audio(url);
      player.onended = () => resolve();
      player.onerror = () => reject(new Error('Lecture de l’aperçu Voicebox impossible'));
      void player.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const GROUP_ORDER: AssistantSettingGroup[] = ['voice', 'speech', 'behavior', 'companion'];

const GROUP_META: Record<
  AssistantSettingGroup,
  { title: string; subtitle: string; icon: LucideIcon }
> = {
  voice: {
    title: 'Voix',
    subtitle: 'Moteur, langue et voix utilisée par le robot.',
    icon: Volume2,
  },
  speech: {
    title: 'Parole',
    subtitle: 'Sortie vocale et posture utilisée pour les actions parlées.',
    icon: Mic2,
  },
  behavior: {
    title: 'Comportement',
    subtitle: 'Nom du robot, écoute active et règles de réponse.',
    icon: Settings2,
  },
  companion: {
    title: 'Companion',
    subtitle: 'Présence, rappels, mémoire relationnelle et proactivité.',
    icon: Bot,
  },
};

const LABEL_OVERRIDES: Record<string, string> = {
  CODEBUDDY_TTS_ENGINE: 'Moteur vocal',
  CODEBUDDY_POCKET_VOICE: 'Voix Pocket',
  CODEBUDDY_POCKET_LANG: 'Langue Pocket',
  CODEBUDDY_POCKET_SERVER: 'Garder Pocket en mémoire',
  CODEBUDDY_POCKET_URL: 'Serveur Pocket local',
  CODEBUDDY_VOICEBOX_URL: 'Serveur Voicebox',
  CODEBUDDY_VOICEBOX_PROFILE: 'Profil vocal Voicebox',
  CODEBUDDY_VOICEBOX_ENGINE: 'Moteur Voicebox',
  CODEBUDDY_VOICEBOX_LANGUAGE: 'Langue Voicebox',
  CODEBUDDY_VOICEBOX_MODEL_SIZE: 'Taille du modèle Voicebox',
  CODEBUDDY_VOICEBOX_INSTRUCT: 'Interprétation de la voix',
  CODEBUDDY_VOICEBOX_AUDIO_STREAM: 'Diffuser le son Voicebox',
  CODEBUDDY_TTS_VOLUME: 'Volume de Lisa',
  CODEBUDDY_TTS_VOICE: 'Voix Piper de secours',
  CODEBUDDY_SENSORY_SPEAK: 'Parole activée',
  CODEBUDDY_SENSORY_SPEAK_ACT: 'Annoncer les actions',
  CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'Posture d’action',
  CODEBUDDY_SENSORY_SPEAK_MODEL: 'Modèle de parole',
  CODEBUDDY_SENSORY_SPEECH: 'Écoute activée',
  CODEBUDDY_ROBOT_NAME: 'Nom du robot',
  CODEBUDDY_SENSORY_ALWAYS_RESPOND: 'Toujours répondre',
  CODEBUDDY_SENSORY_CHIME_IN: 'Intervenir spontanément',
  CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS: 'Fenêtre de suivi',
  BUDDY_SENSE_AEC: 'Annulation d’écho acoustique',
  BUDDY_SENSE_AEC_SOURCE: 'Source AEC PipeWire/PulseAudio',
  CODEBUDDY_SPEECH_LANG: 'Langue d’écoute',
  CODEBUDDY_SENSORY_GREET: 'Salutations',
  CODEBUDDY_REMINDERS: 'Rappels',
  CODEBUDDY_COMPANION_RELATIONAL: 'Mémoire relationnelle',
  CODEBUDDY_CONVERSATION_COWORK: 'Continuité Cowork ↔ Lisa',
  CODEBUDDY_CONVERSATION_MIRROR_COWORK: 'Publier les tours Cowork',
  CODEBUDDY_CONVERSATION_COWORK_HISTORY: 'Tours partagés dans Cowork',
  CODEBUDDY_COMPANION_PROACTIVE: 'Companion proactif',
  CODEBUDDY_VOICE_IMPROVE: 'Amélioration vocale',
  CODEBUDDY_AVATAR_BRIDGE: 'Pont avatar MetaHuman',
  CODEBUDDY_AVATAR_STREAM_AUDIO: 'Audio vers MetaHuman',
};

const HELP_OVERRIDES: Record<string, string> = {
  CODEBUDDY_TTS_ENGINE: 'Choisit le moteur de synthèse vocale.',
  CODEBUDDY_POCKET_VOICE: 'Sélectionne une voix Pocket ou un échantillon de clonage court.',
  CODEBUDDY_POCKET_LANG: 'Langue transmise au moteur Pocket.',
  CODEBUDDY_POCKET_SERVER:
    'Garde le modèle Pocket chargé entre les phrases pour supprimer son coût de redémarrage.',
  CODEBUDDY_POCKET_URL: 'Endpoint local du serveur Pocket persistant.',
  CODEBUDDY_VOICEBOX_URL:
    'Endpoint REST Voicebox, local ou sur GPU node via le réseau Tailscale de confiance.',
  CODEBUDDY_VOICEBOX_PROFILE: 'Nom ou identifiant du profil vocal de Lisa dans Voicebox.',
  CODEBUDDY_VOICEBOX_ENGINE: 'Backend de rendu choisi par Voicebox.',
  CODEBUDDY_VOICEBOX_LANGUAGE: 'Code de langue transmis au rendu Voicebox.',
  CODEBUDDY_VOICEBOX_MODEL_SIZE:
    '1.7B privilégie la qualité sur GPU node ; 0.6B réduit la latence.',
  CODEBUDDY_VOICEBOX_INSTRUCT:
    'Décrit seulement le ton, le rythme et la chaleur. Voicebox ne réécrit jamais les paroles de Lisa.',
  CODEBUDDY_VOICEBOX_AUDIO_STREAM:
    'Envoie le WAV à la sortie et à l’avatar dès son arrivée depuis Voicebox.',
  CODEBUDDY_TTS_VOLUME:
    'Volume propre à la voix. À 100 %, Pocket et Piper sont normalisés sans saturation.',
  CODEBUDDY_TTS_VOICE: 'Chemin du modèle Piper .onnx utilisé en secours.',
  CODEBUDDY_SENSORY_SPEAK: 'Autorise les réponses parlées du daemon vision.',
  CODEBUDDY_SENSORY_SPEAK_ACT: 'Autorise les retours vocaux pendant les actions.',
  CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE:
    'Posture locale à chaque tour vocal. Elle ne modifie jamais le mode plan d’une session de code.',
  CODEBUDDY_SENSORY_SPEAK_MODEL: 'Modèle utilisé pour formuler les réponses parlées.',
  CODEBUDDY_SENSORY_SPEECH: 'Active l’entrée vocale du daemon sensoriel.',
  CODEBUDDY_ROBOT_NAME: 'Nom utilisé par l’assistant pour se présenter.',
  CODEBUDDY_SENSORY_ALWAYS_RESPOND: 'Répond même si la phrase ne l’appelle pas clairement.',
  CODEBUDDY_SENSORY_CHIME_IN: 'Autorise de courtes interventions opportunistes.',
  CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS:
    'Durée en millisecondes pendant laquelle le suivi reste actif.',
  BUDDY_SENSE_AEC:
    'Choisit automatiquement une source echo-cancel et garde le filtre sémantique en secours.',
  BUDDY_SENSE_AEC_SOURCE:
    'Laisse vide pour détecter automatiquement la source virtuelle d’annulation d’écho.',
  CODEBUDDY_SPEECH_LANG: 'Code de langue principal pour la reconnaissance vocale.',
  CODEBUDDY_SENSORY_GREET: 'Active les salutations du companion.',
  CODEBUDDY_REMINDERS: 'Active les rappels companion.',
  CODEBUDDY_COMPANION_RELATIONAL: 'Injecte le contexte relationnel dans les réponses companion.',
  CODEBUDDY_CONVERSATION_COWORK:
    'Autorise uniquement les sessions Cowork marquées Lisa à reprendre le fil voix et Telegram.',
  CODEBUDDY_CONVERSATION_MIRROR_COWORK:
    'Publie sur le canal configuré les tours des sessions Cowork explicitement reliées.',
  CODEBUDDY_CONVERSATION_COWORK_HISTORY:
    'Nombre de tours récents voix, Telegram et Cowork injectés dans une session Lisa (4 à 80).',
  CODEBUDDY_COMPANION_PROACTIVE: 'Autorise les comportements proactifs du companion.',
  CODEBUDDY_VOICE_IMPROVE: 'Active la boucle d’amélioration de l’assistant vocal.',
  CODEBUDDY_AVATAR_BRIDGE:
    'Publie les intentions de jeu, la parole et les interruptions vers Unreal/MetaHuman.',
  CODEBUDDY_AVATAR_STREAM_AUDIO:
    'En mode automatique, transmet le WAV seulement lorsqu’un renderer compatible répond au heartbeat.',
};

const OPTION_LABELS: Record<string, Record<string, string>> = {
  CODEBUDDY_TTS_ENGINE: {
    pocket: 'Pocket TTS — recommandé',
    voicebox: 'Voicebox — expressif sur GPU',
    piper: 'Piper — secours ancien',
  },
  CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: {
    default: 'Normal sécurisé — recommandé',
    dontAsk: 'Agir sans demander',
    bypassPermissions: 'Mode autonome complet',
  },
  CODEBUDDY_AVATAR_STREAM_AUDIO: {
    auto: 'Automatique — recommandé',
    true: 'Toujours transmettre',
    false: 'Ne jamais transmettre',
  },
  BUDDY_SENSE_AEC: {
    auto: 'Automatique — recommandé',
    off: 'Désactivé',
  },
};

function normalizeValues(
  settings: AssistantSetting[],
  values: Record<string, string>
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const setting of settings) {
    normalized[setting.key] = values[setting.key] ?? setting.default;
  }
  return normalized;
}

function fieldLabel(setting: AssistantSetting): string {
  return LABEL_OVERRIDES[setting.key] ?? setting.label;
}

function fieldHelp(setting: AssistantSetting): string {
  return HELP_OVERRIDES[setting.key] ?? setting.help;
}

function optionLabel(setting: AssistantSetting, value: string): string {
  return OPTION_LABELS[setting.key]?.[value] ?? value;
}

function isAssistantError(value: unknown): value is AssistantErrorResponse {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

const PHASE_LABELS: Record<string, string> = {
  idle: 'En veille',
  listening: 'Écoute',
  transcribing: 'Transcription',
  deciding: 'Décision',
  thinking: 'Réflexion',
  speaking: 'Parole',
  interrupted: 'Interrompue',
  suppressed: 'Silence choisi',
  completed: 'Tour terminé',
  failed: 'Erreur',
};

function durationLabel(ms: number): string {
  return ms >= 1_000 ? `${Math.round(ms / 1_000)} s` : `${Math.round(ms)} ms`;
}

function VoiceDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: AssistantVoiceDiagnostics | null;
}) {
  const capture = diagnostics
    ? [...diagnostics.recent].reverse().find((item) => item.aecActive !== undefined)
    : undefined;
  const scene = diagnostics
    ? [...diagnostics.recent].reverse().find((item) => item.scene !== undefined)
    : undefined;
  const recent = diagnostics ? [...diagnostics.recent.slice(-6)].reverse() : [];

  return (
    <section
      className="shrink-0 overflow-hidden rounded-lg border border-border bg-surface"
      data-testid="assistant-voice-diagnostics"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <Activity className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">Boucle vocale en temps réel</h2>
            <p className="text-xs text-muted-foreground">
              État brut-sûr du micro jusqu’à MetaHuman, sans conserver les phrases.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${diagnostics ? 'bg-success' : 'bg-muted-foreground'}`}
          />
          {diagnostics ? PHASE_LABELS[diagnostics.phase] ?? diagnostics.phase : 'En attente du daemon'}
        </span>
      </header>

      {diagnostics ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1fr_1.4fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Radio className="h-3.5 w-3.5" /> Attention
            </div>
            <div className="rounded-md bg-muted/40 p-3 text-xs">
              <div className="font-medium">
                {diagnostics.attention?.engaged ? 'Conversation ouverte' : 'Écoute ambiante'}
              </div>
              <div className="mt-1 text-muted-foreground">
                {diagnostics.attention?.engaged
                  ? `${durationLabel(diagnostics.attention.remainingMs)} restantes · ${diagnostics.attention.source ?? 'dialogue'}`
                  : diagnostics.attention?.closeReason ?? 'Lisa attend une adresse claire.'}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              AEC {capture?.aecActive ? 'actif' : 'repli anti-écho sémantique'}
            </div>
            <div className="text-xs text-muted-foreground">
              Scène : {scene?.scene ?? 'inconnue'}
              {scene?.sceneConfidence !== undefined
                ? ` · ${Math.round(scene.sceneConfidence * 100)} %`
                : ''}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium">Compteurs de session</div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {Object.entries(diagnostics.counters).map(([label, value]) => (
                <div key={label} className="rounded-md bg-muted/40 p-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <div className="text-xs font-medium">Transitions récentes</div>
            <div className="mt-3 space-y-1.5" aria-live="polite">
              {recent.length > 0 ? recent.map((item) => (
                <div
                  key={item.sequence}
                  className="grid grid-cols-[82px_1fr_auto] items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs"
                >
                  <span className="font-medium">{PHASE_LABELS[item.phase] ?? item.phase}</span>
                  <span className="truncate text-muted-foreground">
                    {item.decisionReason ?? item.suppressionReason ?? item.scene ?? '—'}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {item.totalMs !== undefined
                      ? durationLabel(item.totalMs)
                      : item.firstAudioMs !== undefined
                        ? durationLabel(item.firstAudioMs)
                        : ''}
                  </span>
                </div>
              )) : (
                <p className="text-xs text-muted-foreground">Aucun tour vocal depuis le démarrage.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          Le tableau s’activera au prochain événement du daemon vocal.
        </p>
      )}
    </section>
  );
}

function VoiceboxStudioPanel({
  onProfileSelected,
}: {
  onProfileSelected: (profile: VoiceboxStudioProfile) => void;
}) {
  const [studio, setStudio] = useState<VoiceboxStudioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creationMode, setCreationMode] = useState<'clone' | 'preset'>('preset');
  const [name, setName] = useState('Lisa');
  const [language, setLanguage] = useState('fr');
  const [description, setDescription] = useState('Voix principale de Lisa');
  const [referenceText, setReferenceText] = useState('');
  const [presetKey, setPresetKey] = useState('kokoro:ff_siwis');
  const [previewText, setPreviewText] = useState(
    'Bonjour Patrice. Je suis heureuse de pouvoir enfin te parler avec ma propre voix.'
  );
  const [sample, setSample] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [playingProfile, setPlayingProfile] = useState<string | null>(null);
  const [modelBusy, setModelBusy] = useState<string | null>(null);
  const [dictation, setDictation] = useState<{
    available: boolean;
    accelerator: string;
    platform: string;
  } | null>(null);

  const refresh = async (): Promise<void> => {
    const api = window.electronAPI?.assistant;
    if (!api?.voiceboxStudio) {
      setError('Administration Voicebox indisponible dans cette version de Cowork.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.voiceboxStudio();
      if (isAssistantError(result)) throw new Error(result.error);
      const snapshot = result as VoiceboxStudioSnapshot;
      setStudio(snapshot);
      if (snapshot.error) setError(snapshot.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void window.electronAPI?.voice?.dictationStatus?.().then((status) => {
      setDictation({
        available: status.available,
        accelerator: status.accelerator,
        platform: status.platform,
      });
    }).catch(() => undefined);
  }, []);

  const hasDownloadingModel = studio?.models.some((model) => model.downloading) ?? false;
  useEffect(() => {
    if (!hasDownloadingModel) return;
    const timer = setInterval(() => void refresh(), 2_500);
    return () => clearInterval(timer);
  }, [hasDownloadingModel]);

  const createClone = async (): Promise<void> => {
    const api = window.electronAPI?.assistant;
    if (!api?.voiceboxClone || !sample) return;
    if (sample.size > 50 * 1024 * 1024) {
      setError('L’échantillon dépasse la limite Voicebox de 50 Mio.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.voiceboxClone({
        name: name.trim(),
        description: description.trim() || undefined,
        language,
        referenceText: referenceText.trim(),
        filename: sample.name,
        audio: await sample.arrayBuffer(),
        consent,
      });
      if (isAssistantError(result)) throw new Error(result.error);
      onProfileSelected(result.profile);
      setNotice(`Profil « ${result.profile.name} » cloné et sélectionné. Clique Appliquer pour l’utiliser.`);
      setSample(null);
      setReferenceText('');
      setConsent(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createPreset = async (): Promise<void> => {
    const api = window.electronAPI?.assistant;
    if (!api?.voiceboxPreset) return;
    const preset = studio?.presetVoices.find(
      (voice) => `${voice.engine}:${voice.voice_id}` === presetKey
    );
    if (!preset) {
      setError('Choisis une voix prédéfinie disponible.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.voiceboxPreset({
        name: name.trim(),
        description: description.trim() || undefined,
        language: preset.language,
        engine: preset.engine,
        voiceId: preset.voice_id,
      });
      if (isAssistantError(result)) throw new Error(result.error);
      onProfileSelected(result.profile);
      setNotice(
        `Voix « ${result.profile.name} » créée depuis ${preset.name}. Écoute-la puis clique Appliquer pour l’utiliser.`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const previewProfile = async (profile: VoiceboxStudioProfile): Promise<void> => {
    const api = window.electronAPI?.assistant;
    if (!api?.voiceboxPreview) return;
    setPlayingProfile(profile.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.voiceboxPreview({
        profileId: profile.id,
        text: previewText,
        engine: profile.default_engine ?? studio?.engine ?? 'qwen',
      });
      if (isAssistantError(result)) throw new Error(result.error);
      await playWavBytes(result.audio);
      setNotice(`Aperçu de « ${profile.name} » terminé.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlayingProfile(null);
    }
  };

  const runModelAction = async (
    model: VoiceboxModel,
    action: 'download' | 'cancel' | 'unload' | 'delete'
  ): Promise<void> => {
    const api = window.electronAPI?.assistant;
    if (!api?.voiceboxModel) return;
    const confirmed = action !== 'delete' || window.confirm(
      `Supprimer ${model.display_name} de GPU node${model.size_mb ? ` (${(model.size_mb / 1024).toFixed(1)} Gio)` : ''} ?`
    );
    if (!confirmed) return;
    setModelBusy(model.model_name);
    setError(null);
    setNotice(null);
    try {
      const result = await api.voiceboxModel({
        modelName: model.model_name,
        action,
        confirmed,
      });
      if (isAssistantError(result)) throw new Error(result.error);
      setNotice(result.message);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelBusy(null);
    }
  };

  const removeProfile = async (profile: VoiceboxStudioProfile): Promise<void> => {
    const api = window.electronAPI?.assistant;
    if (!api?.voiceboxDelete) return;
    const confirmed = window.confirm(
      `Supprimer définitivement le profil vocal « ${profile.name} » et ses échantillons ?`
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.voiceboxDelete(profile.id, true);
      if (isAssistantError(result)) throw new Error(result.error);
      setNotice(`Profil « ${profile.name} » supprimé.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const downloadedModels = studio?.models.filter((model) => model.downloaded).length ?? 0;
  const gpuLabel = studio?.health?.gpu_available
    ? (studio.health.gpu_type ?? 'actif').replace(/^CUDA \(NVIDIA GeForce (.+)\)$/u, 'CUDA · $1')
    : 'CPU';
  const dictationLabel = dictation?.accelerator.replace(
    'CommandOrControl',
    dictation.platform === 'darwin' ? 'Cmd' : 'Ctrl'
  );
  return (
    <section className="shrink-0 overflow-hidden rounded-lg border border-border bg-surface" data-testid="voicebox-studio">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <FileAudio className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">Studio vocal local Voicebox</h2>
            <p className="text-xs text-muted-foreground">
              Voix locales prédéfinies ou clonées, aperçus, modèles GPU et 23 langues, sans abonnement vocal.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || busy}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </header>

      {error ? (
        <div className="m-4 rounded-md border border-error/30 bg-error/10 p-3 text-xs text-error">
          {error}
          {studio?.hint ? <div className="mt-1 text-muted-foreground">{studio.hint}</div> : null}
        </div>
      ) : null}
      {notice ? (
        <div className="m-4 rounded-md border border-success/30 bg-success/10 p-3 text-xs text-success">{notice}</div>
      ) : null}

      {studio ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.35fr]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-muted-foreground">Serveur</div>
                <div className="mt-1 font-medium">{studio.health?.status ?? (studio.available ? 'prêt' : 'indisponible')}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-muted-foreground">GPU</div>
                <div className="mt-1 font-medium" title={studio.health?.gpu_type ?? undefined}>{gpuLabel}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-muted-foreground">Modèles</div>
                <div className="mt-1 font-medium">{downloadedModels}/{studio.models.length}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="flex items-center gap-1 text-muted-foreground"><Keyboard className="h-3 w-3" />Dictée</div>
                <div className="mt-1 truncate font-medium" title={dictation?.accelerator}>{dictation?.available ? dictationLabel : 'indisponible'}</div>
              </div>
            </div>
            <div className="truncate text-xs text-muted-foreground" title={studio.baseUrl}>{studio.baseUrl}</div>
            <label className="block text-xs text-muted-foreground">
              Phrase d’aperçu
              <input
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
                maxLength={500}
                className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground"
              />
            </label>
            <div className="space-y-2">
              {studio.profiles.length > 0 ? studio.profiles.map((profile) => (
                <div key={profile.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onProfileSelected(profile)}
                    className="min-w-0 flex-1 text-left"
                    title="Sélectionner ce profil puis cliquer Appliquer"
                  >
                    <div className="truncate font-medium">{profile.name}</div>
                    <div className="truncate text-muted-foreground">
                      {profile.voice_type === 'preset' ? 'prédéfinie' : 'clonée'} · {profile.language ?? 'auto'} · {profile.default_engine ?? 'qwen'}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void previewProfile(profile)}
                    disabled={Boolean(playingProfile) || busy}
                    aria-label={`Écouter ${profile.name}`}
                    className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                  >
                    {playingProfile === profile.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeProfile(profile)}
                    disabled={busy}
                    aria-label={`Supprimer ${profile.name}`}
                    className="rounded p-1.5 text-muted-foreground hover:bg-error/10 hover:text-error disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )) : (
                <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">Aucun profil vocal. Crée le premier à droite.</p>
              )}
            </div>
            <details className="rounded-md border border-border text-xs">
              <summary className="cursor-pointer select-none px-3 py-2 font-medium">
                Gérer les modèles ({downloadedModels}/{studio.models.length})
              </summary>
              <div className="max-h-72 space-y-1 overflow-y-auto border-t border-border p-2">
                {studio.models.map((model) => (
                  <div key={model.model_name} className="flex items-center gap-2 rounded bg-muted/30 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium" title={model.display_name}>{model.display_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {model.loaded
                          ? 'chargé en VRAM'
                          : model.downloading
                            ? 'téléchargement…'
                            : model.downloaded
                              ? `${model.size_mb ? `${(model.size_mb / 1024).toFixed(1)} Gio · ` : ''}sur disque`
                              : 'non installé'}
                      </div>
                    </div>
                    {model.downloading ? (
                      <button type="button" onClick={() => void runModelAction(model, 'cancel')} disabled={modelBusy === model.model_name} className="rounded border border-border px-2 py-1 hover:bg-muted">Annuler</button>
                    ) : !model.downloaded ? (
                      <button type="button" onClick={() => void runModelAction(model, 'download')} disabled={modelBusy === model.model_name} className="rounded border border-border p-1.5 hover:bg-muted" aria-label={`Télécharger ${model.display_name}`}><Download className="h-3.5 w-3.5" /></button>
                    ) : (
                      <>
                        {model.loaded ? <button type="button" onClick={() => void runModelAction(model, 'unload')} disabled={modelBusy === model.model_name} className="rounded border border-border px-2 py-1 hover:bg-muted">Libérer</button> : null}
                        <button type="button" onClick={() => void runModelAction(model, 'delete')} disabled={modelBusy === model.model_name} className="rounded p-1.5 text-muted-foreground hover:bg-error/10 hover:text-error" aria-label={`Supprimer le modèle ${model.display_name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div>
              <div className="text-sm font-medium">Créer une voix</div>
              <p className="text-xs text-muted-foreground">
                Choisis une voix locale disponible ou clone un échantillon autorisé.
              </p>
            </div>
            <div className="grid grid-cols-2 rounded-md bg-muted/50 p-1 text-xs">
              <button
                type="button"
                aria-pressed={creationMode === 'preset'}
                onClick={() => setCreationMode('preset')}
                className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 ${creationMode === 'preset' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
              >
                <Sparkles className="h-3.5 w-3.5" /> Prédéfinie
              </button>
              <button
                type="button"
                aria-pressed={creationMode === 'clone'}
                onClick={() => setCreationMode('clone')}
                className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 ${creationMode === 'clone' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
              >
                <FileAudio className="h-3.5 w-3.5" /> Cloner
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nom du profil" maxLength={100} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
              <select value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                {(studio.languages.length > 0 ? studio.languages : ['fr', 'en']).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description facultative" maxLength={500} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            {creationMode === 'preset' ? (
              <>
                <select
                  value={presetKey}
                  onChange={(event) => {
                    setPresetKey(event.target.value);
                    const selected = studio.presetVoices.find(
                      (voice) => `${voice.engine}:${voice.voice_id}` === event.target.value
                    );
                    if (selected) setLanguage(selected.language);
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {studio.presetVoices.map((voice) => (
                    <option key={`${voice.engine}:${voice.voice_id}`} value={`${voice.engine}:${voice.voice_id}`}>
                      {voice.name} · {voice.language} · {voice.gender === 'female' ? 'féminine' : 'masculine'} · {voice.engine}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Siwis est la voix féminine française de Kokoro. Les voix prédéfinies ne copient aucune personne réelle.
                </p>
                <button
                  type="button"
                  onClick={() => void createPreset()}
                  disabled={busy || !name.trim() || studio.presetVoices.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Créer le profil prédéfini
                </button>
              </>
            ) : (
              <>
                <textarea value={referenceText} onChange={(event) => setReferenceText(event.target.value)} placeholder="Transcription exacte de l’échantillon…" maxLength={1000} rows={2} className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm" />
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" />
                  <span className="truncate">{sample?.name ?? 'Choisir WAV, MP3, M4A, OGG, FLAC, AAC, WebM ou Opus'}</span>
                  <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac,.webm,.opus" className="sr-only" onChange={(event) => setSample(event.target.files?.[0] ?? null)} />
                </label>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />
                  Je confirme avoir le droit et l’autorisation explicite de cloner cette voix.
                </label>
                <button
                  type="button"
                  onClick={() => void createClone()}
                  disabled={busy || !sample || !name.trim() || !referenceText.trim() || !consent}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Créer le profil cloné
                </button>
              </>
            )}
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Connexion à Voicebox…</div>
      ) : null}
    </section>
  );
}

export function AssistantView() {
  const [settings, setSettings] = useState<AssistantSetting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [voices, setVoices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<AssistantVoiceDiagnostics | null>(null);
  // Editable sentence used by « Écouter ». Kept in sync with the core default
  // (DEFAULT_VOICE_PREVIEW_TEXT) so the mount pre-warm hits the same cache entry.
  const [previewText, setPreviewText] = useState(
    'Bonjour ! Voici un aperçu de ma voix. Est-ce qu’elle te plaît ?'
  );

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const assistant = window.electronAPI?.assistant;
      if (!assistant) {
        setError('API Assistant indisponible.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await assistant.get();
        if (cancelled) return;

        const loadedSettings = result.settings ?? [];
        const loadedValues = normalizeValues(loadedSettings, result.values ?? {});
        setSettings(loadedSettings);
        setValues(loadedValues);
        setInitialValues(loadedValues);
        setVoices(result.voices ?? []);
        if (isAssistantError(result)) setError(result.error);
        // Pre-warm the active voice's preview so the first « Écouter » is instant
        // (cache-gated in the core → no re-synthesis if already cached). Fire-and-forget.
        const activeVoice = (loadedValues.CODEBUDDY_POCKET_VOICE ?? '').trim();
        if (activeVoice) void assistant.preview(activeVoice).catch(() => undefined);
        // Load the current system output volume for the slider (best-effort).
        try {
          const vol = await assistant.getVolume();
          if (!cancelled && !isAssistantError(vol)) setVolume(vol.volume);
        } catch {
          /* volume unavailable — hide the slider */
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const result = await window.electronAPI?.assistant?.diagnostics?.();
        if (!cancelled && result && !isAssistantError(result)) {
          setDiagnostics(result.diagnostics);
        }
      } catch {
        // The config panel remains usable when the resident daemon is offline.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1_500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const groupedSettings = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        items: settings.filter((setting) => setting.group === group),
      })).filter((entry) => entry.items.length > 0),
    [settings]
  );

  const changedValues = useMemo(() => {
    const changed: Record<string, string> = {};
    for (const setting of settings) {
      const next = values[setting.key] ?? setting.default;
      const previous = initialValues[setting.key] ?? setting.default;
      if (next !== previous) changed[setting.key] = next;
    }
    return changed;
  }, [initialValues, settings, values]);

  const changedCount = Object.keys(changedValues).length;

  const setField = (key: string, value: string): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
    setError(null);
  };

  const previewVoice = async (setting: AssistantSetting): Promise<void> => {
    const assistant = window.electronAPI?.assistant;
    if (!assistant) {
      setError('API Assistant indisponible.');
      return;
    }

    const voice = (values[setting.key] ?? setting.default).trim();
    if (!voice) {
      setError('Sélectionne une voix avant de lancer l’aperçu.');
      return;
    }

    setPreviewing(setting.key);
    setError(null);
    setNotice(null);
    try {
      const result = await assistant.playPreview(voice, previewText);
      if (isAssistantError(result)) throw new Error(result.error);
      setNotice(`Aperçu de « ${voice} » joué.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(null);
    }
  };

  const changeVolume = (pct: number): void => {
    setVolume(pct);
    const assistant = window.electronAPI?.assistant;
    if (assistant?.setVolume) void assistant.setVolume(pct).catch(() => undefined);
  };

  const applyChanges = async (): Promise<void> => {
    const assistant = window.electronAPI?.assistant;
    if (!assistant) {
      setError('API Assistant indisponible.');
      return;
    }

    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const saveResult = await assistant.save(changedValues);
      if (isAssistantError(saveResult)) throw new Error(saveResult.error);

      setInitialValues({ ...values });
      const restartResult = await assistant.restart();
      if (isAssistantError(restartResult)) throw new Error(restartResult.error);

      const failed = restartResult.filter((service) => !service.ok);
      if (failed.length > 0) {
        throw new Error(
          failed.map((service) => `${service.service}: ${service.error ?? 'échec'}`).join('; ')
        );
      }

      setNotice('Enregistré, daemon redémarré.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const renderControl = (setting: AssistantSetting) => {
    const value = values[setting.key] ?? setting.default;
    const disabled = loading || applying;

    if (setting.type === 'toggle') {
      const checked = value === 'true';
      return (
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          data-testid={`assistant-field-${setting.key}`}
          onClick={() => setField(setting.key, checked ? 'false' : 'true')}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
            checked ? 'border-primary bg-primary' : 'border-border bg-muted'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      );
    }

    if (setting.type === 'enum') {
      return (
        <select
          value={value}
          disabled={disabled}
          data-testid={`assistant-field-${setting.key}`}
          onChange={(event) => setField(setting.key, event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
        >
          {(setting.options ?? []).map((option) => (
            <option key={option} value={option}>
              {optionLabel(setting, option)}
            </option>
          ))}
        </select>
      );
    }

    if (setting.type === 'volume') {
      const numericValue = Math.max(0, Math.min(100, Number(value) || 0));
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={numericValue}
            aria-label={fieldLabel(setting)}
            disabled={disabled}
            data-testid={`assistant-field-${setting.key}`}
            onChange={(event) => setField(setting.key, event.target.value)}
            className="min-w-0 flex-1 accent-primary"
          />
          <output className="w-12 text-right text-sm tabular-nums text-muted-foreground">
            {numericValue}%
          </output>
        </div>
      );
    }

    if (setting.type === 'voice') {
      const voiceOptions = Array.from(new Set([value, setting.default, ...voices].filter(Boolean)));
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <select
              value={value}
              disabled={disabled}
              data-testid={`assistant-field-${setting.key}`}
              onChange={(event) => setField(setting.key, event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
            >
              {voiceOptions.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="assistant-preview"
              onClick={() => void previewVoice(setting)}
              disabled={
                disabled || previewing === setting.key || !value.trim() || !previewText.trim()
              }
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              {previewing === setting.key ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Headphones className="h-4 w-4" />
              )}
              {previewing === setting.key ? 'Lecture…' : 'Écouter'}
            </button>
          </div>
          <textarea
            value={previewText}
            disabled={disabled}
            data-testid="assistant-preview-text"
            onChange={(event) => setPreviewText(event.target.value)}
            rows={2}
            placeholder="Texte à faire dire pour tester la voix…"
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">
            Texte de test — modifie-le puis clique « Écouter ». Le 1er aperçu prend quelques
            secondes, les suivants sont instantanés.
          </p>
        </div>
      );
    }

    return (
      <input
        type="text"
        value={value}
        disabled={disabled}
        data-testid={`assistant-field-${setting.key}`}
        onChange={(event) => setField(setting.key, event.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
      />
    );
  };

  return (
    <main
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="assistant-view"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-sm font-semibold">Assistant</h1>
        <span className="text-xs text-muted-foreground">
          Mode assistant vocal, daemon local et companion.
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        {notice && (
          <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            {notice}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement de la configuration assistant…
          </div>
        ) : (
          <>
            <VoiceDiagnosticsPanel diagnostics={diagnostics} />
            <VoiceboxStudioPanel
              onProfileSelected={(profile) => setField('CODEBUDDY_VOICEBOX_PROFILE', profile.id)}
            />
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <div className="text-sm text-muted-foreground">
                {changedCount > 0
                  ? `${changedCount} changement${changedCount > 1 ? 's' : ''} en attente`
                  : 'Aucun changement en attente'}
              </div>
              <button
                type="button"
                data-testid="assistant-apply"
                onClick={() => void applyChanges()}
                disabled={applying}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {applying ? 'Application…' : 'Appliquer'}
              </button>
            </div>

            {volume !== null && (
              <section className="shrink-0 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Volume des enceintes</h2>
                    <p className="text-xs text-muted-foreground">
                      Niveau sonore des enceintes (appliqué en direct).
                    </p>
                  </div>
                  <span className="text-sm tabular-nums text-muted-foreground">{volume}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.min(100, volume)}
                  data-testid="assistant-volume"
                  onChange={(event) => changeVolume(Number(event.target.value))}
                  className="mt-3 w-full accent-primary"
                />
              </section>
            )}

            {groupedSettings.map(({ group, items }) => {
              const meta = GROUP_META[group];
              const Icon = meta.icon;
              return (
                <section
                  key={group}
                  className="shrink-0 overflow-hidden rounded-lg border border-border bg-surface"
                >
                  <header className="flex items-start gap-3 border-b border-border px-4 py-3">
                    <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <h2 className="text-sm font-semibold">{meta.title}</h2>
                      <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
                    </div>
                  </header>
                  <div className="divide-y divide-border">
                    {items.map((setting) => (
                      <div
                        key={setting.key}
                        className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] md:items-center"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{fieldLabel(setting)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {fieldHelp(setting)}
                          </div>
                        </div>
                        <div className="min-w-0 justify-self-stretch md:justify-self-end md:w-full">
                          {renderControl(setting)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}

        {!loading && settings.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-sm text-muted-foreground">
            Configuration assistant indisponible.
          </div>
        )}

        {!loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Power className="h-3.5 w-3.5" />
            Appliquer sauvegarde la configuration puis redémarre buddy-vision-brain et
            lisa-telegram.
          </div>
        )}
      </div>
    </main>
  );
}
