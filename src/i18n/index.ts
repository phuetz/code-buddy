/**
 * Internationalization (i18n) Module
 *
 * Lightweight i18n system for Code Buddy.
 * Supports multiple languages with fallback to English.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported locales
 */
export type Locale = 'en' | 'fr' | 'de' | 'es' | 'ja' | 'zh';

/**
 * Translation key categories
 */
export interface TranslationKeys {
  // Common
  common: {
    yes: string;
    no: string;
    cancel: string;
    confirm: string;
    error: string;
    warning: string;
    success: string;
    info: string;
    loading: string;
    processing: string;
    done: string;
    help: string;
    exit: string;
    back: string;
    next: string;
    save: string;
    delete: string;
    edit: string;
    create: string;
    search: string;
    filter: string;
    sort: string;
    refresh: string;
    settings: string;
    options: string;
  };

  // CLI Messages
  cli: {
    welcome: string;
    goodbye: string;
    inputPrompt: string;
    thinking: string;
    executing: string;
    toolUse: string;
    toolResult: string;
    noApiKey: string;
    invalidApiKey: string;
    rateLimited: string;
    networkError: string;
    timeout: string;
    sessionSaved: string;
    sessionLoaded: string;
    historyCleared: string;
    modelChanged: string;
    costWarning: string;
    costLimit: string;
  };

  // Tools
  tools: {
    readingFile: string;
    writingFile: string;
    creatingFile: string;
    deletingFile: string;
    executingCommand: string;
    searchingFiles: string;
    webSearching: string;
    fetchingUrl: string;
    analyzing: string;
    generating: string;
    fileNotFound: string;
    permissionDenied: string;
    commandFailed: string;
    confirmDelete: string;
    confirmOverwrite: string;
    confirmExecute: string;
  };

  // Errors
  errors: {
    unknown: string;
    notFound: string;
    invalidInput: string;
    unauthorized: string;
    forbidden: string;
    serverError: string;
    connectionFailed: string;
    parseError: string;
    validationFailed: string;
    operationCancelled: string;
    featureNotAvailable: string;
  };

  // Help
  help: {
    title: string;
    description: string;
    commands: string;
    examples: string;
    tips: string;
    moreInfo: string;
    version: string;
    usage: string;
  };
}

/**
 * Full translations object
 */
export type Translations = TranslationKeys;

// ============================================================================
// Default Translations (English)
// ============================================================================

const en: Translations = {
  common: {
    yes: 'Yes',
    no: 'No',
    cancel: 'Cancel',
    confirm: 'Confirm',
    error: 'Error',
    warning: 'Warning',
    success: 'Success',
    info: 'Info',
    loading: 'Loading...',
    processing: 'Processing...',
    done: 'Done',
    help: 'Help',
    exit: 'Exit',
    back: 'Back',
    next: 'Next',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    refresh: 'Refresh',
    settings: 'Settings',
    options: 'Options',
  },
  cli: {
    welcome: 'Welcome to Code Buddy! Type your request or /help for commands.',
    goodbye: 'Goodbye! Session saved.',
    inputPrompt: 'Ask me anything...',
    thinking: 'Thinking...',
    executing: 'Executing...',
    toolUse: 'Using tool: {tool}',
    toolResult: 'Tool result: {result}',
    noApiKey: 'No API key found. Set GROK_API_KEY environment variable.',
    invalidApiKey: 'Invalid API key. Please check your credentials.',
    rateLimited: 'Rate limit exceeded. Please wait before retrying.',
    networkError: 'Network error. Check your connection.',
    timeout: 'Request timed out. Please try again.',
    sessionSaved: 'Session saved successfully.',
    sessionLoaded: 'Session loaded: {name}',
    historyCleared: 'History cleared.',
    modelChanged: 'Model changed to: {model}',
    costWarning: 'Warning: Session cost ${cost} approaching limit.',
    costLimit: 'Cost limit reached (${cost}). Session paused.',
  },
  tools: {
    readingFile: 'Reading file: {path}',
    writingFile: 'Writing to file: {path}',
    creatingFile: 'Creating file: {path}',
    deletingFile: 'Deleting file: {path}',
    executingCommand: 'Executing: {command}',
    searchingFiles: 'Searching files: {pattern}',
    webSearching: 'Searching web: {query}',
    fetchingUrl: 'Fetching URL: {url}',
    analyzing: 'Analyzing...',
    generating: 'Generating...',
    fileNotFound: 'File not found: {path}',
    permissionDenied: 'Permission denied: {path}',
    commandFailed: 'Command failed: {error}',
    confirmDelete: 'Delete {path}? This cannot be undone.',
    confirmOverwrite: 'File exists. Overwrite {path}?',
    confirmExecute: 'Execute command: {command}?',
  },
  errors: {
    unknown: 'An unknown error occurred.',
    notFound: 'Resource not found.',
    invalidInput: 'Invalid input provided.',
    unauthorized: 'Authentication required.',
    forbidden: 'Access denied.',
    serverError: 'Server error. Please try again.',
    connectionFailed: 'Connection failed.',
    parseError: 'Failed to parse response.',
    validationFailed: 'Validation failed: {details}',
    operationCancelled: 'Operation cancelled.',
    featureNotAvailable: 'Feature not available in this version.',
  },
  help: {
    title: 'Code Buddy Help',
    description: 'AI-powered terminal assistant for coding tasks.',
    commands: 'Available commands:',
    examples: 'Examples:',
    tips: 'Tips:',
    moreInfo: 'For more information, visit: {url}',
    version: 'Version: {version}',
    usage: 'Usage: {usage}',
  },
};

