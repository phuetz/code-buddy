/**
 * Pure onboarding recommendation helpers.
 *
 * @module renderer/utils/onboarding-steps
 */

export interface OnboardingEnv {
  hasOllama?: boolean;
  hasLogin?: boolean;
}

export function recommendPath(env: OnboardingEnv): { primary: string; secondary: string } {
  if (env.hasOllama) {
    return { primary: 'Utiliser Ollama local ($0)', secondary: 'Connecter un compte OAuth ensuite' };
  }
  if (env.hasLogin) {
    return { primary: 'Continuer avec le login OAuth', secondary: 'Installer Ollama plus tard' };
  }
  return { primary: 'Se connecter pour commencer', secondary: 'Configurer Ollama local' };
}
