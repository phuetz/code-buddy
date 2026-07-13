import { useCallback, useMemo } from 'react';
import { Brain, Cloud, Gauge, Layers3, MapPin, Zap } from 'lucide-react';
import { useAppStore } from '../store';
import { useCurrentSession } from '../store/selectors';
import type { Session, SessionIntelligence, SessionThinkingLevel } from '../types';
import { summarizeLatencyHistory } from '../../shared/session-latency';
import { chooseLowLatencyRuntime, inferExecutionLocation } from '../../shared/low-latency-routing';
import { ModelSwitcher } from './ModelSwitcher';
import { GuidedTooltip } from './Tooltip';

const THINKING_LEVELS: SessionThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function defaultIntelligence(session: Session, activeConfigSetId?: string): SessionIntelligence {
  return session.intelligence ?? {
    configSetId: activeConfigSetId,
    thinkingLevel: 'off',
    fastMode: false,
    executionLocation: session.source === 'remote' ? 'cloud' : 'local',
    latencyBudgetMs: 900,
    cacheState: 'unknown',
  };
}

function formatLatency(value?: number): string {
  if (value === undefined) return '—';
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(1)} s`;
}

export { chooseLowLatencyRuntime } from '../../shared/low-latency-routing';

/** Session-scoped model/runtime controls. No control mutates another tab. */
export function SessionIntelligenceBar() {
  const session = useCurrentSession();
  const appConfig = useAppStore((state) => state.appConfig);
  const sessions = useAppStore((state) => state.sessions);
  const updateSession = useAppStore((state) => state.updateSession);
  const intelligence = useMemo(
    () => session ? defaultIntelligence(session, appConfig?.activeConfigSetId) : null,
    [appConfig?.activeConfigSetId, session],
  );

  const persist = useCallback((updates: Partial<SessionIntelligence>, model?: string) => {
    if (!session || !intelligence) return;
    const runtimeChanged = (updates.configSetId !== undefined && updates.configSetId !== intelligence.configSetId)
      || (model !== undefined && model !== session.model);
    const latencyHistory = runtimeChanged
      ? intelligence.latencyHistory?.map((sample) => ({
          ...sample,
          configSetId: sample.configSetId ?? intelligence.configSetId,
          model: sample.model ?? session.model,
        }))
      : intelligence.latencyHistory;
    const next = {
      ...intelligence,
      ...updates,
      ...(runtimeChanged ? { latencyHistory, lastLatency: undefined } : {}),
    };
    const sessionUpdates: Partial<Session> = { intelligence: next };
    if (model !== undefined) sessionUpdates.model = model;
    updateSession(session.id, sessionUpdates);
    void window.electronAPI?.session?.updateSettings?.(session.id, {
      intelligence: next,
      ...(model !== undefined ? { model } : {}),
    });
  }, [intelligence, session, updateSession]);
  const fastRecommendation = useMemo(
    () => appConfig ? chooseLowLatencyRuntime(appConfig.configSets, sessions) : null,
    [appConfig, sessions],
  );

  if (!session || !intelligence || !appConfig) return null;

  const configSet = appConfig.configSets.find((set) => set.id === intelligence.configSetId)
    ?? appConfig.configSets.find((set) => set.id === appConfig.activeConfigSetId)
    ?? appConfig.configSets[0];
  const model = session.model || configSet?.profiles[configSet.activeProfileKey]?.model || appConfig.model;
  const latency = intelligence.lastLatency?.firstTokenMs ?? intelligence.lastLatency?.totalMs;
  const withinBudget = latency === undefined || latency <= intelligence.latencyBudgetMs;
  const latencySummary = summarizeLatencyHistory(intelligence, { configSetId: intelligence.configSetId, model });

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border-muted bg-surface/65 p-1" data-testid="session-intelligence-bar">
      <label className="relative flex items-center gap-1 text-[10px] text-text-muted" title="Runtime isolé de cette session">
        <Layers3 size={12} />
        <select
          value={configSet?.id ?? ''}
          onChange={(event) => {
            const selected = appConfig.configSets.find((set) => set.id === event.target.value);
            if (!selected) return;
            const selectedProfile = selected.profiles[selected.activeProfileKey];
            persist({
              configSetId: selected.id,
              profileId: selected.activeProfileKey,
              executionLocation: inferExecutionLocation(selected),
              cacheState: 'invalidated',
            }, selectedProfile?.model || model);
          }}
          className="max-w-28 bg-transparent py-1 text-[10px] font-medium text-text-secondary outline-none"
          aria-label="Profil runtime de la session"
          data-testid="session-runtime-profile"
        >
          {appConfig.configSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
        </select>
      </label>

      <Brain size={12} className="text-text-muted" aria-hidden />
      <select
        value={intelligence.thinkingLevel}
        onChange={(event) => persist({ thinkingLevel: event.target.value as SessionThinkingLevel, cacheState: 'invalidated' })}
        className="bg-transparent py-1 text-[10px] font-medium text-text-secondary outline-none"
        aria-label="Effort de raisonnement de la session"
        data-testid="session-thinking-level"
      >
        {THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
      </select>

      <GuidedTooltip
        title={fastRecommendation?.source === 'measured' ? 'FAST apprend de tes sessions' : 'FAST démarre par heuristique'}
        description={fastRecommendation ? `${fastRecommendation.model} est recommandé${fastRecommendation.p50Ms !== undefined ? ` avec une latence p50 mesurée de ${formatLatency(fastRecommendation.p50Ms)} sur ${fastRecommendation.sampleCount} tours` : ' d’après sa taille et sa proximité locale'}. Le changement reste limité à cette conversation.` : 'Ajoute un runtime configuré pour activer le routage basse latence.'}
        kicker="Routage adaptatif"
        side="bottom"
      >
        <button
          type="button"
          onClick={() => {
            const enabling = !intelligence.fastMode;
            const recommended = enabling ? fastRecommendation : null;
            persist({
              fastMode: enabling,
              thinkingLevel: enabling ? 'minimal' : intelligence.thinkingLevel,
              latencyBudgetMs: enabling ? 700 : 900,
              cacheState: 'invalidated',
              ...(recommended ? {
                configSetId: recommended.configSetId,
                profileId: recommended.profileId,
                executionLocation: recommended.executionLocation,
              } : {}),
            }, recommended?.model);
          }}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold transition-colors ${intelligence.fastMode ? 'bg-warning/15 text-warning' : 'text-text-muted hover:bg-surface-hover'}`}
          aria-pressed={intelligence.fastMode}
          data-testid="session-fast-mode"
        >
          <Zap size={11} /> FAST
        </button>
      </GuidedTooltip>

      <GuidedTooltip
        title={withinBudget ? 'Latence dans le budget' : 'Budget de latence dépassé'}
        description={`Premier signal ${formatLatency(intelligence.lastLatency?.firstTokenMs)}, total ${formatLatency(intelligence.lastLatency?.totalMs)}. Sur ${latencySummary.samples} mesure(s) : p50 ${formatLatency(latencySummary.p50Ms)}, p95 ${formatLatency(latencySummary.p95Ms)}. ${latencySummary.consecutiveBudgetBreaches >= 2 ? 'Plusieurs dépassements consécutifs : active FAST pour rerouter cette session vers le runtime le plus rapide.' : 'Le budget de cette session est de ' + intelligence.latencyBudgetMs + ' ms.'}`}
        kicker="Gouverneur temps réel"
        side="bottom"
      >
        <div
          className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] ${withinBudget ? 'text-success' : 'bg-warning/10 text-warning'}`}
          data-testid="session-latency"
          tabIndex={0}
        >
          <Gauge size={11} /> {formatLatency(latency)}
          {latencySummary.consecutiveBudgetBreaches >= 2 ? <span data-testid="session-latency-breaches">{latencySummary.consecutiveBudgetBreaches}×</span> : null}
        </div>
      </GuidedTooltip>

      <span className="inline-flex items-center gap-1 px-1 text-[10px] text-text-muted" title={`Exécution ${intelligence.executionLocation}`}>
        {intelligence.executionLocation === 'cloud' ? <Cloud size={11} /> : intelligence.executionLocation === 'lan' ? <MapPin size={11} /> : <MapPin size={11} />}
        {intelligence.executionLocation}
      </span>

      <ModelSwitcher
        currentModel={model}
        onModelChange={(nextModel) => persist({ cacheState: 'invalidated' }, nextModel)}
      />
    </div>
  );
}
