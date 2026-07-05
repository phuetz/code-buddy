/**
 * OneScreenOnboarding — compact first-run path chooser.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/OneScreenOnboarding
 */

import { useTranslation } from 'react-i18next';
import { LogIn, MonitorCog, Sparkles } from 'lucide-react';
import { recommendPath } from '../utils/onboarding-steps';

export interface OneScreenOnboardingProps {
  detected: 'ollama' | 'login' | 'none';
  onChoose: (choice: 'ollama' | 'login') => void;
}

export function OneScreenOnboarding({ detected, onChoose }: OneScreenOnboardingProps) {
  const { t } = useTranslation();
  const recommendation = recommendPath({ hasOllama: detected === 'ollama', hasLogin: detected === 'login' });
  const primaryChoice = detected === 'ollama' ? 'ollama' : 'login';
  const secondaryChoice = primaryChoice === 'ollama' ? 'login' : 'ollama';

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="one-screen-onboarding">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <Sparkles aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.onboarding.title', 'Démarrer Cowork')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('genspark.onboarding.subtitle', 'Un chemin clair pour lancer le premier agent.')}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          aria-label={recommendation.primary}
          className="rounded-lg border border-primary bg-primary/15 p-4 text-left text-primary transition-colors hover:bg-primary/20"
          data-testid="onboarding-primary"
          onClick={() => onChoose(primaryChoice)}
        >
          {primaryChoice === 'ollama' ? <MonitorCog aria-hidden="true" className="mb-3 h-5 w-5" /> : <LogIn aria-hidden="true" className="mb-3 h-5 w-5" />}
          <span className="block text-sm font-semibold">{recommendation.primary}</span>
        </button>
        <button
          type="button"
          aria-label={recommendation.secondary}
          className="rounded-lg border border-border bg-background p-4 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          data-testid="onboarding-secondary"
          onClick={() => onChoose(secondaryChoice)}
        >
          {secondaryChoice === 'ollama' ? <MonitorCog aria-hidden="true" className="mb-3 h-5 w-5" /> : <LogIn aria-hidden="true" className="mb-3 h-5 w-5" />}
          <span className="block text-sm font-medium">{recommendation.secondary}</span>
        </button>
      </div>
    </section>
  );
}
