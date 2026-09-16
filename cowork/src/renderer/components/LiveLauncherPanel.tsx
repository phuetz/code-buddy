/**
 * LiveLauncherPanel — run `buddy research` / `buddy flow` LIVE from the GUI.
 *
 * Closes the pilotability matrix's "research / flow live" gate (lifted by
 * the local Ollama $0 provider): pick research or flow, type the topic or
 * goal, pin a model (prefilled from the autonomy ladder's current $0
 * choice), launch — the bridge spawns the REAL core CLI headless and this
 * panel streams its stdout live (`liveLauncher.event` ServerEvents),
 * offers cancel, and renders the final report/output as markdown.
 * Mirrors the AutonomyPanel shell.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Play, Square, Telescope, X } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown';
import { useAppStore } from '../store';
import type {
  LiveLauncherEventPayload,
  LiveLauncherKind,
  LiveLauncherRunStatusValue,
} from '../../shared/live-launcher-types';

interface LiveLauncherPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_MODEL = 'qwen2.5:7b-instruct';

export function LiveLauncherPanel({ isOpen, onClose }: LiveLauncherPanelProps) {
  const { t } = useTranslation();
  const deepIntent = useAppStore((s) => s.liveLauncherDeepIntent);
  const setDeepIntent = useAppStore((s) => s.setLiveLauncherDeepIntent);
  const [kind, setKind] = useState<LiveLauncherKind>('research');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [useLocalOllama, setUseLocalOllama] = useState(true);
  const [wide, setWide] = useState(false);
  const [workers, setWorkers] = useState('5');
  const [deep, setDeep] = useState(false);
  const [iterations, setIterations] = useState('1');
  const [perspectives, setPerspectives] = useState('0');
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveLauncherRunStatusValue | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);
  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;

  // Prefill the model from the autonomy ladder's current ($0 local) choice.
  useEffect(() => {
    if (!isOpen) return;
    const api = window.electronAPI;
    if (!api?.autonomy?.modelTier) return;
    void api.autonomy
      .modelTier()
      .then((tier) => {
        if (tier?.ok && tier.currentChoice?.model && !tier.currentChoice.paid) {
          setModel((current) => (current === DEFAULT_MODEL ? tier.currentChoice!.model : current));
          if (tier.currentChoice.baseUrl) {
            setOllamaUrl((current) => current.trim() || tier.currentChoice!.baseUrl!);
          }
        }
      })
      .catch(() => undefined);
  }, [isOpen]);

  // Honor a one-shot "open in Deep Research mode" intent (from the Labs card /
  // command palette), then clear it so a later manual open starts clean.
  useEffect(() => {
    if (!isOpen || !deepIntent) return;
    setKind('research');
    setDeep(true);
    setWide(false);
    setDeepIntent(false);
  }, [isOpen, deepIntent, setDeepIntent]);

  // Live stream subscription.
  useEffect(() => {
    if (!isOpen) return undefined;
    const api = window.electronAPI;
    if (!api?.onEvent) return undefined;
    const unsubscribe = api.onEvent('liveLauncher.event', (event) => {
      if (event.type !== 'liveLauncher.event') return;
      const payload = event.payload as LiveLauncherEventPayload;
      if (!runIdRef.current || payload.runId !== runIdRef.current) return;
      if (payload.kind === 'log') {
        setLogLines((prev) => [...prev.slice(-1999), ...payload.lines]);
      } else {
        setStatus(payload.run.status);
        if (payload.run.result !== undefined) setResult(payload.run.result);
        if (payload.run.error) setError(payload.run.error);
      }
    });
    return unsubscribe;
  }, [isOpen]);

  // Auto-scroll the live log.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  const start = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || starting || status === 'running') return;
    if (
      !useLocalOllama &&
      !window.confirm(
        `Ce lancement utilisera le provider configuré avec le modèle « ${model.trim() || DEFAULT_MODEL} ». ` +
          'Il peut consommer des crédits API, particulièrement en mode Deep Research. Continuer ?',
      )
    ) {
      return;
    }
    setStarting(true);
    setError(null);
    setResult(null);
    setLogLines([]);
    setReportPath(null);
    try {
      const api = window.electronAPI;
      const workerCount = Number.parseInt(workers, 10);
      const iterationsCount = Number.parseInt(iterations, 10);
      const perspectivesCount = Number.parseInt(perspectives, 10);
      // Deep Research (cited pipeline) takes precedence over wide (the CLI's
      // --deep short-circuits --wide), so it's checked first.
      const modeFields =
        kind === 'research' && deep
          ? {
              deep: true,
              ...(Number.isFinite(iterationsCount) && iterationsCount > 1
                ? { iterations: iterationsCount }
                : {}),
              ...(Number.isFinite(perspectivesCount) && perspectivesCount > 0
                ? { perspectives: perspectivesCount }
                : {}),
            }
          : kind === 'research' && wide
            ? { wide: true, workers: Number.isFinite(workerCount) && workerCount > 0 ? workerCount : 5 }
            : {};
      const response = await api.liveLauncher.start({
        kind,
        prompt: trimmed,
        model: model.trim() || undefined,
        provider: useLocalOllama ? 'ollama' : 'inherit',
        ...(!useLocalOllama ? { confirmInheritedProvider: true } : {}),
        ...(useLocalOllama && ollamaUrl.trim() ? { ollamaUrl: ollamaUrl.trim() } : {}),
        ...modeFields,
      });
      if (!response.ok || !response.runId) {
        setError(response.error ?? 'launch failed');
        return;
      }
      setRunId(response.runId);
      setStatus('running');
      if (response.reportPath) setReportPath(response.reportPath);
    } catch (err) {
      setError(String(err));
    } finally {
      setStarting(false);
    }
  }, [
    prompt,
    starting,
    status,
    kind,
    model,
    ollamaUrl,
    useLocalOllama,
    wide,
    workers,
    deep,
    iterations,
    perspectives,
  ]);

  const cancel = useCallback(async () => {
    if (!runId) return;
    try {
      const response = await window.electronAPI.liveLauncher.cancel(runId);
      if (!response.ok) setError(response.error ?? 'cancel failed');
    } catch (err) {
      setError(String(err));
    }
  }, [runId]);

  if (!isOpen) return null;

  const running = status === 'running';

  return (
    <div
      className="fixed right-0 top-0 h-full w-[640px] max-w-[95vw] bg-background border-l border-border shadow-2xl z-40 flex flex-col"
      data-testid="live-launcher-panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-muted flex-shrink-0">
        <Telescope size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-text-primary">
          {t('liveLauncher.title', 'Research / Flow launcher')}
        </h2>
        {status && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border uppercase ${
              status === 'running'
                ? 'border-accent/40 text-accent'
                : status === 'succeeded'
                  ? 'border-success/40 text-success'
                  : 'border-error/40 text-error'
            }`}
            data-testid="live-launcher-status"
          >
            {status}
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto p-1 text-text-muted hover:text-text-primary"
          aria-label={t('common.close', 'Close')}
          title={t('common.close', 'Close')}
          data-testid="live-launcher-close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {/* Launcher form */}
        <section className="p-2.5 rounded-lg bg-surface/40 border border-border-muted space-y-2">
          <div className="flex items-center gap-1.5">
            {(['research', 'flow'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setKind(mode)}
                disabled={running}
                className={`px-2 py-1 rounded border text-xs ${
                  kind === mode
                    ? 'border-accent/60 bg-accent/10 text-text-primary'
                    : 'border-border text-text-secondary hover:text-text-primary'
                } disabled:opacity-50`}
                data-testid={`live-launcher-mode-${mode}`}
              >
                {mode === 'research'
                  ? t('liveLauncher.research', 'Research')
                  : t('liveLauncher.flow', 'Flow')}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-text-muted">
              {kind === 'research'
                ? t('liveLauncher.researchHint', 'Wide research: report with findings + recommendations')
                : t('liveLauncher.flowHint', 'Plan → process → synthesize')}
            </span>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              kind === 'research'
                ? t('liveLauncher.topicPlaceholder', 'Research topic…')
                : t('liveLauncher.goalPlaceholder', 'Flow goal…')
            }
            rows={3}
            disabled={running}
            className="w-full px-2 py-1.5 rounded bg-background border border-border text-text-primary placeholder:text-text-muted resize-y disabled:opacity-50"
            data-testid="live-launcher-prompt"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={running}
              className="flex-1 min-w-[180px] px-2 py-1 rounded bg-background border border-border text-text-primary font-mono disabled:opacity-50"
              title={t('liveLauncher.modelHint', 'Model for this run (prefilled with the autonomy ladder choice)')}
              data-testid="live-launcher-model"
            />
            <label
              className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer select-none"
              title={t('liveLauncher.ollamaHint', 'Pin CODEBUDDY_PROVIDER=ollama — free local or network inference')}
            >
              <input
                type="checkbox"
                checked={useLocalOllama}
                onChange={(e) => setUseLocalOllama(e.target.checked)}
                disabled={running}
                className="h-3 w-3 accent-accent"
                data-testid="live-launcher-ollama"
              />
              {t('liveLauncher.localOllama', 'local/network Ollama')}
              <span className="px-1 rounded border border-success/40 text-success text-[9px]">$0</span>
            </label>
            {kind === 'research' && (
              <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={wide}
                  onChange={(e) => {
                    setWide(e.target.checked);
                    if (e.target.checked) setDeep(false); // wide/deep are mutually exclusive
                  }}
                  disabled={running}
                  className="h-3 w-3 accent-accent"
                  data-testid="live-launcher-wide"
                />
                {t('liveLauncher.wide', 'wide (parallel workers)')}
                {wide && (
                  <input
                    value={workers}
                    onChange={(e) => setWorkers(e.target.value)}
                    disabled={running}
                    className="w-10 px-1 py-0.5 rounded bg-background border border-border text-text-primary text-[10px]"
                    data-testid="live-launcher-workers"
                  />
                )}
              </label>
            )}
            {kind === 'research' && (
              <label
                className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer select-none"
                title={t('liveLauncher.deepHint', 'Deep Research: deterministic, cited pipeline (plan → search → scrape → cited synthesis)')}
              >
                <input
                  type="checkbox"
                  checked={deep}
                  onChange={(e) => {
                    setDeep(e.target.checked);
                    if (e.target.checked) setWide(false); // wide/deep are mutually exclusive
                  }}
                  disabled={running}
                  className="h-3 w-3 accent-accent"
                  data-testid="live-launcher-deep"
                />
                {t('liveLauncher.deep', 'deep (cited)')}
                {deep && (
                  <>
                    <input
                      value={iterations}
                      onChange={(e) => setIterations(e.target.value)}
                      disabled={running}
                      title={t('liveLauncher.iterations', 'Gap-analysis rounds (1-3)')}
                      className="w-10 px-1 py-0.5 rounded bg-background border border-border text-text-primary text-[10px]"
                      data-testid="live-launcher-iterations"
                    />
                    <input
                      value={perspectives}
                      onChange={(e) => setPerspectives(e.target.value)}
                      disabled={running}
                      title={t('liveLauncher.perspectives', 'STORM perspectives (0 = off, else 2-6)')}
                      className="w-10 px-1 py-0.5 rounded bg-background border border-border text-text-primary text-[10px]"
                      data-testid="live-launcher-perspectives"
                    />
                  </>
                )}
              </label>
            )}
            {!running ? (
              <button
                onClick={() => void start()}
                disabled={!prompt.trim() || starting}
                className="ml-auto flex items-center gap-1 px-3 py-1 rounded bg-accent text-background hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="live-launcher-start"
              >
                {starting ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                {t('liveLauncher.start', 'Launch')}
              </button>
            ) : (
              <button
                onClick={() => void cancel()}
                className="ml-auto flex items-center gap-1 px-3 py-1 rounded border border-border text-text-secondary hover:text-error hover:border-error/50"
                data-testid="live-launcher-cancel"
              >
                <Square size={11} />
                {t('liveLauncher.cancel', 'Cancel')}
              </button>
            )}
          </div>
          {useLocalOllama && (
            <input
              value={ollamaUrl}
              onChange={(event) => setOllamaUrl(event.target.value)}
              disabled={running}
              placeholder={t(
                'liveLauncher.ollamaUrlPlaceholder',
                'Ollama endpoint (e.g. http://gpuNode:11434)',
              )}
              className="w-full px-2 py-1 rounded bg-background border border-border text-text-primary font-mono placeholder:text-text-muted disabled:opacity-50"
              data-testid="live-launcher-ollama-url"
            />
          )}
        </section>

        {error && (
          <p className="text-[11px] text-error" data-testid="live-launcher-error">
            {error}
          </p>
        )}

        {/* Live log */}
        {(running || logLines.length > 0) && (
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5 flex items-center gap-1.5">
              {running && <Loader2 size={10} className="animate-spin" />}
              {t('liveLauncher.log', 'Live output')}
            </h3>
            <pre
              ref={logRef}
              className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-background border border-border-muted p-2 text-[10px] text-text-secondary font-mono"
              data-testid="live-launcher-log"
            >
              {logLines.join('\n')}
            </pre>
          </section>
        )}

        {/* Final result */}
        {result && status === 'succeeded' && (
          <section data-testid="live-launcher-result">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
              {t('liveLauncher.result', 'Result')}
            </h3>
            {reportPath && (
              <p className="mb-1.5 text-[10px] text-text-muted font-mono truncate" title={reportPath}>
                {reportPath}
              </p>
            )}
            <div className="rounded border border-border-muted bg-surface/40 p-3 text-xs">
              <MessageMarkdown normalizedText={result} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
