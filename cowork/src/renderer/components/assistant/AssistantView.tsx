/**
 * AssistantView — full-page panel for the local voice assistant mode.
 *
 * The renderer stays schema-driven: the core module provides settings, current
 * values, and Pocket voices through the preload `assistant` API.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Headphones,
  Loader2,
  Mic2,
  Power,
  Save,
  Settings2,
  Volume2,
} from 'lucide-react';

type AssistantSettingGroup = 'voice' | 'speech' | 'behavior' | 'companion';
type AssistantSettingType = 'toggle' | 'enum' | 'text' | 'voice';

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
  CODEBUDDY_SPEECH_LANG: 'Langue d’écoute',
  CODEBUDDY_SENSORY_GREET: 'Salutations',
  CODEBUDDY_REMINDERS: 'Rappels',
  CODEBUDDY_COMPANION_RELATIONAL: 'Mémoire relationnelle',
  CODEBUDDY_COMPANION_PROACTIVE: 'Companion proactif',
  CODEBUDDY_VOICE_IMPROVE: 'Amélioration vocale',
};

const HELP_OVERRIDES: Record<string, string> = {
  CODEBUDDY_TTS_ENGINE: 'Choisit le moteur de synthèse vocale.',
  CODEBUDDY_POCKET_VOICE: 'Sélectionne une voix Pocket ou un échantillon de clonage court.',
  CODEBUDDY_POCKET_LANG: 'Langue transmise au moteur Pocket.',
  CODEBUDDY_TTS_VOICE: 'Chemin du modèle Piper .onnx utilisé en secours.',
  CODEBUDDY_SENSORY_SPEAK: 'Autorise les réponses parlées du daemon vision.',
  CODEBUDDY_SENSORY_SPEAK_ACT: 'Autorise les retours vocaux pendant les actions.',
  CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'Définit le niveau de prudence des actions vocales.',
  CODEBUDDY_SENSORY_SPEAK_MODEL: 'Modèle utilisé pour formuler les réponses parlées.',
  CODEBUDDY_SENSORY_SPEECH: 'Active l’entrée vocale du daemon sensoriel.',
  CODEBUDDY_ROBOT_NAME: 'Nom utilisé par l’assistant pour se présenter.',
  CODEBUDDY_SENSORY_ALWAYS_RESPOND: 'Répond même si la phrase ne l’appelle pas clairement.',
  CODEBUDDY_SENSORY_CHIME_IN: 'Autorise de courtes interventions opportunistes.',
  CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS:
    'Durée en millisecondes pendant laquelle le suivi reste actif.',
  CODEBUDDY_SPEECH_LANG: 'Code de langue principal pour la reconnaissance vocale.',
  CODEBUDDY_SENSORY_GREET: 'Active les salutations du companion.',
  CODEBUDDY_REMINDERS: 'Active les rappels companion.',
  CODEBUDDY_COMPANION_RELATIONAL: 'Injecte le contexte relationnel dans les réponses companion.',
  CODEBUDDY_COMPANION_PROACTIVE: 'Autorise les comportements proactifs du companion.',
  CODEBUDDY_VOICE_IMPROVE: 'Active la boucle d’amélioration de l’assistant vocal.',
};

const OPTION_LABELS: Record<string, Record<string, string>> = {
  CODEBUDDY_TTS_ENGINE: {
    piper: 'Piper local',
    pocket: 'Pocket TTS',
  },
  CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: {
    plan: 'Planifier avant d’agir',
    dontAsk: 'Agir sans demander',
    bypassPermissions: 'Mode autonome complet',
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

function fileUrl(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function isAssistantError(value: unknown): value is AssistantErrorResponse {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
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
      const result = await assistant.preview(voice, previewText);
      if (isAssistantError(result)) throw new Error(result.error);
      if (!result) throw new Error('Aperçu vocal indisponible.');
      // Play via a user-gesture-initiated Audio() so the autoplay policy never blocks it.
      const audio = new Audio(fileUrl(result));
      void audio.play().catch(() => setError("Impossible de jouer l'aperçu (audio)."));
      setNotice(`Aperçu de « ${voice} » lancé.`);
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
              {previewing === setting.key ? 'Génération…' : 'Écouter'}
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
                    <h2 className="text-sm font-semibold">Volume</h2>
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
