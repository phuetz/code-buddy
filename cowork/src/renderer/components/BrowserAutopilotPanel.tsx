/**
 * BrowserAutopilotPanel — read-only browser automation plan plus start/stop callbacks.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/BrowserAutopilotPanel
 */

import { useTranslation } from 'react-i18next';
import { Camera, CircleCheck, CircleDashed, CircleX, Globe2, Loader2, Square, Play } from 'lucide-react';
import { progressOf, type NavStep } from '../utils/autopilot-plan';

export interface BrowserAutopilotPanelProps {
  steps: NavStep[];
  onStart: () => void;
  onStop: () => void;
}

function stepIcon(status: NavStep['status']) {
  if (status === 'done') return <CircleCheck aria-hidden="true" className="h-4 w-4 text-success" />;
  if (status === 'failed') return <CircleX aria-hidden="true" className="h-4 w-4 text-destructive" />;
  if (status === 'running') return <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-primary" />;
  return <CircleDashed aria-hidden="true" className="h-4 w-4 text-muted-foreground" />;
}

export function BrowserAutopilotPanel({ steps, onStart, onStop }: BrowserAutopilotPanelProps) {
  const { t } = useTranslation();
  const progress = progressOf(steps);
  const running = steps.some((step) => step.status === 'running');

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="browser-autopilot-panel">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Globe2 aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.browser.title', 'Browser autopilot')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {steps.length} étapes · {progress}% validé
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            aria-label={t('genspark.browser.start', 'Démarrer')}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="autopilot-start"
            disabled={running}
            onClick={onStart}
          >
            <Play aria-hidden="true" className="h-4 w-4" />
            {t('genspark.browser.start', 'Démarrer')}
          </button>
          <button
            type="button"
            aria-label={t('genspark.browser.stop', 'Stopper')}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="autopilot-stop"
            disabled={!running}
            onClick={onStop}
          >
            <Square aria-hidden="true" className="h-4 w-4" />
            {t('genspark.browser.stop', 'Stopper')}
          </button>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" aria-label={`Progression ${progress}%`}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
      </div>

      {steps.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.browser.empty', 'Aucun plan de navigation.')}
        </div>
      ) : (
        <ol className="mt-4 space-y-2">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className="rounded-lg border border-border bg-background p-3"
              data-testid={`autopilot-step-${step.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{stepIcon(step.status)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Étape {index + 1}</span>
                    {step.url && (
                      <span className="truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" title={step.url}>
                        {step.url}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-foreground">{step.label}</p>
                  {step.proof && (
                    <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                      <Camera aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate" title={step.proof}>
                        {step.proof}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