// ============================================================================
// French Translations
// ============================================================================

const fr: Translations = {
  common: {
    yes: 'Oui',
    no: 'Non',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    error: 'Erreur',
    warning: 'Attention',
    success: 'Succès',
    info: 'Info',
    loading: 'Chargement...',
    processing: 'Traitement...',
    done: 'Terminé',
    help: 'Aide',
    exit: 'Quitter',
    back: 'Retour',
    next: 'Suivant',
    save: 'Enregistrer',
    delete: 'Supprimer',
    edit: 'Modifier',
    create: 'Créer',
    search: 'Rechercher',
    filter: 'Filtrer',
    sort: 'Trier',
    refresh: 'Actualiser',
    settings: 'Paramètres',
    options: 'Options',
  },
  cli: {
    welcome: 'Bienvenue sur Code Buddy ! Tapez votre requête ou /help pour les commandes.',
    goodbye: 'Au revoir ! Session sauvegardée.',
    inputPrompt: 'Posez-moi une question...',
    thinking: 'Réflexion...',
    executing: 'Exécution...',
    toolUse: "Utilisation de l'outil : {tool}",
    toolResult: "Résultat de l'outil : {result}",
    noApiKey: 'Clé API non trouvée. Définissez la variable GROK_API_KEY.',
    invalidApiKey: 'Clé API invalide. Vérifiez vos identifiants.',
    rateLimited: 'Limite de débit dépassée. Veuillez patienter.',
    networkError: 'Erreur réseau. Vérifiez votre connexion.',
    timeout: "Délai d'attente dépassé. Veuillez réessayer.",
    sessionSaved: 'Session enregistrée avec succès.',
    sessionLoaded: 'Session chargée : {name}',
    historyCleared: 'Historique effacé.',
    modelChanged: 'Modèle changé pour : {model}',
    costWarning: 'Attention : Coût de session {cost}$ proche de la limite.',
    costLimit: 'Limite de coût atteinte ({cost}$). Session en pause.',
  },
  tools: {
    readingFile: 'Lecture du fichier : {path}',
    writingFile: 'Écriture dans le fichier : {path}',
    creatingFile: 'Création du fichier : {path}',
    deletingFile: 'Suppression du fichier : {path}',
    executingCommand: 'Exécution : {command}',
    searchingFiles: 'Recherche de fichiers : {pattern}',
    webSearching: 'Recherche web : {query}',
    fetchingUrl: "Récupération de l'URL : {url}",
    analyzing: 'Analyse en cours...',
    generating: 'Génération en cours...',
    fileNotFound: 'Fichier non trouvé : {path}',
    permissionDenied: 'Permission refusée : {path}',
    commandFailed: 'Commande échouée : {error}',
    confirmDelete: 'Supprimer {path} ? Cette action est irréversible.',
    confirmOverwrite: 'Le fichier existe. Écraser {path} ?',
    confirmExecute: 'Exécuter la commande : {command} ?',
  },
  errors: {
    unknown: "Une erreur inconnue s'est produite.",
    notFound: 'Ressource non trouvée.',
    invalidInput: 'Entrée invalide.',
    unauthorized: 'Authentification requise.',
    forbidden: 'Accès refusé.',
    serverError: 'Erreur serveur. Veuillez réessayer.',
    connectionFailed: 'Échec de la connexion.',
    parseError: "Échec de l'analyse de la réponse.",
    validationFailed: 'Validation échouée : {details}',
    operationCancelled: 'Opération annulée.',
    featureNotAvailable: 'Fonctionnalité non disponible dans cette version.',
  },
  help: {
    title: 'Aide Code Buddy',
    description: 'Assistant terminal alimenté par IA pour les tâches de codage.',
    commands: 'Commandes disponibles :',
    examples: 'Exemples :',
    tips: 'Conseils :',
    moreInfo: "Pour plus d'informations, visitez : {url}",
    version: 'Version : {version}',
    usage: 'Utilisation : {usage}',
  },
};

