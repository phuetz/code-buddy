/**
 * CompanionPanel — Buddy's Lisa-inspired cockpit.
 *
 * Surfaces local companion readiness and the append-only sensory journal:
 * vision, hearing, screen, self-state, memory, tools, and suggestions.
 *
 * @module renderer/components/CompanionPanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Brain,
  Camera,
  ClipboardCheck,
  Eye,
  FolderOpen,
  ListChecks,
  Mic,
  Monitor,
  Play,
  Radio,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useAppStore } from '../store';
import type {
  CameraSnapshotResult,
  CompanionCard,
  CompanionCardStatus,
  CompanionCompetitiveRadar,
  CompanionGatewayMode,
  CompanionGatewayProfile,
  CompanionImpulseBrief,
  CompanionMission,
  CompanionMissionRunResult,
  CompanionMissionStatus,
  CompanionPercept,
  CompanionPerceptModality,
  CompanionPerceptStats,
  CompanionSafetyEvent,
  CompanionSafetyLedgerStats,
  CompanionSelfEvaluation,
  CompanionSetupResponse,
  CompanionSkillCandidate,
  CompanionSkillCuratorResult,
  CompanionStatus,
  VoiceConversationSnapshot,
} from '../types';

const MODALITIES: Array<{ key: CompanionPerceptModality | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'vision', label: 'Vision' },
  { key: 'hearing', label: 'Hearing' },
  { key: 'screen', label: 'Screen' },
  { key: 'self', label: 'Self' },
  { key: 'memory', label: 'Memory' },
  { key: 'tool', label: 'Tools' },
  { key: 'suggestion', label: 'Ideas' },
];

const MODALITY_ICON: Record<CompanionPerceptModality, typeof Activity> = {
  vision: Eye,
  hearing: Mic,
  screen: Monitor,
  self: Bot,
  memory: Brain,
  tool: Activity,
  suggestion: Sparkles,
};

function ready(ok: boolean): string {
  return ok ? 'Ready' : 'Needs attention';
}

function StatusTile({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded border border-border bg-surface/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${ok ? 'text-accent' : 'text-warning'}`} />
        <span className="text-[11px] font-semibold uppercase text-text-muted">{label}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-text-primary">{value}</div>
    </div>
  );
}

function payloadPath(percept: CompanionPercept): string | null {
  const value = percept.payload?.path;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function PerceptRow({ percept }: { percept: CompanionPercept }) {
  const Icon = MODALITY_ICON[percept.modality] ?? Activity;
  const path = payloadPath(percept);

  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-percept">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-accent" />
            <span className="text-xs font-semibold text-text-primary">
              {percept.modality}/{percept.source}
            </span>
            <span className="text-[10px] text-text-muted">
              {Math.round(percept.confidence * 100)}%
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{percept.summary}</p>
          {path && (
            <button
              onClick={() => void window.electronAPI?.showItemInFolder(path)}
              className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {path}
            </button>
          )}
          {percept.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {percept.tags.map((tag) => (
                <span key={tag} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <time className="shrink-0 text-[10px] text-text-muted">
          {new Date(percept.timestamp).toLocaleString()}
        </time>
      </div>
    </div>
  );
}

function SafetyEventRow({ event }: { event: CompanionSafetyEvent }) {
  const artifact = event.artifactPath;
  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-safety-event">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${event.risk === 'high' ? 'text-warning' : 'text-accent'}`} />
            <span className="text-xs font-semibold text-text-primary">{event.action}</span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {event.kind}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {event.risk}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {event.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{event.reason}</p>
          {artifact && (
            <button
              onClick={() => void window.electronAPI?.showItemInFolder(artifact)}
              className="mt-2 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{artifact}</span>
            </button>
          )}
        </div>
        <time className="shrink-0 text-[10px] text-text-muted">
          {new Date(event.timestamp).toLocaleString()}
        </time>
      </div>
    </div>
  );
}

function priorityColor(priority: 'low' | 'medium' | 'high'): string {
  if (priority === 'high') return 'text-warning';
  if (priority === 'medium') return 'text-accent';
  return 'text-text-muted';
}

function CompanionCardRow({
  card,
  busy,
  onStatus,
}: {
  card: CompanionCard;
  busy: boolean;
  onStatus: (cardId: string, status: CompanionCardStatus) => void;
}) {
  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ListChecks className="h-4 w-4 text-accent" />
            <span className={`text-[10px] font-semibold uppercase ${priorityColor(card.priority)}`}>
              {card.priority}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {card.kind}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {card.status}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-text-primary">{card.title}</p>
          {card.body && <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{card.body}</p>}
          {card.actions.length > 0 && (
            <div className="mt-2 space-y-1">
              {card.actions.slice(0, 3).map((action) => (
                <div key={action.id} className="rounded bg-background px-2 py-1">
                  <span className="text-[11px] font-medium text-text-primary">{action.label}</span>
                  {action.command && (
                    <code className="mt-1 block truncate text-[10px] text-text-muted">{action.command}</code>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {card.status === 'open' && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              disabled={busy}
              onClick={() => onStatus(card.id, 'resolved')}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Resolve
            </button>
            <button
              disabled={busy}
              onClick={() => onStatus(card.id, 'dismissed')}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function GatewayChannelRow({
  channel,
  busy,
  onUpdate,
}: {
  channel: CompanionGatewayProfile['channels'][number];
  busy: boolean;
  onUpdate: (
    channel: string,
    updates: {
      enabled?: boolean;
      mode?: CompanionGatewayMode;
      allowOutbound?: boolean;
      requireApprovalForTools?: boolean;
    },
  ) => void;
}) {
  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-gateway-channel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Radio className={`h-4 w-4 ${channel.enabled ? 'text-accent' : 'text-text-muted'}`} />
            <span className="text-xs font-semibold text-text-primary">{channel.channel}</span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {channel.enabled ? channel.mode : 'paused'}
            </span>
            {channel.allowOutbound && (
              <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                outbound
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {channel.requireApprovalForTools ? 'Tool approval on' : 'Tool approval off'} · {channel.recordPercepts ? 'percepts on' : 'percepts off'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <button
            disabled={busy}
            onClick={() => onUpdate(channel.channel, {
              enabled: true,
              mode: 'observe',
              allowOutbound: false,
              requireApprovalForTools: true,
            })}
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
          >
            Observe
          </button>
          <button
            disabled={busy}
            onClick={() => onUpdate(channel.channel, {
              enabled: true,
              mode: 'assist',
              allowOutbound: false,
              requireApprovalForTools: true,
            })}
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
          >
            Assist
          </button>
          <button
            disabled={busy}
            onClick={() => onUpdate(channel.channel, {
              enabled: true,
              mode: 'act',
              allowOutbound: true,
              requireApprovalForTools: true,
            })}
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
          >
            Act
          </button>
          <button
            disabled={busy}
            onClick={() => onUpdate(channel.channel, { enabled: false })}
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
          >
            Pause
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillCandidateRow({
  candidate,
  busy,
  onPromote,
  onDismiss,
}: {
  candidate: CompanionSkillCandidate;
  busy: boolean;
  onPromote: (candidateId: string) => void;
  onDismiss: (candidateId: string) => void;
}) {
  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-skill-candidate">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-primary">{candidate.title}</span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {candidate.status}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {candidate.score}/100
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">{candidate.trigger}</p>
          {candidate.command && (
            <code className="mt-2 block truncate rounded bg-background px-1.5 py-1 text-[10px] text-text-muted">
              {candidate.command}
            </code>
          )}
          {candidate.artifactPath && (
            <button
              onClick={() => void window.electronAPI.showItemInFolder(candidate.artifactPath!)}
              className="mt-2 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{candidate.artifactPath}</span>
            </button>
          )}
        </div>
        {candidate.status !== 'promoted' && candidate.status !== 'dismissed' && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              disabled={busy}
              onClick={() => onPromote(candidate.id)}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Promote
            </button>
            <button
              disabled={busy}
              onClick={() => onDismiss(candidate.id)}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CompanionPanel() {
  const show = useAppStore((s) => s.showCompanionPanel);
  const setShow = useAppStore((s) => s.setShowCompanionPanel);

  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [stats, setStats] = useState<CompanionPerceptStats | null>(null);
  const [percepts, setPercepts] = useState<CompanionPercept[]>([]);
  const [evaluation, setEvaluation] = useState<CompanionSelfEvaluation | null>(null);
  const [radar, setRadar] = useState<CompanionCompetitiveRadar | null>(null);
  const [impulses, setImpulses] = useState<CompanionImpulseBrief | null>(null);
  const [missions, setMissions] = useState<CompanionMission[]>([]);
  const [missionRun, setMissionRun] = useState<CompanionMissionRunResult | null>(null);
  const [safetyEvents, setSafetyEvents] = useState<CompanionSafetyEvent[]>([]);
  const [safetyStats, setSafetyStats] = useState<CompanionSafetyLedgerStats | null>(null);
  const [cards, setCards] = useState<CompanionCard[]>([]);
  const [gateway, setGateway] = useState<CompanionGatewayProfile | null>(null);
  const [skillCandidates, setSkillCandidates] = useState<CompanionSkillCandidate[]>([]);
  const [skillCuratorResult, setSkillCuratorResult] = useState<CompanionSkillCuratorResult | null>(null);
  const [setupResult, setSetupResult] = useState<CompanionSetupResponse | null>(null);
  const [voiceConversation, setVoiceConversation] = useState<VoiceConversationSnapshot | null>(null);
  const [modality, setModality] = useState<CompanionPerceptModality | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<'setup' | 'self' | 'camera' | 'evaluate' | 'radar' | 'impulses' | 'missions' | 'runNext' | 'mission' | 'card' | 'gateway' | 'skills' | 'skill' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<CameraSnapshotResult | null>(null);

  const filteredStats = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byModality).sort(([a], [b]) => a.localeCompare(b));
  }, [stats]);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.companion) return;
    setLoading(true);
    setError(null);

    const selected = modality === 'all' ? undefined : modality;
    const [
      statusRes,
      recentRes,
      statsRes,
      impulsesRes,
      missionsRes,
      safetyRecentRes,
      safetyStatsRes,
      cardsRes,
      gatewayRes,
      skillsRes,
      voiceConversationRes,
    ] = await Promise.all([
      window.electronAPI.companion.status(),
      window.electronAPI.companion.recentPercepts({ limit: 30, modality: selected }),
      window.electronAPI.companion.perceptStats(),
      window.electronAPI.companion.impulses({ recordSuggestions: false }),
      window.electronAPI.companion.listMissions(),
      window.electronAPI.companion.recentSafetyEvents({ limit: 8 }),
      window.electronAPI.companion.safetyStats(),
      window.electronAPI.companion.listCards({ status: 'open', limit: 8 }),
      window.electronAPI.companion.gatewayProfile(),
      window.electronAPI.companion.listSkillCandidates(),
      window.electronAPI.voice.conversationStatus().catch(() => null),
    ]);

    setLoading(false);
    if (!statusRes.ok) {
      setStatus(null);
      setStats(null);
      setPercepts([]);
      setImpulses(null);
      setMissions([]);
      setSafetyEvents([]);
      setSafetyStats(null);
      setCards([]);
      setGateway(null);
      setSkillCandidates([]);
      setVoiceConversation(voiceConversationRes);
      setError(statusRes.error === 'NO_ACTIVE_PROJECT'
        ? 'Select a project before opening Buddy companion senses.'
        : statusRes.error ?? 'Failed to load companion status');
      return;
    }

    setStatus(statusRes.status ?? null);
    setPercepts(recentRes.ok ? recentRes.items : []);
    setStats(statsRes.ok ? statsRes.stats ?? null : null);
    setImpulses(impulsesRes.ok ? impulsesRes.brief ?? null : null);
    setMissions(missionsRes.ok ? missionsRes.items : []);
    setSafetyEvents(safetyRecentRes.ok ? safetyRecentRes.items : []);
    setSafetyStats(safetyStatsRes.ok ? safetyStatsRes.stats ?? null : null);
    setCards(cardsRes.ok ? cardsRes.items : []);
    setGateway(gatewayRes.ok ? gatewayRes.profile ?? null : null);
    setSkillCandidates(skillsRes.ok ? skillsRes.items : []);
    setVoiceConversation(voiceConversationRes);
    if (!recentRes.ok || !statsRes.ok || !impulsesRes.ok || !missionsRes.ok || !safetyRecentRes.ok || !safetyStatsRes.ok || !cardsRes.ok || !gatewayRes.ok || !skillsRes.ok) {
      setError(recentRes.error
        ?? statsRes.error
        ?? impulsesRes.error
        ?? missionsRes.error
        ?? safetyRecentRes.error
        ?? safetyStatsRes.error
        ?? cardsRes.error
        ?? gatewayRes.error
        ?? skillsRes.error
        ?? 'Failed to load companion state');
    }
  }, [modality]);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  const recordSelf = async () => {
    setBusyAction('self');
    setError(null);
    const res = await window.electronAPI.companion.recordSelf();
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Self-state recording failed');
      return;
    }
    await refresh();
  };

  const activateCompanion = async () => {
    setBusyAction('setup');
    setError(null);
    const res = await window.electronAPI.companion.setup({
      configureVoice: true,
      configureModel: true,
      recordSelf: true,
    });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Companion activation failed');
      return;
    }
    setSetupResult(res.result ?? null);
    if (res.result?.setup.status) {
      setStatus(res.result.setup.status);
    }
    await refresh();
  };

  const captureCamera = async () => {
    setBusyAction('camera');
    setError(null);
    const res = await window.electronAPI.companion.cameraSnapshot({ timeoutMs: 10000 });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Camera snapshot failed');
      return;
    }
    setLastSnapshot(res.result ?? null);
    await refresh();
  };

  const runEvaluation = async () => {
    setBusyAction('evaluate');
    setError(null);
    const res = await window.electronAPI.companion.evaluate({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Self-evaluation failed');
      return;
    }
    setEvaluation(res.evaluation ?? null);
    await refresh();
  };

  const runRadar = async () => {
    setBusyAction('radar');
    setError(null);
    const res = await window.electronAPI.companion.radar({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Competitive radar failed');
      return;
    }
    setRadar(res.radar ?? null);
    await refresh();
  };

  const runImpulses = async () => {
    setBusyAction('impulses');
    setError(null);
    const res = await window.electronAPI.companion.impulses({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Companion impulses failed');
      return;
    }
    setImpulses(res.brief ?? null);
    await refresh();
  };

  const syncMissions = async () => {
    setBusyAction('missions');
    setError(null);
    const res = await window.electronAPI.companion.syncMissions({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Mission sync failed');
      return;
    }
    setMissions(res.result?.board.missions ?? []);
    await refresh();
  };

  const runNextMission = async () => {
    setBusyAction('runNext');
    setError(null);
    const res = await window.electronAPI.companion.runNextMission();
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Mission runner failed');
      return;
    }
    setMissionRun(res.result ?? null);
    await refresh();
  };

  const updateMission = async (missionId: string, status: CompanionMissionStatus) => {
    setBusyAction('mission');
    setError(null);
    const res = await window.electronAPI.companion.updateMission({ missionId, status });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Mission update failed');
      return;
    }
    await refresh();
  };

  const updateCard = async (cardId: string, status: CompanionCardStatus) => {
    setBusyAction('card');
    setError(null);
    const res = await window.electronAPI.companion.updateCard({ cardId, status });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Card update failed');
      return;
    }
    await refresh();
  };

  const updateGatewayChannel = async (
    channel: string,
    updates: {
      enabled?: boolean;
      mode?: CompanionGatewayMode;
      allowOutbound?: boolean;
      requireApprovalForTools?: boolean;
    },
  ) => {
    setBusyAction('gateway');
    setError(null);
    const res = await window.electronAPI.companion.updateGatewayChannel({
      channel,
      ...updates,
    });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Gateway update failed');
      return;
    }
    setGateway(res.profile ?? null);
    await refresh();
  };

  const curateSkills = async () => {
    setBusyAction('skills');
    setError(null);
    const res = await window.electronAPI.companion.curateSkills({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Skill curation failed');
      return;
    }
    setSkillCuratorResult(res.result ?? null);
    setSkillCandidates(res.result?.store.candidates ?? []);
    await refresh();
  };

  const promoteSkill = async (candidateId: string) => {
    setBusyAction('skill');
    setError(null);
    const res = await window.electronAPI.companion.promoteSkillCandidate({ candidateId });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Skill promotion failed');
      return;
    }
    await refresh();
  };

  const dismissSkill = async (candidateId: string) => {
    setBusyAction('skill');
    setError(null);
    const res = await window.electronAPI.companion.dismissSkillCandidate({ candidateId });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Skill dismissal failed');
      return;
    }
    await refresh();
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm">
      <div className="flex h-full w-[640px] max-w-[calc(100vw-32px)] flex-col border-l border-border bg-background-secondary shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Buddy companion</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Refresh companion panel"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShow(false)}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Close companion panel"
            >
              <X className="h-4 w-4 text-text-muted" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Readiness</h3>
              {status?.cwd && <span className="text-[10px] text-text-muted truncate max-w-[360px]">{status.cwd}</span>}
            </div>

            {status ? (
              <div className="grid grid-cols-2 gap-2">
                <StatusTile
                  icon={Brain}
                  label="Brain"
                  value={status.chatGptCredentialsPresent ? status.model : 'ChatGPT login missing'}
                  ok={status.chatGptCredentialsPresent}
                />
                <StatusTile
                  icon={Bot}
                  label="Identity"
                  value={status.identity.soulIsCompanion && status.identity.bootIsCompanion ? 'Companion identity' : 'Identity incomplete'}
                  ok={status.identity.soulIsCompanion && status.identity.bootIsCompanion}
                />
                <StatusTile
                  icon={Mic}
                  label="Voice input"
                  value={`${ready(status.voice.enabled && status.voice.available)} / ${status.voice.provider}`}
                  ok={status.voice.enabled && status.voice.available}
                />
                <StatusTile
                  icon={Volume2}
                  label="Voice output"
                  value={`${ready(status.tts.enabled && status.tts.available)} / ${status.tts.provider}`}
                  ok={status.tts.enabled && status.tts.available}
                />
                <StatusTile
                  icon={Activity}
                  label="Dialogue"
                  value={voiceConversation ? `${voiceConversation.phase} / turn ${voiceConversation.turnId}` : 'No voice session'}
                  ok={Boolean(voiceConversation && voiceConversation.phase !== 'error')}
                />
                <StatusTile
                  icon={Camera}
                  label="Camera"
                  value={`${ready(status.camera.available)} / ${status.camera.platform}`}
                  ok={status.camera.available}
                />
                <StatusTile
                  icon={Radio}
                  label="Wake word"
                  value={`${status.wakeWord.engine} / ${status.wakeWord.wakeWords.join(', ')}`}
                  ok={status.wakeWord.available}
                />
              </div>
            ) : (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                {loading ? 'Loading companion state...' : 'No companion status loaded.'}
              </div>
            )}
          </section>

          <section className="flex flex-wrap gap-2">
            <button
              disabled={busyAction !== null}
              onClick={() => void activateCompanion()}
              className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Bot className="h-4 w-4" />
              {busyAction === 'setup' ? 'Activating...' : 'Activate companion'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void recordSelf()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Bot className="h-4 w-4" />
              {busyAction === 'self' ? 'Recording...' : 'Record self-state'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void captureCamera()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
              {busyAction === 'camera' ? 'Capturing...' : 'Camera snapshot'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runEvaluation()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <ClipboardCheck className="h-4 w-4" />
              {busyAction === 'evaluate' ? 'Evaluating...' : 'Self-evaluate'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runRadar()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Radar className="h-4 w-4" />
              {busyAction === 'radar' ? 'Scanning...' : 'Competitive radar'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runImpulses()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {busyAction === 'impulses' ? 'Thinking...' : 'Build impulses'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void syncMissions()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <ListChecks className="h-4 w-4" />
              {busyAction === 'missions' ? 'Syncing...' : 'Sync missions'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runNextMission()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {busyAction === 'runNext' ? 'Preparing...' : 'Run next mission'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void curateSkills()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {busyAction === 'skills' ? 'Curating...' : 'Curate routines'}
            </button>
            {lastSnapshot?.path && (
              <button
                onClick={() => void window.electronAPI.showItemInFolder(lastSnapshot.path!)}
                className="inline-flex min-w-0 items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface"
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate max-w-[260px]">{lastSnapshot.path}</span>
              </button>
            )}
          </section>

          {setupResult && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Activation</h3>
                <span className="text-[10px] text-text-muted">
                  {setupResult.selfPercept ? 'self-state recorded' : 'setup complete'}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Bot className="h-4 w-4 text-accent" />
                  <span className="text-xs font-semibold text-text-primary">
                    Companion identity {setupResult.setup.wroteSoul || setupResult.setup.wroteBoot ? 'installed' : 'already present'}
                  </span>
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                    voice {setupResult.setup.voiceConfigured ? 'configured' : 'skipped'}
                  </span>
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                    model {setupResult.setup.modelConfigured ? setupResult.setup.model : 'unchanged'}
                  </span>
                </div>
                {setupResult.selfPerceptError && (
                  <p className="mt-2 text-xs text-warning">{setupResult.selfPerceptError}</p>
                )}
              </div>
            </section>
          )}

          {impulses && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Impulses</h3>
                <span className="text-[10px] text-text-muted">
                  {new Date(impulses.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{impulses.summary}</p>
                    <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{impulses.nextPrompt}</p>
                  </div>
                </div>
                {impulses.impulses.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {impulses.impulses.slice(0, 4).map((impulse) => (
                      <div key={impulse.id} className="rounded bg-background px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-semibold uppercase ${
                            impulse.priority === 'high'
                              ? 'text-warning'
                              : impulse.priority === 'medium'
                                ? 'text-accent'
                                : 'text-text-muted'
                          }`}>
                            {impulse.priority}
                          </span>
                          <span className="text-[10px] uppercase text-text-muted">{impulse.kind}</span>
                          <span className="text-xs font-medium text-text-primary">{impulse.title}</span>
                        </div>
                        <p className="mt-1 text-xs text-text-secondary">{impulse.message}</p>
                        {impulse.command && (
                          <code className="mt-1 block truncate rounded bg-surface px-1.5 py-1 text-[10px] text-text-muted">
                            {impulse.command}
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Companion cards</h3>
              <span className="text-[10px] text-text-muted">{cards.length} open</span>
            </div>
            {cards.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                No open companion cards.
              </div>
            ) : (
              <div className="space-y-2">
                {cards.map((card) => (
                  <CompanionCardRow
                    key={card.id}
                    card={card}
                    busy={busyAction !== null}
                    onStatus={(cardId, nextStatus) => void updateCard(cardId, nextStatus)}
                  />
                ))}
              </div>
            )}
          </section>

          {gateway && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Gateway</h3>
                <span className="text-[10px] text-text-muted">
                  {gateway.channels.filter((channel) => channel.enabled).length}/{gateway.channels.length} enabled
                </span>
              </div>
              <div className="space-y-2">
                {gateway.channels.slice(0, 8).map((channel) => (
                  <GatewayChannelRow
                    key={channel.channel}
                    channel={channel}
                    busy={busyAction !== null}
                    onUpdate={(name, updates) => void updateGatewayChannel(name, updates)}
                  />
                ))}
              </div>
              {gateway.storePath && (
                <button
                  onClick={() => void window.electronAPI.showItemInFolder(gateway.storePath)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{gateway.storePath}</span>
                </button>
              )}
            </section>
          )}

          {missionRun && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Mission run</h3>
                <span className="text-[10px] text-text-muted">
                  {missionRun.success ? 'prepared' : 'blocked'}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4 text-accent" />
                  <span className="text-sm font-semibold text-text-primary">{missionRun.message}</span>
                </div>
                {missionRun.mission && (
                  <p className="mt-2 text-xs text-text-secondary">
                    [{missionRun.mission.priority}] {missionRun.mission.title}
                  </p>
                )}
                {missionRun.briefPath && (
                  <button
                    onClick={() => void window.electronAPI.showItemInFolder(missionRun.briefPath!)}
                    className="mt-3 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{missionRun.briefPath}</span>
                  </button>
                )}
              </div>
            </section>
          )}

          {evaluation && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Self-evaluation</h3>
                <span className="text-[10px] text-text-muted">
                  {new Date(evaluation.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-accent" />
                    <span className="text-sm font-semibold text-text-primary">
                      {evaluation.score}/100
                    </span>
                    <span className="rounded bg-background px-2 py-0.5 text-[10px] uppercase text-text-muted">
                      {evaluation.level}
                    </span>
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {evaluation.findings.length} finding(s)
                  </span>
                </div>
                {evaluation.nextActions.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {evaluation.nextActions.slice(0, 3).map((action) => (
                      <p key={action} className="text-xs text-text-secondary">
                        {action}
                      </p>
                    ))}
                  </div>
                )}
                {evaluation.findings.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {evaluation.findings.slice(0, 4).map((finding) => (
                      <div key={finding.id} className="rounded bg-background px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold uppercase ${
                            finding.severity === 'action'
                              ? 'text-warning'
                              : finding.severity === 'warning'
                                ? 'text-warning'
                                : 'text-text-muted'
                          }`}>
                            {finding.severity}
                          </span>
                          <span className="text-[10px] uppercase text-text-muted">{finding.area}</span>
                        </div>
                        <p className="mt-1 text-xs text-text-primary">{finding.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {radar && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Competitive radar</h3>
                <span className="text-[10px] text-text-muted">
                  {radar.score}/100
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-center gap-2">
                  <Radar className="h-4 w-4 text-accent" />
                  <span className="text-sm font-semibold text-text-primary">Hermes / OpenClaw / Lisa / UNI gaps</span>
                </div>
                {radar.nextMoves.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {radar.nextMoves.slice(0, 3).map((move) => (
                      <p key={move} className="text-xs text-text-secondary">
                        {move}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {radar.gaps.slice(0, 4).map((gap) => (
                    <div key={gap.id} className="rounded bg-background px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold uppercase ${
                          gap.severity === 'gap' ? 'text-warning' : 'text-text-muted'
                        }`}>
                          {gap.severity}
                        </span>
                        <span className="text-[10px] uppercase text-text-muted">{gap.dimension}</span>
                        <span className="truncate text-[10px] text-text-muted">
                          {gap.competitorRefs.join(', ')}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-text-primary">{gap.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Mission board</h3>
              <span className="text-[10px] text-text-muted">
                {missions.length} mission(s)
              </span>
            </div>
            {missions.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                Sync missions to turn the competitive radar into a working backlog.
              </div>
            ) : (
              <div className="space-y-2">
                {missions.slice(0, 5).map((mission) => (
                  <div key={mission.id} className="rounded border border-border bg-surface/35 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                            {mission.priority}
                          </span>
                          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                            {mission.status}
                          </span>
                          <span className="text-[10px] uppercase text-text-muted">{mission.dimension}</span>
                        </div>
                        <p className="mt-1 text-xs font-medium text-text-primary">{mission.title}</p>
                        <p className="mt-1 text-xs text-text-secondary">{mission.recommendation}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        {mission.status === 'open' && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => void updateMission(mission.id, 'in_progress')}
                            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
                          >
                            Start
                          </button>
                        )}
                        {mission.status === 'in_progress' && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => void updateMission(mission.id, 'done')}
                            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
                          >
                            Done
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Learned routines</h3>
              <span className="text-[10px] text-text-muted">
                {skillCandidates.length} candidate(s)
              </span>
            </div>
            {skillCuratorResult && (
              <div className="rounded border border-border bg-surface/35 p-3 text-xs text-text-secondary">
                {skillCuratorResult.created} created · {skillCuratorResult.updated} updated · {skillCuratorResult.pruned} pruned
              </div>
            )}
            {skillCandidates.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                Curate routines after missions or percepts exist.
              </div>
            ) : (
              <div className="space-y-2">
                {skillCandidates.slice(0, 5).map((candidate) => (
                  <SkillCandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    busy={busyAction !== null}
                    onPromote={(candidateId) => void promoteSkill(candidateId)}
                    onDismiss={(candidateId) => void dismissSkill(candidateId)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Safety ledger</h3>
              <span className="text-[10px] text-text-muted">
                {safetyStats ? `${safetyStats.total} event(s)` : 'No stats'}
              </span>
            </div>
            {safetyStats?.ledgerPath && (
              <button
                onClick={() => void window.electronAPI.showItemInFolder(safetyStats.ledgerPath)}
                className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{safetyStats.ledgerPath}</span>
              </button>
            )}
            {safetyEvents.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                No safety events recorded yet.
              </div>
            ) : (
              <div className="space-y-2">
                {safetyEvents.map((event) => (
                  <SafetyEventRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Sensory journal</h3>
              <span className="text-[10px] text-text-muted">
                {stats ? `${stats.total} percepts` : 'No stats'}
              </span>
            </div>
            {stats?.storePath && (
              <button
                onClick={() => void window.electronAPI.showItemInFolder(stats.storePath)}
                className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{stats.storePath}</span>
              </button>
            )}
            {filteredStats.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {filteredStats.map(([key, count]) => (
                  <span key={key} className="rounded bg-surface px-2 py-1 text-[10px] text-text-muted">
                    {key}: {count}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {MODALITIES.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setModality(item.key)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    modality === item.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {percepts.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-8 text-center text-xs text-text-muted">
                {loading ? 'Loading percepts...' : 'No percepts for this filter yet.'}
              </div>
            ) : (
              <div className="space-y-2">
                {percepts.map((percept) => (
                  <PerceptRow key={percept.id} percept={percept} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
