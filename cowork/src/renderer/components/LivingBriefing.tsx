import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  FileText,
  House,
  MessageCircleMore,
  MoonStar,
  Radio,
  RefreshCw,
  Sparkles,
  SunMedium,
  Volume2,
} from 'lucide-react';

import type { Session } from '../types';
import type { ActivityEntry } from './activity-feed-helpers';
import { GuidedTooltip } from './Tooltip';
import { speakText } from './VoiceOutputToggle';
import {
  buildLivingBriefing,
  type BriefingMoment,
  type LivingBriefingInput,
} from './living-briefing-model.js';
import type { AutonomySnapshot } from './os-panels/autonomy-queue-model.js';
import type { OsAutonomyBriefingPayload } from '../../shared/autonomy-briefing-ipc.js';
import type { MaisonSnapshotPayload } from '../../shared/maison-ipc.js';

interface LivingBriefingProps {
  sessions: Session[];
  onOpenMissionControl: () => void;
}

interface BriefingSignals {
  activities: ActivityEntry[];
  snapshot: AutonomySnapshot | null;
  daemonRunning: boolean | null;
  artifact: OsAutonomyBriefingPayload | null;
  maison: MaisonSnapshotPayload | null;
}

const EMPTY_SIGNALS: BriefingSignals = {
  activities: [],
  snapshot: null,
  daemonRunning: null,
  artifact: null,
  maison: null,
};

function maisonCueClasses(tone: 'calm' | 'active' | 'warning'): string {
  if (tone === 'warning') return 'border-warning/25 bg-warning/10 text-warning';
  if (tone === 'active') return 'border-accent/20 bg-accent/5 text-accent';
  return 'border-success/15 bg-success/5 text-success';
}

function MomentIcon({ moment }: { moment: BriefingMoment }) {
  const className = moment.tone === 'warning'
    ? 'text-warning'
    : moment.tone === 'memory'
      ? 'text-violet-500'
      : moment.tone === 'success'
        ? 'text-success'
        : 'text-text-muted';
  if (moment.tone === 'warning') return <AlertTriangle className={`h-3.5 w-3.5 ${className}`} />;
  if (moment.tone === 'memory') return <BrainCircuit className={`h-3.5 w-3.5 ${className}`} />;
  if (moment.tone === 'success') return <CheckCircle2 className={`h-3.5 w-3.5 ${className}`} />;
  return <MessageCircleMore className={`h-3.5 w-3.5 ${className}`} />;
}

function BriefingOrb({ hour }: { hour: number }) {
  const Icon = hour >= 6 && hour < 18 ? SunMedium : MoonStar;
  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent shadow-soft">
      <span className="motion-safe:animate-pulse absolute inset-1 rounded-xl border border-accent/20" />
      <Icon className="relative h-5 w-5" aria-hidden="true" />
    </div>
  );
}

