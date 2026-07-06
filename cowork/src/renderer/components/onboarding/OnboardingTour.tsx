import { useState } from 'react';
import { TOUR_STEPS, nextStep } from './onboarding-tour-model';

export interface OnboardingTourProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingTour({ open, onClose }: OnboardingTourProps) {
  const [stepIndex, setStepIndex] = useState(0);

  if (!open) return null;

  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === TOUR_STEPS.length - 1;

  const goToPreviousStep = () => {
    setStepIndex((current) => nextStep(current, TOUR_STEPS.length, 'prev'));
  };

  const goToNextStep = () => {
    if (isLastStep) {
      onClose();
      return;
    }
    setStepIndex((current) => nextStep(current, TOUR_STEPS.length, 'next'));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      data-testid="onboarding-tour"
      role="presentation"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-tour-title"
      >
        <div className="border-b border-border-muted px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Première ouverture
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              Passer
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-6">
          <div className="flex items-start gap-4">
            {step.railGlyph ? (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-lg font-semibold text-accent">
                {step.railGlyph}
              </div>
            ) : null}
            <div className="space-y-2">
              <h2 id="onboarding-tour-title" className="text-lg font-semibold text-text">
                {step.title}
              </h2>
              <p className="text-sm leading-6 text-text-muted">{step.body}</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2" aria-label="Progression du tour">
            {TOUR_STEPS.map((tourStep, index) => (
              <span
                key={tourStep.id}
                className={`h-2 rounded-full transition-all ${
                  index === stepIndex ? 'w-6 bg-accent' : 'w-2 bg-border-muted'
                }`}
                aria-current={index === stepIndex ? 'step' : undefined}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-muted px-5 py-4">
          <button
            type="button"
            onClick={goToPreviousStep}
            disabled={isFirstStep}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Précédent
          </button>
          <button
            type="button"
            onClick={goToNextStep}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
          >
            {isLastStep ? 'Terminer' : 'Suivant'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OnboardingTour;
