import { StopCircle, Wrench } from 'lucide-react';
import { Pill } from '../ui/Pill.js';
import { StatTile } from '../ui/StatTile.js';
import type { UiTone } from '../../utils/ui-tone.js';

export type BuildPhase = 'idle' | 'scaffolding' | 'installing' | 'starting' | 'running' | 'error';

export interface BuildStatusStripProps {
  phase: BuildPhase;
  elapsedMs: number;
  error?: string | null;
  /** Extra status shown alongside the phase (e.g. auto-fix "Fixing… 2/3"). */
  note?: string | null;
  /** Aperçu cassé détecté par la sonde (résumé), budget automatique épuisé. */
  problem?: string | null;
  /** « Corriger » : une tentative de correction à la demande (bolt.new « Attempt fix »). */
  onFix?: () => void;
  onStop: () => void;
}

const PHASE_LABELS: Record<BuildPhase, string> = {
  idle: 'Ready',
  scaffolding: 'Scaffold',
  installing: 'Install',
  starting: 'Starting',
  running: 'Online',
  error: 'Error',
};

function toneForPhase(phase: BuildPhase): UiTone {
  if (phase === 'running') return 'success';
  if (phase === 'error') return 'danger';
  if (phase === 'idle') return 'default';
  return 'info';
}

function formatElapsed(ms: number): string {
  const safeMs = Math.max(0, ms);
  const seconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes === 0) return `${remaining}s`;
  return `${minutes}m ${remaining}s`;
}

export function BuildStatusStrip({ phase, elapsedMs, error, note, problem, onFix, onStop }: BuildStatusStripProps) {
  const canStop = phase === 'starting' || phase === 'running' || phase === 'installing';

  return (
    <section className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-3 py-2">
      <Pill tone={toneForPhase(phase)}>{PHASE_LABELS[phase]}</Pill>
      {note ? (
        <span data-testid="build-note">
          <Pill tone="info">{note}</Pill>
        </span>
      ) : null}
      <div className="w-28">
        <StatTile label="Duration" value={formatElapsed(elapsedMs)} tone="default" />
      </div>
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        {phase === 'idle' && 'No active build.'}
        {phase === 'scaffolding' && 'Creating the project files.'}
        {phase === 'installing' && 'Installing dependencies.'}
        {phase === 'starting' && 'Starting the local server.'}
        {phase === 'running' && 'Local preview available.'}
        {phase === 'error' && (error || 'An error occurred.')}

      </div>
      {problem ? (
        <span className="inline-flex items-center gap-2" data-testid="build-problem">
          <Pill tone="danger">Aperçu cassé : {problem}</Pill>
          {onFix ? (
            <button
              type="button"
              onClick={onFix}
              data-testid="build-fix"
              title="Envoyer l'erreur détectée à l'agent pour une nouvelle tentative de correction"
              className="inline-flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground hover:bg-accent/90"
            >
              <Wrench className="h-4 w-4" aria-hidden="true" />
              Corriger
            </button>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onStop}
        disabled={!canStop}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <StopCircle className="h-4 w-4" aria-hidden="true" />
        Stop
      </button>
    </section>
  );
}