export function LivingBriefing({ sessions, onOpenMissionControl }: LivingBriefingProps) {
  const [signals, setSignals] = useState<BriefingSignals>(EMPTY_SIGNALS);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const requestId = ++requestSequenceRef.current;
    if (!quiet) setLoading(true);
    const api = window.electronAPI;
    try {
      const [activities, snapshot, daemon, artifact, maison] = await Promise.all([
        api?.activity?.recent?.(80).catch(() => [] as ActivityEntry[]) ?? Promise.resolve([] as ActivityEntry[]),
        api?.autonomy?.snapshot?.().catch(() => null) ?? Promise.resolve(null),
        api?.autonomy?.daemonStatus?.().catch(() => null) ?? Promise.resolve(null),
        api?.os?.autonomyBriefing?.().catch(() => null) ?? Promise.resolve(null),
        api?.maison?.snapshot?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      if (!mountedRef.current || requestId !== requestSequenceRef.current) return;
      setSignals({
        activities,
        snapshot: snapshot?.ok
          ? { tasks: snapshot.tasks ?? [], worklog: snapshot.worklog ?? [], presence: snapshot.presence ?? {} }
          : null,
        daemonRunning: daemon?.ok ? Boolean(daemon.service?.running) : null,
        artifact,
        maison,
      });
      setNow(Date.now());
      if (artifact) setExpanded(true);
    } finally {
      if (mountedRef.current && requestId === requestSequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const interval = window.setInterval(() => {
      void load(true);
    }, 60_000);
    const handleMaisonUpdate = (event: Event) => {
      const maison = (event as CustomEvent<MaisonSnapshotPayload>).detail;
      if (!maison || !mountedRef.current) return;
      requestSequenceRef.current += 1;
      setSignals((current) => ({ ...current, maison }));
      setNow(Date.now());
      setLoading(false);
    };
    window.addEventListener('codebuddy:maison-updated', handleMaisonUpdate);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener('codebuddy:maison-updated', handleMaisonUpdate);
    };
  }, [load]);

  const input: LivingBriefingInput = useMemo(() => ({
    now,
    activities: signals.activities,
    sessions,
    snapshot: signals.snapshot,
    daemonRunning: signals.daemonRunning,
    artifact: signals.artifact,
    maison: signals.maison,
  }), [now, sessions, signals]);
  const briefing = useMemo(() => buildLivingBriefing(input), [input]);

  const speak = async () => {
    setSpeaking(true);
    try {
      await speakText(briefing.spokenText);
    } finally {
      if (mountedRef.current) setSpeaking(false);
    }
  };

  return (
    <section
      className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-surface shadow-soft"
      aria-label="Réveil vivant de Code Buddy"
      data-testid="living-briefing"
    >
      <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />
      <div className="relative p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <BriefingOrb hour={new Date(now).getHours()} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-xs font-medium text-text-muted">{briefing.greeting}</p>
              <span className="text-[10px] text-text-muted/70">·</span>
              <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">{briefing.sourceLabel}</p>
            </div>
            <h2 className="mt-1 text-lg font-semibold leading-tight text-text-primary sm:text-xl">
              {briefing.headline}
            </h2>
            <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-text-secondary sm:text-sm">
              {loading ? 'Je rassemble les preuves de la relève…' : briefing.summary}
            </p>
          </div>
          <GuidedTooltip
            title="Actualiser la relève"
            description="Relit le rapport autonome, les sessions et le journal d’activité sans lancer de nouvelle mission."
            kicker="Réveil vivant"
            side="left"
          >
            <button
              type="button"
              onClick={() => void load(false)}
              disabled={loading}
              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-accent/10 hover:text-text-primary disabled:opacity-50"
              aria-label="Actualiser le briefing"
              data-testid="living-briefing-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </GuidedTooltip>
        </div>

        {briefing.maisonCue ? (
          <div
            className={`mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${maisonCueClasses(briefing.maisonCue.tone)}`}
            role="status"
            aria-live="polite"
            data-testid="living-briefing-maison"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-current/15 bg-surface/70">
              <House className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">Maison aujourd’hui</div>
              <div className="mt-0.5 text-xs font-semibold text-text-primary">{briefing.maisonCue.label}</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-text-secondary">{briefing.maisonCue.detail}</div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-4 divide-x divide-border/70 border-y border-border/70 py-2.5">
          {briefing.stats.map((stat) => (
            <div key={stat.label} className="min-w-0 px-2 text-center sm:px-3">
              <div className={`text-base font-semibold tabular-nums ${
                stat.tone === 'warning' ? 'text-warning' : stat.tone === 'success' ? 'text-success' : 'text-text-primary'
              }`}>
                {stat.value}
              </div>
              <div className="truncate text-[9px] uppercase tracking-wide text-text-muted sm:text-[10px]">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-text-muted" data-testid="living-briefing-daemon">
            <span className={`relative flex h-2 w-2 ${briefing.daemonTone === 'live' ? '' : 'opacity-70'}`}>
              {briefing.daemonTone === 'live' ? <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-50" /> : null}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${
                briefing.daemonTone === 'live' ? 'bg-success' : briefing.daemonTone === 'paused' ? 'bg-warning' : 'bg-text-muted'
              }`} />
            </span>
            {briefing.daemonLabel}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {briefing.artifactPath ? (
              <GuidedTooltip
                title="Ouvrir la relève probante"
                description="Affiche le rapport Markdown produit par le daemon à partir de son ledger et de son worklog local."
                kicker="Preuves"
                side="top"
              >
                <button
                  type="button"
                  onClick={() => void window.electronAPI.showItemInFolder(briefing.artifactPath!)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-accent/10 hover:text-text-primary"
                  data-testid="living-briefing-open-artifact"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  Rapport
                </button>
              </GuidedTooltip>
            ) : null}
            <GuidedTooltip
              title="Écouter la relève"
              description="Pocket TTS lit une synthèse courte ; le texte complet et les preuves restent visibles ici."
              kicker="Voix locale"
              side="top"
            >
              <button
                type="button"
                onClick={() => void speak()}
                disabled={speaking}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-accent/10 hover:text-text-primary disabled:opacity-60"
                data-testid="living-briefing-speak"
              >
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                {speaking ? 'Lecture…' : 'Écouter'}
              </button>
            </GuidedTooltip>
            <GuidedTooltip
              title="Entrer dans Mission Control"
              description="Ouvre le cockpit complet : intention, preuves, flotte, conseil de modèles et file autonome."
              kicker="Piloter"
              side="top"
            >
              <button
                type="button"
                onClick={onOpenMissionControl}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-background transition-colors hover:bg-accent-hover"
                data-testid="living-briefing-mission-control"
              >
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                Mission Control
              </button>
            </GuidedTooltip>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-accent/10 hover:text-text-primary"
              aria-expanded={expanded}
              aria-controls="living-briefing-details"
              data-testid="living-briefing-toggle"
            >
              Détails
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        {expanded ? (
          <div id="living-briefing-details" className="mt-3 grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-[1fr_0.72fr]" data-testid="living-briefing-details">
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Ce qui a bougé
              </div>
              {briefing.moments.length > 0 ? (
                <ol className="space-y-2">
                  {briefing.moments.slice(0, 3).map((moment) => (
                    <li key={moment.id} className="flex gap-2 text-xs">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-background">
                        <MomentIcon moment={moment} />
                      </span>
                      <div className="min-w-0">
                        <div className="line-clamp-1 font-medium text-text-primary">{moment.title}</div>
                        <div className="line-clamp-1 text-[10px] text-text-muted">
                          {moment.source}{moment.detail ? ` · ${moment.detail}` : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs leading-relaxed text-text-muted">
                  Aucun événement notable : la boucle est disponible sans inventer de travail.
                </p>
              )}
            </div>
            <div className="rounded-xl border border-border/80 bg-background/65 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                <BrainCircuit className="h-3 w-3" aria-hidden="true" />
                Prochaine intention sûre
              </div>
              {briefing.nextFocus ? (
                <>
                  <p className="mt-2 text-xs font-semibold leading-snug text-text-primary">{briefing.nextFocus.title}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-text-muted">{briefing.nextFocus.reason}</p>
                </>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-text-muted">
                  Rien d’urgent. Tu peux choisir librement la prochaine mission.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
