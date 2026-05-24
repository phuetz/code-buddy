/**
 * OnboardingWizard — P1.6
 *
 * 5-step first-run wizard guiding the user through:
 *   1. Language + theme + first-run path
 *   2. AI provider + API key (light setup; full config still lives in Settings)
 *   3. Default workspace folder + backend mode
 *   4. Companion permissions tour (voice, camera, notifications, fleet)
 *   5. First chat handoff
 *
 * The wizard marks the user as onboarded by writing
 * `onboardingCompleted: true` into the app config. App.tsx checks this flag
 * before deciding whether to open the wizard or jump straight to the chat.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Globe,
  Sun,
  Moon,
  Key,
  FolderOpen,
  Compass,
  Rocket,
  Server,
  ShieldCheck,
  Mic,
  Camera,
  Bell,
  MessageSquare,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
} from 'lucide-react';
import { useAppStore } from '../store';

type Step = 0 | 1 | 2 | 3 | 4;

interface OnboardingWizardProps {
  onClose: () => void;
  onOpenApiSettings: () => void;
}

const STEPS = [
  { id: 0, key: 'welcome' },
  { id: 1, key: 'provider' },
  { id: 2, key: 'workspace' },
  { id: 3, key: 'capabilities' },
  { id: 4, key: 'firstPrompt' },
] as const;

export function OnboardingWizard({ onClose, onOpenApiSettings }: OnboardingWizardProps) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>(0);
  const setSettings = useAppStore((s) => s.setSettings);
  const settings = useAppStore((s) => s.settings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && step < 4) setStep((step + 1) as Step);
      if (e.key === 'ArrowLeft' && step > 0) setStep((step - 1) as Step);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  const markComplete = async () => {
    try {
      await window.electronAPI?.config?.save?.({
        onboardingCompleted: true,
      } as Record<string, unknown>);
    } catch {
      /* ignore */
    }
    onClose();
  };

  const changeLanguage = (lang: string) => {
    void i18n.changeLanguage(lang);
  };

  const toggleTheme = (theme: 'light' | 'dark') => {
    setSettings({ theme });
  };

  const pickWorkspaceFolder = async () => {
    // We use the file picker as a folder picker fallback — the user picks
    // any file inside the desired folder and we save the parent directory.
    const api = window.electronAPI?.selectFiles;
    if (!api) return;
    try {
      const paths = await api();
      if (paths && paths.length > 0) {
        const first = paths[0];
        // Strip the filename to keep the parent folder
        const sep = first.includes('\\') ? '\\' : '/';
        const folder = first.substring(0, first.lastIndexOf(sep)) || first;
        await window.electronAPI?.config?.save?.({
          defaultWorkspacePath: folder,
        } as Record<string, unknown>);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
      data-testid="onboarding-wizard"
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
        {/* Header with progress */}
        <div className="px-6 pt-5 pb-3 border-b border-border-muted">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-accent" />
              <h2 className="text-base font-semibold">
                {t('onboarding.title', 'Welcome to Cowork')}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover"
              title={t('common.close', 'Close')}
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            {STEPS.map((s) => (
              <div
                key={s.id}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s.id <= step ? 'bg-accent' : 'bg-surface-muted'
                }`}
              />
            ))}
          </div>
          <p className="text-[11px] text-text-muted mt-2">
            {t('onboarding.stepLabel', 'Step {{current}} of {{total}}', {
              current: step + 1,
              total: STEPS.length,
            })}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 min-h-[280px]">
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-accent shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('onboarding.languageTitle', 'Choose your language')}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t(
                      'onboarding.languageDesc',
                      'You can change this anytime in Settings → General.'
                    )}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { code: 'en', label: 'English' },
                  { code: 'fr', label: 'Français' },
                  { code: 'zh', label: '中文' },
                ].map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => changeLanguage(lang.code)}
                    className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                      i18n.language?.startsWith(lang.code)
                        ? 'border-accent bg-accent/10'
                        : 'border-border-subtle hover:bg-surface-hover'
                    }`}
                    data-testid={`onboarding-lang-${lang.code}`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
              <div className="border-t border-border-muted pt-4">
                <h3 className="text-sm font-semibold mb-2">
                  {t('onboarding.themeTitle', 'Pick a theme')}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => toggleTheme('light')}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      settings?.theme === 'light'
                        ? 'border-accent bg-accent/10'
                        : 'border-border-subtle hover:bg-surface-hover'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span className="text-sm">{t('onboarding.themeLight', 'Light')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleTheme('dark')}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      settings?.theme === 'dark'
                        ? 'border-accent bg-accent/10'
                        : 'border-border-subtle hover:bg-surface-hover'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span className="text-sm">{t('onboarding.themeDark', 'Dark')}</span>
                  </button>
                </div>
              </div>
              <div
                className="grid grid-cols-3 gap-2 border-t border-border-muted pt-4"
                data-testid="onboarding-paths"
              >
                {[
                  {
                    testId: 'onboarding-path-quickstart',
                    title: t('onboarding.pathQuickTitle', 'Quick start'),
                    desc: t('onboarding.pathQuickDesc', 'Connect the brain and start chatting.'),
                  },
                  {
                    testId: 'onboarding-path-control',
                    title: t('onboarding.pathControlTitle', 'Full control'),
                    desc: t(
                      'onboarding.pathControlDesc',
                      'Tune workspace, backend, and tool policy.'
                    ),
                  },
                  {
                    testId: 'onboarding-path-later',
                    title: t('onboarding.pathLaterTitle', 'Configure later'),
                    desc: t('onboarding.pathLaterDesc', 'Skip safely and keep setup reversible.'),
                  },
                ].map((item) => (
                  <div
                    key={item.testId}
                    className="rounded-lg border border-border-subtle bg-surface/40 p-3"
                    data-testid={item.testId}
                  >
                    <p className="text-xs font-semibold text-text-primary">{item.title}</p>
                    <p className="mt-1 text-[11px] leading-4 text-text-muted">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Key className="w-5 h-5 text-accent shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('onboarding.providerTitle', 'Connect an AI provider')}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t(
                      'onboarding.providerDesc',
                      'Cowork supports Anthropic, OpenAI, Gemini, Ollama, LM Studio, and any OpenAI-compatible endpoint.'
                    )}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2" data-testid="onboarding-brain-options">
                {[
                  {
                    icon: BrainCircuit,
                    testId: 'onboarding-brain-codebuddy',
                    title: t('onboarding.brainCodeBuddyTitle', 'Code Buddy brain'),
                    desc: t(
                      'onboarding.brainCodeBuddyDesc',
                      'Use your signed-in ChatGPT/Codex backend when available.'
                    ),
                  },
                  {
                    icon: Server,
                    testId: 'onboarding-brain-local',
                    title: t('onboarding.brainLocalTitle', 'Local runtimes'),
                    desc: t(
                      'onboarding.brainLocalDesc',
                      'Ollama and LM Studio can be discovered on this machine.'
                    ),
                  },
                  {
                    icon: Key,
                    testId: 'onboarding-brain-custom',
                    title: t('onboarding.brainCustomTitle', 'Custom endpoint'),
                    desc: t(
                      'onboarding.brainCustomDesc',
                      'OpenAI-compatible servers can coexist as named configs.'
                    ),
                  },
                ].map(({ icon: Icon, testId, title, desc }) => (
                  <div
                    key={testId}
                    className="rounded-lg border border-border-subtle bg-surface/40 p-3"
                    data-testid={testId}
                  >
                    <Icon className="h-4 w-4 text-accent" />
                    <p className="mt-2 text-xs font-semibold text-text-primary">{title}</p>
                    <p className="mt-1 text-[11px] leading-4 text-text-muted">{desc}</p>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  onOpenApiSettings();
                }}
                className="w-full px-4 py-2.5 rounded-lg bg-accent text-background text-sm font-medium hover:bg-accent-hover"
                data-testid="onboarding-open-api"
              >
                {t('onboarding.openApiSettings', 'Open API settings →')}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <FolderOpen className="w-5 h-5 text-accent shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('onboarding.workspaceTitle', 'Pick a default workspace')}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t(
                      'onboarding.workspaceDesc',
                      'Cowork agents read and write files inside the workspace folder. You can pick a different one per session later.'
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={pickWorkspaceFolder}
                className="w-full px-4 py-2.5 rounded-lg border border-border-subtle hover:bg-surface-hover text-sm flex items-center justify-center gap-2"
                data-testid="onboarding-pick-workspace"
              >
                <FolderOpen className="w-4 h-4" />
                {t('onboarding.chooseFolder', 'Choose a folder…')}
              </button>
              <p className="text-[11px] text-text-muted italic">
                {t(
                  'onboarding.workspaceHint',
                  'Tip: pick a sandbox folder first — you can always swap to your real project later.'
                )}
              </p>
              <div
                className="grid grid-cols-2 gap-2 rounded-lg border border-border-subtle bg-surface/40 p-3"
                data-testid="onboarding-backend-mode"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-accent" />
                    <p className="text-xs font-semibold text-text-primary">
                      {t('onboarding.localBackendTitle', 'Local backend first')}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-text-muted">
                    {t(
                      'onboarding.localBackendDesc',
                      'Use loopback while testing tools, memory, and companion features.'
                    )}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-accent" />
                    <p className="text-xs font-semibold text-text-primary">
                      {t('onboarding.remoteBackendTitle', 'Remote later')}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-text-muted">
                    {t(
                      'onboarding.remoteBackendDesc',
                      'Move to tailnet or SSH-hosted gateways after the local loop is healthy.'
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Compass className="w-5 h-5 text-accent shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('onboarding.capabilitiesTitle', 'Companion permissions')}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {t(
                      'onboarding.capabilitiesDesc',
                      'Grant abilities one by one, then let Buddy explain what each one unlocks.'
                    )}
                  </p>
                </div>
              </div>
              <div
                className="grid grid-cols-2 gap-2"
                data-testid="onboarding-companion-permissions"
              >
                {[
                  {
                    icon: Mic,
                    testId: 'onboarding-permission-voice',
                    title: t('onboarding.permissionVoiceTitle', 'Voice dialogue'),
                    desc: t(
                      'onboarding.permissionVoiceDesc',
                      'Talk to Buddy and hear replies when TTS is enabled.'
                    ),
                  },
                  {
                    icon: Camera,
                    testId: 'onboarding-permission-camera',
                    title: t('onboarding.permissionCameraTitle', 'Camera vision'),
                    desc: t(
                      'onboarding.permissionCameraDesc',
                      'Use snapshots, face cues, and hand landmarks when you allow it.'
                    ),
                  },
                  {
                    icon: Bell,
                    testId: 'onboarding-permission-notifications',
                    title: t('onboarding.permissionNotificationsTitle', 'Notifications'),
                    desc: t(
                      'onboarding.permissionNotificationsDesc',
                      'Let the companion surface check-ins and finished work.'
                    ),
                  },
                  {
                    icon: MessageSquare,
                    testId: 'onboarding-permission-channels',
                    title: t('onboarding.permissionChannelsTitle', 'Channels and Fleet'),
                    desc: t(
                      'onboarding.permissionChannelsDesc',
                      'Route work through peers, tools, and external channels later.'
                    ),
                  },
                ].map(({ icon: Icon, testId, title, desc }) => (
                  <div
                    key={testId}
                    className="rounded-lg border border-border-subtle bg-surface/40 p-3"
                    data-testid={testId}
                  >
                    <Icon className="h-4 w-4 text-accent" />
                    <p className="mt-2 text-xs font-semibold text-text-primary">{title}</p>
                    <p className="mt-1 text-[11px] leading-4 text-text-muted">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-center">
              <Rocket className="w-12 h-12 text-accent mx-auto" />
              <h3 className="text-base font-semibold">
                {t('onboarding.readyTitle', 'Ready for the first companion chat.')}
              </h3>
              <p className="text-xs text-text-muted max-w-sm mx-auto">
                {t(
                  'onboarding.readyDesc',
                  'Cowork keeps setup separate from your real sessions so Buddy can introduce itself, check readiness, and propose the next useful action.'
                )}
              </p>
              <div
                className="grid grid-cols-3 gap-2 text-left"
                data-testid="onboarding-ready-actions"
              >
                {[
                  {
                    title: t('onboarding.readyFirstChatTitle', 'First chat'),
                    desc: t('onboarding.readyFirstChatDesc', 'Start with a concrete goal.'),
                  },
                  {
                    title: t('onboarding.readyCompanionTitle', 'Companion'),
                    desc: t(
                      'onboarding.readyCompanionDesc',
                      'Open Buddy for state, vision, and missions.'
                    ),
                  },
                  {
                    title: t('onboarding.readyHealthTitle', 'Health check'),
                    desc: t(
                      'onboarding.readyHealthDesc',
                      'Verify model, backend, and permissions.'
                    ),
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-lg border border-border-subtle bg-surface/40 p-3"
                  >
                    <p className="text-xs font-semibold text-text-primary">{item.title}</p>
                    <p className="mt-1 text-[11px] leading-4 text-text-muted">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border-muted flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1) as Step)}
            disabled={step === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md text-text-secondary hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t('common.back', 'Back')}
          </button>
          <button
            type="button"
            onClick={markComplete}
            className="text-[11px] text-text-muted hover:text-text-primary"
            data-testid="onboarding-skip"
          >
            {t('onboarding.skip', 'Skip onboarding')}
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((step + 1) as Step)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover"
              data-testid="onboarding-next"
            >
              {t('common.next', 'Next')}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={markComplete}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover"
              data-testid="onboarding-finish"
            >
              <Check className="w-3.5 h-3.5" />
              {t('onboarding.finish', "Let's go")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
