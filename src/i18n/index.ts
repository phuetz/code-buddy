/**
 * Internationalization (i18n) System
 *
 * Provides locale-aware string translation with parameter interpolation.
 * Supports locales that have real translation tables.
 * Auto-detects locale from environment or config override.
 */

export type Locale = 'en' | 'fr';

const supportedLocales: readonly Locale[] = ['en', 'fr'];

export interface I18nStrings {
  // Common
  'common.yes': string;
  'common.no': string;
  'common.cancel': string;
  'common.confirm': string;
  'common.error': string;
  'common.success': string;
  'common.loading': string;
  // CLI
  'cli.welcome': string;
  'cli.goodbye': string;
  'cli.help': string;
  // Tools
  'tools.executing': string;
  'tools.completed': string;
  'tools.failed': string;
  // Errors
  'errors.api_error': string;
  'errors.rate_limit': string;
  'errors.auth_failed': string;
  'errors.timeout': string;
}

/** All locale string tables keyed by locale code */
const localeTables: Record<Locale, I18nStrings> = {} as Record<Locale, I18nStrings>;

/** Current active locale */
let currentLocale: Locale = 'en';

/** Whether auto-detection has already run */
let autoDetected = false;

/**
 * English strings (reference locale — always complete).
 */
const en: I18nStrings = {
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.error': 'Error',
  'common.success': 'Success',
  'common.loading': 'Loading...',
  'cli.welcome': 'Welcome to Code Buddy!',
  'cli.goodbye': 'Goodbye!',
  'cli.help': 'Type /help to see available commands.',
  'tools.executing': 'Executing {tool}...',
  'tools.completed': '{tool} completed successfully.',
  'tools.failed': '{tool} failed: {error}',
  'errors.api_error': 'API error: {message}',
  'errors.rate_limit': 'Rate limit exceeded. Retrying in {seconds}s...',
  'errors.auth_failed': 'Authentication failed. Check your API key.',
  'errors.timeout': 'Request timed out after {seconds}s.',
};

/**
 * French strings (complete since user speaks French).
 */
const fr: I18nStrings = {
  'common.yes': 'Oui',
  'common.no': 'Non',
  'common.cancel': 'Annuler',
  'common.confirm': 'Confirmer',
  'common.error': 'Erreur',
  'common.success': 'Succes',
  'common.loading': 'Chargement...',
  'cli.welcome': 'Bienvenue dans Code Buddy !',
  'cli.goodbye': 'Au revoir !',
  'cli.help': 'Tapez /help pour voir les commandes disponibles.',
  'tools.executing': 'Execution de {tool}...',
  'tools.completed': '{tool} termine avec succes.',
  'tools.failed': '{tool} echoue : {error}',
  'errors.api_error': 'Erreur API : {message}',
  'errors.rate_limit': 'Limite de debit depassee. Nouvel essai dans {seconds}s...',
  'errors.auth_failed': 'Authentification echouee. Verifiez votre cle API.',
  'errors.timeout': 'Delai d\'attente depasse apres {seconds}s.',
};

// Register en and fr
localeTables.en = en;
localeTables.fr = fr;

/**
 * Auto-detect locale from environment variables.
 * Priority: CODEBUDDY_LOCALE > LANG > LC_ALL > default 'en'
 */
function autoDetectLocale(): Locale {
  const envLocale =
    process.env.CODEBUDDY_LOCALE ||
    process.env.LANG ||
    process.env.LC_ALL ||
    '';

  const code = envLocale.toLowerCase().split(/[._-]/)[0];
  if (supportedLocales.includes(code as Locale)) {
    return code as Locale;
  }
  return 'en';
}

/**
 * Translate a key with optional parameter interpolation.
 *
 * Parameters use `{name}` syntax:
 *   t('tools.executing', { tool: 'grep' })  => "Executing grep..."
 */
export function t(key: keyof I18nStrings, params?: Record<string, string>): string {
  // Auto-detect on first use
  if (!autoDetected) {
    autoDetected = true;
    currentLocale = autoDetectLocale();
  }

  const table = localeTables[currentLocale] ?? localeTables.en;
  let value = table[key] ?? localeTables.en[key] ?? key;

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), paramValue);
    }
  }

  return value;
}

/**
 * Set the active locale.
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
  autoDetected = true; // Prevent auto-detection from overriding
}

/**
 * Get the current active locale.
 */
export function getLocale(): Locale {
  if (!autoDetected) {
    autoDetected = true;
    currentLocale = autoDetectLocale();
  }
  return currentLocale;
}

/**
 * Check if a locale is supported.
 */
export function isLocaleSupported(locale: string): locale is Locale {
  return supportedLocales.includes(locale as Locale);
}

/**
 * Get all supported locale codes.
 */
export function getSupportedLocales(): Locale[] {
  return [...supportedLocales];
}

/**
 * Reset the i18n system (for testing).
 */
export function resetI18n(): void {
  currentLocale = 'en';
  autoDetected = false;
}
