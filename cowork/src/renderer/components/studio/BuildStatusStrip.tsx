import { StopCircle } from 'lucide-react';
import { Pill } from '../ui/Pill.js';
import { StatTile } from '../ui/StatTile.js';
import type { UiTone } from '../../utils/ui-tone.js';

export type BuildPhase = 'idle' | 'scaffolding' | 'installing' | 'starting' | 'running' | 'dead';

export interface BuildStatusStripProps {
  phase: BuildPhase;
  elapsedMs: number;
  onStop: () => void;
}

const PHASE_LABELS: Record<BuildPhase, string> = {
  idle: 'Prêt',
  scaffolding: 'Scaffold',
  installing: 'Install',
  starting: 'Démarrage',
  running: 'En ligne',
  dead: 'Arrêté',
};

function toneForPhase(phase: BuildPhase): UiTone {
  if (phase === 'running') return 'success';
  if (phase === 'dead') return 'danger';
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

export function BuildStatusStrip({ phase, elapsedMs, onStop }: BuildStatusStripProps) {
  const canStop = phase === 'starting' || phase === 'running' || phase === 'installing';

  return (
    <section className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-3 py-2">
      <Pill tone={toneForPhase(phase)}>{PHASE_LABELS[phase]}</Pill>
      <div className="w-28">
        <StatTile label="Durée" value={formatElapsed(elapsedMs)} tone="default" />
      </div>
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        {phase === 'idle' && 'Aucun build actif.'}
        {phase === 'scaffolding' && 'Création des fichiers du projet.'}
        {phase === 'installing' && 'Installation des dépendances.'}
        {phase === 'starting' && 'Lancement du serveur local.'}
        {phase === 'running' && 'Preview locale disponible.'}
        {phase === 'dead' && 'Le serveur ne répond plus.'}
      </div>
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