// ============================================================================
// Translation Registry
// ============================================================================

const translations: Record<Locale, Translations> = {
  en,
  fr,
  de: en, // Fallback to English (TODO: add German)
  es: en, // Fallback to English (TODO: add Spanish)
  ja: en, // Fallback to English (TODO: add Japanese)
  zh: en, // Fallback to English (TODO: add Chinese)
};

// ============================================================================
// I18n Manager
// ============================================================================

/**
 * Internationalization manager
 */
class I18nManager extends EventEmitter {
  private currentLocale: Locale = 'en';
  private fallbackLocale: Locale = 'en';

  constructor() {
    super();
    this.detectLocale();
  }

  /**
   * Detect locale from environment
   */
  private detectLocale(): void {
    const envLocale = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '';
    const localeCode = envLocale.split('.')[0].split('_')[0].toLowerCase() as Locale;

    if (localeCode && translations[localeCode]) {
      this.currentLocale = localeCode;
    }
  }

  /**
   * Get current locale
   */
  getLocale(): Locale {
    return this.currentLocale;
  }

  /**
   * Set locale
   */
  setLocale(locale: Locale): void {
    if (translations[locale]) {
      this.currentLocale = locale;
      this.emit('localeChanged', locale);
    }
  }

  /**
   * Get available locales
   */
  getAvailableLocales(): Locale[] {
    return Object.keys(translations) as Locale[];
  }

  /**
   * Get translation for a key path
   * @param keyPath - Dot-separated key path (e.g., 'cli.welcome')
   * @param params - Optional parameters for interpolation
   */
  t(keyPath: string, params?: Record<string, string | number>): string {
    const keys = keyPath.split('.');
    let value: unknown = translations[this.currentLocale];

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        // Try fallback locale
        value = translations[this.fallbackLocale];
        for (const k of keys) {
          if (value && typeof value === 'object' && k in value) {
            value = (value as Record<string, unknown>)[k];
          } else {
            return keyPath; // Return key if not found
          }
        }
        break;
      }
    }

    if (typeof value !== 'string') {
      return keyPath;
    }

    // Interpolate parameters
    if (params) {
      return value.replace(/\{(\w+)\}/g, (_, key) => {
        return params[key]?.toString() ?? '{' + key + '}';
      });
    }

    return value;
  }

  /**
   * Get all translations for a category
   */
  getCategory<K extends keyof Translations>(category: K): Translations[K] {
    return translations[this.currentLocale][category];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let i18nInstance: I18nManager | null = null;

/**
 * Get or create I18n manager singleton
 */
export function getI18n(): I18nManager {
  if (!i18nInstance) {
    i18nInstance = new I18nManager();
  }
  return i18nInstance;
}

/**
 * Shorthand for translation
 */
export function t(keyPath: string, params?: Record<string, string | number>): string {
  return getI18n().t(keyPath, params);
}

/**
 * Reset I18n manager (for testing)
 */
export function resetI18n(): void {
  i18nInstance = null;
}

// Export translations for extension
export { en, fr, translations };
export default I18nManager;
