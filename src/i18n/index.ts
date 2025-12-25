/**
 * Internationalization (i18n) support for Code Buddy
 *
 * Provides:
 * - Translation loading from JSON files
 * - Locale detection from system
 * - Fallback to English
 * - Interpolation support
 * - Pluralization
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type LocaleCode = 'en' | 'fr' | 'es' | 'de' | 'zh' | 'ja' | 'pt' | 'ru';

export interface TranslationDictionary {
  [key: string]: string | TranslationDictionary;
}

export interface I18nOptions {
  defaultLocale?: LocaleCode;
  fallbackLocale?: LocaleCode;
  localesDir?: string;
  detectLocale?: boolean;
}

const DEFAULT_OPTIONS: Required<I18nOptions> = {
  defaultLocale: 'en',
  fallbackLocale: 'en',
  localesDir: path.join(__dirname, 'locales'),
  detectLocale: true,
};

/**
 * Detect system locale
 */
function detectSystemLocale(): LocaleCode {
  // Check environment variables
  const envLocale =
    process.env.LANG ||
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANGUAGE;

  if (envLocale) {
    // Extract language code (e.g., "en_US.UTF-8" -> "en")
    const langCode = envLocale.split('_')[0]?.toLowerCase();
    if (isValidLocale(langCode)) {
      return langCode as LocaleCode;
    }
  }

  return 'en';
}

/**
 * Check if locale code is valid
 */
function isValidLocale(code: string | undefined): code is LocaleCode {
  const validLocales: LocaleCode[] = ['en', 'fr', 'es', 'de', 'zh', 'ja', 'pt', 'ru'];
  return typeof code === 'string' && validLocales.includes(code as LocaleCode);
}

/**
 * I18n class for managing translations
 */
export class I18n {
  private translations: Map<LocaleCode, TranslationDictionary> = new Map();
  private currentLocale: LocaleCode;
  private fallbackLocale: LocaleCode;
  private localesDir: string;

  constructor(options: I18nOptions = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    this.fallbackLocale = opts.fallbackLocale;
    this.localesDir = opts.localesDir;

    // Detect or use default locale
    this.currentLocale = opts.detectLocale
      ? detectSystemLocale()
      : opts.defaultLocale;

    // Load translations
    this.loadTranslations();
  }

  /**
   * Load all translation files
   */
  private loadTranslations(): void {
    // Always load fallback locale
    this.loadLocale(this.fallbackLocale);

    // Load current locale if different
    if (this.currentLocale !== this.fallbackLocale) {
      this.loadLocale(this.currentLocale);
    }
  }

  /**
   * Load a specific locale file
   */
  private loadLocale(locale: LocaleCode): void {
    const filePath = path.join(this.localesDir, `${locale}.json`);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const translations = JSON.parse(content) as TranslationDictionary;
        this.translations.set(locale, translations);
      }
    } catch (error) {
      // Silently ignore loading errors
      console.warn(`Failed to load locale ${locale}:`, error);
    }
  }

  /**
   * Get current locale
   */
  getLocale(): LocaleCode {
    return this.currentLocale;
  }

  /**
   * Set current locale
   */
  setLocale(locale: LocaleCode): void {
    if (!isValidLocale(locale)) {
      throw new Error(`Invalid locale: ${locale}`);
    }

    this.currentLocale = locale;

    // Load if not already loaded
    if (!this.translations.has(locale)) {
      this.loadLocale(locale);
    }
  }

  /**
   * Translate a key with optional interpolation
   *
   * @param key - Dot-notation key (e.g., "errors.fileNotFound")
   * @param params - Interpolation parameters
   * @returns Translated string
   *
   * @example
   * ```typescript
   * i18n.t('greeting', { name: 'John' }); // "Hello, John!"
   * i18n.t('errors.fileNotFound', { path: '/foo' }); // "File not found: /foo"
   * ```
   */
  t(key: string, params?: Record<string, string | number>): string {
    // Try current locale first
    let value = this.getNestedValue(this.translations.get(this.currentLocale), key);

    // Fallback to default locale
    if (value === undefined && this.currentLocale !== this.fallbackLocale) {
      value = this.getNestedValue(this.translations.get(this.fallbackLocale), key);
    }

    // Return key if not found
    if (value === undefined || typeof value !== 'string') {
      return key;
    }

    // Interpolate parameters
    if (params) {
      return this.interpolate(value, params);
    }

    return value;
  }

  /**
   * Translate with pluralization
   *
   * @param key - Base key (expects key.zero, key.one, key.other)
   * @param count - Number for pluralization
   * @param params - Additional interpolation parameters
   */
  tp(key: string, count: number, params?: Record<string, string | number>): string {
    let pluralKey: string;

    if (count === 0) {
      pluralKey = `${key}.zero`;
    } else if (count === 1) {
      pluralKey = `${key}.one`;
    } else {
      pluralKey = `${key}.other`;
    }

    // Try specific plural form, fallback to base key
    const result = this.t(pluralKey, { count, ...params });
    if (result === pluralKey) {
      return this.t(key, { count, ...params });
    }

    return result;
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    const value = this.getNestedValue(this.translations.get(this.currentLocale), key);
    if (value !== undefined) return true;

    if (this.currentLocale !== this.fallbackLocale) {
      return (
        this.getNestedValue(this.translations.get(this.fallbackLocale), key) !== undefined
      );
    }

    return false;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(
    obj: TranslationDictionary | undefined,
    key: string
  ): string | TranslationDictionary | undefined {
    if (!obj) return undefined;

    const keys = key.split('.');
    let current: string | TranslationDictionary | undefined = obj;

    for (const k of keys) {
      if (current === undefined || typeof current === 'string') {
        return undefined;
      }
      current = current[k];
    }

    return current;
  }

  /**
   * Interpolate parameters into string
   */
  private interpolate(str: string, params: Record<string, string | number>): string {
    return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = params[key];
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Get all available locales
   */
  getAvailableLocales(): LocaleCode[] {
    try {
      const files = fs.readdirSync(this.localesDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
        .filter(isValidLocale) as LocaleCode[];
    } catch {
      return [this.fallbackLocale];
    }
  }

  /**
   * Add or update translations programmatically
   */
  addTranslations(locale: LocaleCode, translations: TranslationDictionary): void {
    const existing = this.translations.get(locale) || {};
    this.translations.set(locale, this.deepMerge(existing, translations));
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(
    target: TranslationDictionary,
    source: TranslationDictionary
  ): TranslationDictionary {
    const result = { ...target };

    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.deepMerge(
          (result[key] as TranslationDictionary) || {},
          value as TranslationDictionary
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}

// Singleton instance
let i18nInstance: I18n | null = null;

/**
 * Get or create the i18n instance
 */
export function getI18n(options?: I18nOptions): I18n {
  if (!i18nInstance) {
    i18nInstance = new I18n(options);
  }
  return i18nInstance;
}

/**
 * Shorthand translation function
 */
export function t(key: string, params?: Record<string, string | number>): string {
  return getI18n().t(key, params);
}

/**
 * Shorthand plural translation function
 */
export function tp(
  key: string,
  count: number,
  params?: Record<string, string | number>
): string {
  return getI18n().tp(key, count, params);
}

/**
 * Reset the i18n instance (for testing)
 */
export function resetI18n(): void {
  i18nInstance = null;
}
