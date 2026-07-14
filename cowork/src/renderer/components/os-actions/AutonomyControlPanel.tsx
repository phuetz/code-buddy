import { PauseCircle, PlayCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Pill } from '../ui/Pill.js';
import {
  guardrailsFor,
  validatePosture,
  type AutonomyPosture,
} from './utils/autonomy-control-model.js';

export interface AutonomyControlState {
  posture: AutonomyPosture;
  daemonPaused: boolean;
  costCapUsd: number;
}

export interface AutonomyControlPanelProps {
  state: AutonomyControlState;
  onPostureChange: (posture: AutonomyPosture) => void;
  onDaemonPause: () => void;
  onDaemonResume: () => void;
  onCostCapChange: (costCapUsd: number) => void;
}

const postures: AutonomyPosture[] = ['plan', 'auto', 'full'];

export function AutonomyControlPanel({
  state,
  onPostureChange,
  onDaemonPause,
  onDaemonResume,
  onCostCapChange,
}: AutonomyControlPanelProps) {
  const validation = validatePosture(state.posture);
  const guardrails = guardrailsFor(state.posture);
  const [costCapDraft, setCostCapDraft] = useState(String(state.costCapUsd));
  const parsedCostCap = Number(costCapDraft);
  const validCostCap =
    costCapDraft.trim() !== '' &&
    Number.isFinite(parsedCostCap) &&
    parsedCostCap >= 0 &&
    parsedCostCap <= 1_000_000;

  useEffect(() => {
    setCostCapDraft(String(state.costCapUsd));
  }, [state.costCapUsd]);

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Autonomie</div>
          <h3 className="mt-1 text-base font-semibold text-foreground">Posture de contrôle</h3>
        </div>
        <Pill tone={state.daemonPaused ? 'warning' : 'success'}>
          {state.daemonPaused ? 'daemon en pause' : 'daemon actif'}
        </Pill>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {postures.map((posture) => (
          <button
            key={posture}
            type="button"
            onClick={() => onPostureChange(posture)}
            className={`rounded-lg border px-3 py-2 text-left text-sm capitalize transition ${state.posture === posture ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-foreground hover:bg-muted'}`}
          >
            {posture}
          </button>
        ))}
      </div>
      {!validation.valid && <p className="mt-2 text-sm text-destructive">{validation.reason}</p>}
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (validCostCap) onCostCapChange(parsedCostCap);
        }}
      >
        <label className="block text-sm text-muted-foreground">
          Cap coût mensuel ($)
          <input
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            max={1_000_000}
            min={0}
            step={1}
            type="number"
            value={costCapDraft}
            onChange={(event) => setCostCapDraft(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!validCostCap}
          className="mt-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enregistrer le plafond
        </button>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onDaemonPause}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <PauseCircle className="h-4 w-4" /> Pause daemon
        </button>
        <button
          type="button"
          onClick={onDaemonResume}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <PlayCircle className="h-4 w-4" /> Reprise daemon
        </button>
      </div>
      <ul className="mt-4 space-y-2">
        {guardrails.map((guardrail) => (
          <li key={guardrail.id} className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> {guardrail.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
