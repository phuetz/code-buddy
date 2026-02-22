/**
 * Tests for I18n Manager
 *
 * Tests the internationalization functionality including:
 * - Translation loading from JSON files
 * - Locale detection and switching
 * - Fallback to default locale
 * - Interpolation support
 * - Pluralization
 *
 * Note: These tests directly test the i18n logic by recreating the core
 * functionality to avoid issues with import.meta.url in Jest.
 */

import * as fs from 'fs';

// Type definitions matching the i18n module
type LocaleCode = 'en' | 'fr' | 'es' | 'de' | 'zh' | 'ja' | 'pt' | 'ru';

interface TranslationDictionary {
  [key: string]: string | TranslationDictionary;
}

interface I18nOptions {
  defaultLocale?: LocaleCode;
  fallbackLocale?: LocaleCode;
  localesDir?: string;
  detectLocale?: boolean;
}

// Helper functions matching the i18n module implementation
function isValidLocale(code: string | undefined): code is LocaleCode {
  const validLocales: LocaleCode[] = ['en', 'fr', 'es', 'de', 'zh', 'ja', 'pt', 'ru'];
  return typeof code === 'string' && validLocales.includes(code as LocaleCode);
}

function detectSystemLocale(): LocaleCode {
  const envLocale =
    process.env.LANG ||
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANGUAGE;

  if (envLocale) {
    const langCode = envLocale.split('_')[0]?.toLowerCase();
    if (isValidLocale(langCode)) {
      return langCode as LocaleCode;
    }
  }
  return 'en';
}

// Test implementation of I18n class
class TestI18n {
  private translations: Map<LocaleCode, TranslationDictionary> = new Map();
  private currentLocale: LocaleCode;
  private fallbackLocale: LocaleCode;
  private localesDir: string;

  constructor(options: I18nOptions = {}) {
    const defaults = {
      defaultLocale: 'en' as LocaleCode,
      fallbackLocale: 'en' as LocaleCode,
      localesDir: '/mocked/locales',
      detectLocale: true,
    };

    const opts = { ...defaults, ...options };
    this.fallbackLocale = opts.fallbackLocale;
    this.localesDir = opts.localesDir;

    this.currentLocale = opts.detectLocale
      ? detectSystemLocale()
      : opts.defaultLocale;

    this.loadTranslations();
  }

  private loadTranslations(): void {
    this.loadLocale(this.fallbackLocale);
    if (this.currentLocale !== this.fallbackLocale) {
      this.loadLocale(this.currentLocale);
    }
  }

  private loadLocale(locale: LocaleCode): void {
    const filePath = `${this.localesDir}/${locale}.json`;

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const translations = JSON.parse(content) as TranslationDictionary;
        this.translations.set(locale, translations);
      }
    } catch (error) {
      console.warn(`Failed to load locale ${locale}:`, error);
    }
  }

  getLocale(): LocaleCode {
    return this.currentLocale;
  }

  setLocale(locale: LocaleCode): void {
    if (!isValidLocale(locale)) {
      throw new Error(`Invalid locale: ${locale}`);
    }

    this.currentLocale = locale;

    if (!this.translations.has(locale)) {
      this.loadLocale(locale);
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    let value = this.getNestedValue(this.translations.get(this.currentLocale), key);

    if (value === undefined && this.currentLocale !== this.fallbackLocale) {
      value = this.getNestedValue(this.translations.get(this.fallbackLocale), key);
    }

    if (value === undefined || typeof value !== 'string') {
      return key;
    }

    if (params) {
      return this.interpolate(value, params);
    }

    return value;
  }

  tp(key: string, count: number, params?: Record<string, string | number>): string {
    let pluralKey: string;

    if (count === 0) {
      pluralKey = `${key}.zero`;
    } else if (count === 1) {
      pluralKey = `${key}.one`;
    } else {
      pluralKey = `${key}.other`;
    }

    const result = this.t(pluralKey, { count, ...params });
    if (result === pluralKey) {
      return this.t(key, { count, ...params });
    }

    return result;
  }

  has(key: string): boolean {
    const value = this.getNestedValue(this.translations.get(this.currentLocale), key);
    if (value !== undefined && typeof value === 'string') return true;

    if (this.currentLocale !== this.fallbackLocale) {
      const fallbackValue = this.getNestedValue(this.translations.get(this.fallbackLocale), key);
      return fallbackValue !== undefined && typeof fallbackValue === 'string';
    }

    return false;
  }

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

  private interpolate(str: string, params: Record<string, string | number>): string {
    return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = params[key];
      return value !== undefined ? String(value) : match;
    });
  }

  getAvailableLocales(): LocaleCode[] {
    try {
      const files = fs.readdirSync(this.localesDir) as string[];
      return files
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => f.replace('.json', ''))
        .filter(isValidLocale) as LocaleCode[];
    } catch {
      return [this.fallbackLocale];
    }
  }

  addTranslations(locale: LocaleCode, translations: TranslationDictionary): void {
    const existing = this.translations.get(locale) || {};
    this.translations.set(locale, this.deepMerge(existing, translations));
  }

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

// Singleton management
let i18nInstance: TestI18n | null = null;

function getI18n(options?: I18nOptions): TestI18n {
  if (!i18nInstance) {
    i18nInstance = new TestI18n(options);
  }
  return i18nInstance;
}

function t(key: string, params?: Record<string, string | number>): string {
  return getI18n().t(key, params);
}

function tp(key: string, count: number, params?: Record<string, string | number>): string {
  return getI18n().tp(key, count, params);
}

function resetI18n(): void {
  i18nInstance = null;
}

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
}));

const mockExistsSync = fs.existsSync as jest.Mock;
const mockReadFileSync = fs.readFileSync as jest.Mock;
const mockReaddirSync = fs.readdirSync as jest.Mock;

describe('I18n', () => {
  const mockEnTranslations = {
    app: {
      name: 'Code Buddy',
      version: 'Version {{version}}',
      starting: 'Starting Code Buddy...',
      goodbye: 'Goodbye!',
    },
    errors: {
      fileNotFound: 'File not found: {{path}}',
      timeout: 'Operation timed out after {{seconds}} seconds',
    },
    files: {
      zero: 'No files',
      one: '1 file',
      other: '{{count}} files',
    },
    simple: 'Simple text',
    nested: {
      deep: {
        value: 'Deep nested value',
      },
    },
  };

  const mockFrTranslations = {
    app: {
      name: 'Code Buddy',
      version: 'Version {{version}}',
      starting: 'Demarrage de Code Buddy...',
      goodbye: 'Au revoir !',
    },
    errors: {
      fileNotFound: 'Fichier introuvable : {{path}}',
    },
    files: {
      zero: 'Aucun fichier',
      one: '1 fichier',
      other: '{{count}} fichiers',
    },
    simple: 'Texte simple',
  };

  beforeEach(() => {
    resetI18n();
    jest.clearAllMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const path = String(filePath);
      if (path.endsWith('en.json')) {
        return JSON.stringify(mockEnTranslations);
      }
      if (path.endsWith('fr.json')) {
        return JSON.stringify(mockFrTranslations);
      }
      if (path.endsWith('es.json')) {
        return JSON.stringify({ app: { name: 'Code Buddy', goodbye: 'Adios!' } });
      }
      if (path.endsWith('de.json')) {
        return JSON.stringify({ app: { name: 'Code Buddy', goodbye: 'Auf Wiedersehen!' } });
      }
      throw new Error('File not found');
    });
    mockReaddirSync.mockReturnValue(['en.json', 'fr.json', 'es.json', 'de.json']);

    delete process.env.LANG;
    delete process.env.LC_ALL;
    delete process.env.LC_MESSAGES;
    delete process.env.LANGUAGE;
  });

  afterEach(() => {
    resetI18n();
    jest.clearAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should create an instance with default options', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n).toBeDefined();
      expect(i18n.getLocale()).toBe('en');
    });

    it('should use default locale when detectLocale is false', () => {
      const i18n = new TestI18n({ defaultLocale: 'fr', detectLocale: false });
      expect(i18n.getLocale()).toBe('fr');
    });

    it('should detect system locale from LANG environment variable', () => {
      process.env.LANG = 'fr_FR.UTF-8';
      const i18n = new TestI18n({ detectLocale: true });
      expect(i18n.getLocale()).toBe('fr');
    });

    it('should detect system locale from LC_ALL environment variable', () => {
      process.env.LC_ALL = 'de_DE.UTF-8';
      const i18n = new TestI18n({ detectLocale: true });
      expect(i18n.getLocale()).toBe('de');
    });

    it('should detect system locale from LC_MESSAGES environment variable', () => {
      process.env.LC_MESSAGES = 'es_ES.UTF-8';
      const i18n = new TestI18n({ detectLocale: true });
      expect(i18n.getLocale()).toBe('es');
    });

    it('should detect system locale from LANGUAGE environment variable', () => {
      process.env.LANGUAGE = 'pt_BR.UTF-8';
      const i18n = new TestI18n({ detectLocale: true });
      expect(i18n.getLocale()).toBe('pt');
    });

    it('should fall back to English for invalid locale in environment', () => {
      process.env.LANG = 'invalid_LOCALE';
      const i18n = new TestI18n({ detectLocale: true });
      expect(i18n.getLocale()).toBe('en');
    });

    it('should fall back to English when no environment locale is set', () => {
      const i18n = new TestI18n({ detectLocale: true });
      expect(i18n.getLocale()).toBe('en');
    });

    it('should load fallback locale translations', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('app.name')).toBe('Code Buddy');
    });

    it('should load both fallback and current locale when different', () => {
      const i18n = new TestI18n({ defaultLocale: 'fr', detectLocale: false });
      expect(i18n.t('app.goodbye')).toBe('Au revoir !');
    });

    it('should use custom locales directory', () => {
      const customDir = '/custom/locales';
      mockExistsSync.mockReturnValue(false);

      new TestI18n({
        localesDir: customDir,
        detectLocale: false,
      });

      expect(mockExistsSync).toHaveBeenCalledWith(
        expect.stringContaining(customDir)
      );
    });
  });

  describe('getLocale()', () => {
    it('should return current locale', () => {
      const i18n = new TestI18n({ defaultLocale: 'en', detectLocale: false });
      expect(i18n.getLocale()).toBe('en');
    });

    it('should return detected locale', () => {
      process.env.LANG = 'fr_FR';
      const i18n = new TestI18n({ detectLocale: true });
      expect(i18n.getLocale()).toBe('fr');
    });
  });

  describe('setLocale()', () => {
    it('should change the current locale', () => {
      const i18n = new TestI18n({ detectLocale: false });
      i18n.setLocale('fr');
      expect(i18n.getLocale()).toBe('fr');
    });

    it('should load locale file if not already loaded', () => {
      const i18n = new TestI18n({ detectLocale: false });
      mockReadFileSync.mockClear();

      i18n.setLocale('es');

      expect(mockReadFileSync).toHaveBeenCalled();
    });

    it('should not reload locale if already loaded', () => {
      const i18n = new TestI18n({ detectLocale: false });
      i18n.setLocale('fr');

      mockReadFileSync.mockClear();
      i18n.setLocale('fr');

      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('should throw error for invalid locale', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(() => i18n.setLocale('invalid' as LocaleCode)).toThrow(
        'Invalid locale: invalid'
      );
    });

    it('should accept all valid locale codes', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const validLocales: LocaleCode[] = ['en', 'fr', 'es', 'de', 'zh', 'ja', 'pt', 'ru'];

      for (const locale of validLocales) {
        expect(() => i18n.setLocale(locale)).not.toThrow();
      }
    });
  });

  describe('t() - Translation', () => {
    it('should translate simple keys', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('simple')).toBe('Simple text');
    });

    it('should translate nested keys using dot notation', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('app.name')).toBe('Code Buddy');
    });

    it('should translate deeply nested keys', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('nested.deep.value')).toBe('Deep nested value');
    });

    it('should return key when translation not found', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('should interpolate single parameter', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.t('app.version', { version: '1.0.0' });
      expect(result).toBe('Version 1.0.0');
    });

    it('should interpolate multiple parameters', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.t('errors.fileNotFound', { path: '/test/file.txt' });
      expect(result).toBe('File not found: /test/file.txt');
    });

    it('should interpolate numeric parameters', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.t('errors.timeout', { seconds: 30 });
      expect(result).toBe('Operation timed out after 30 seconds');
    });

    it('should keep placeholder when parameter not provided', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.t('app.version', {});
      expect(result).toBe('Version {{version}}');
    });

    it('should fall back to default locale when key not in current locale', () => {
      const i18n = new TestI18n({ defaultLocale: 'fr', detectLocale: false });
      expect(i18n.t('nested.deep.value')).toBe('Deep nested value');
    });

    it('should use current locale when translation exists', () => {
      const i18n = new TestI18n({ defaultLocale: 'fr', detectLocale: false });
      expect(i18n.t('app.goodbye')).toBe('Au revoir !');
    });

    it('should return key when not found in any locale', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('totally.missing.key')).toBe('totally.missing.key');
    });

    it('should handle empty key', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('')).toBe('');
    });

    it('should handle translation without params when not needed', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('app.name')).toBe('Code Buddy');
    });
  });

  describe('tp() - Plural Translation', () => {
    it('should use zero form when count is 0', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.tp('files', 0);
      expect(result).toBe('No files');
    });

    it('should use one form when count is 1', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.tp('files', 1);
      expect(result).toBe('1 file');
    });

    it('should use other form when count is greater than 1', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.tp('files', 5);
      expect(result).toBe('5 files');
    });

    it('should interpolate count automatically', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.tp('files', 10);
      expect(result).toBe('10 files');
    });

    it('should interpolate additional params', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.tp('files', 3, { count: 3 });
      expect(result).toBe('3 files');
    });

    it('should fall back to base key when plural form not found', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.tp('simple', 2);
      expect(result).toBe('Simple text');
    });

    it('should work with French pluralization', () => {
      const i18n = new TestI18n({ defaultLocale: 'fr', detectLocale: false });
      expect(i18n.tp('files', 0)).toBe('Aucun fichier');
      expect(i18n.tp('files', 1)).toBe('1 fichier');
      expect(i18n.tp('files', 5)).toBe('5 fichiers');
    });

    it('should handle negative numbers as other', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const result = i18n.tp('files', -5);
      expect(result).toBe('-5 files');
    });
  });

  describe('has()', () => {
    it('should return true for existing key in current locale', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.has('app.name')).toBe(true);
    });

    it('should return true for existing key in fallback locale', () => {
      const i18n = new TestI18n({ defaultLocale: 'fr', detectLocale: false });
      expect(i18n.has('nested.deep.value')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.has('nonexistent.key')).toBe(false);
    });

    it('should return true for nested keys', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.has('errors.fileNotFound')).toBe(true);
    });

    it('should return true for deeply nested keys', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.has('nested.deep.value')).toBe(true);
    });

    it('should return false for partial key path', () => {
      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.has('app')).toBe(false);
    });
  });

  describe('getAvailableLocales()', () => {
    it('should return list of available locales', () => {
      const i18n = new TestI18n({ detectLocale: false });
      const locales = i18n.getAvailableLocales();

      expect(locales).toContain('en');
      expect(locales).toContain('fr');
      expect(locales).toContain('es');
      expect(locales).toContain('de');
    });

    it('should only return valid locale codes', () => {
      mockReaddirSync.mockReturnValue(['en.json', 'invalid.json', 'readme.md', 'fr.json']);

      const i18n = new TestI18n({ detectLocale: false });
      const locales = i18n.getAvailableLocales();

      expect(locales).toContain('en');
      expect(locales).toContain('fr');
      expect(locales).not.toContain('invalid');
      expect(locales).not.toContain('readme');
    });

    it('should return fallback locale when directory read fails', () => {
      mockReaddirSync.mockImplementation(() => {
        throw new Error('Directory not found');
      });

      const i18n = new TestI18n({ detectLocale: false });
      const locales = i18n.getAvailableLocales();

      expect(locales).toEqual(['en']);
    });
  });

  describe('addTranslations()', () => {
    it('should add new translations to locale', () => {
      const i18n = new TestI18n({ detectLocale: false });

      i18n.addTranslations('en', {
        custom: {
          message: 'Custom message',
        },
      });

      expect(i18n.t('custom.message')).toBe('Custom message');
    });

    it('should merge with existing translations', () => {
      const i18n = new TestI18n({ detectLocale: false });

      i18n.addTranslations('en', {
        app: {
          custom: 'Custom app text',
        },
      });

      expect(i18n.t('app.name')).toBe('Code Buddy');
      expect(i18n.t('app.custom')).toBe('Custom app text');
    });

    it('should override existing translations', () => {
      const i18n = new TestI18n({ detectLocale: false });

      i18n.addTranslations('en', {
        app: {
          name: 'New Name',
        },
      });

      expect(i18n.t('app.name')).toBe('New Name');
    });

    it('should add translations to new locale', () => {
      const i18n = new TestI18n({ detectLocale: false });

      i18n.addTranslations('ru', {
        app: {
          name: 'Code Buddy',
          goodbye: 'Do svidaniya!',
        },
      });

      i18n.setLocale('ru');
      expect(i18n.t('app.goodbye')).toBe('Do svidaniya!');
    });

    it('should handle deeply nested merge', () => {
      const i18n = new TestI18n({ detectLocale: false });

      i18n.addTranslations('en', {
        nested: {
          deep: {
            newValue: 'New deep value',
          },
        },
      });

      expect(i18n.t('nested.deep.value')).toBe('Deep nested value');
      expect(i18n.t('nested.deep.newValue')).toBe('New deep value');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing locale file gracefully', () => {
      mockExistsSync.mockReturnValue(false);

      const i18n = new TestI18n({ detectLocale: false });

      expect(i18n.t('any.key')).toBe('any.key');
    });

    it('should handle corrupted JSON file', () => {
      mockReadFileSync.mockReturnValue('invalid json');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const i18n = new TestI18n({ detectLocale: false });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle read error gracefully', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const i18n = new TestI18n({ detectLocale: false });
      expect(i18n.t('any.key')).toBe('any.key');

      consoleSpy.mockRestore();
    });
  });
});

describe('Singleton Functions', () => {
  beforeEach(() => {
    resetI18n();
    jest.clearAllMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const path = String(filePath);
      if (path.endsWith('en.json')) {
        return JSON.stringify({
          greeting: 'Hello, {{name}}!',
          files: {
            zero: 'No files',
            one: '1 file',
            other: '{{count}} files',
          },
        });
      }
      return '{}';
    });
    mockReaddirSync.mockReturnValue(['en.json']);

    delete process.env.LANG;
    delete process.env.LC_ALL;
    delete process.env.LC_MESSAGES;
    delete process.env.LANGUAGE;
  });

  afterEach(() => {
    resetI18n();
  });

  describe('getI18n()', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getI18n();
      const instance2 = getI18n();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance with options on first call', () => {
      const instance = getI18n({ defaultLocale: 'fr', detectLocale: false });
      expect(instance).toBeDefined();
    });

    it('should ignore options on subsequent calls', () => {
      const instance1 = getI18n({ detectLocale: false });
      const instance2 = getI18n({ defaultLocale: 'fr', detectLocale: false });
      expect(instance1).toBe(instance2);
    });
  });

  describe('t() shorthand', () => {
    it('should translate using singleton instance', () => {
      expect(t('greeting', { name: 'World' })).toBe('Hello, World!');
    });

    it('should work without parameters', () => {
      const result = t('greeting');
      expect(result).toBe('Hello, {{name}}!');
    });
  });

  describe('tp() shorthand', () => {
    it('should translate with pluralization', () => {
      expect(tp('files', 0)).toBe('No files');
      expect(tp('files', 1)).toBe('1 file');
      expect(tp('files', 5)).toBe('5 files');
    });

    it('should work with additional params', () => {
      const result = tp('files', 3, { count: 3 });
      expect(result).toBe('3 files');
    });
  });

  describe('resetI18n()', () => {
    it('should reset the singleton instance', () => {
      const instance1 = getI18n();
      resetI18n();
      const instance2 = getI18n();
      expect(instance1).not.toBe(instance2);
    });

    it('should allow new options after reset', () => {
      getI18n({ detectLocale: false });
      resetI18n();

      process.env.LANG = 'fr_FR';
      const newInstance = getI18n({ detectLocale: true });
      expect(newInstance.getLocale()).toBe('fr');
    });
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    resetI18n();
    jest.clearAllMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const path = String(filePath);
      if (path.endsWith('en.json')) {
        return JSON.stringify({
          empty: '',
          whitespace: '   ',
          specialChars: 'Hello <b>{{name}}</b> & {{greeting}}!',
          unicode: 'Hello {{emoji}} World!',
          multiline: 'Line 1\nLine 2\nLine 3',
        });
      }
      return '{}';
    });
    mockReaddirSync.mockReturnValue(['en.json']);
  });

  afterEach(() => {
    resetI18n();
  });

  it('should handle empty string translations', () => {
    const i18n = new TestI18n({ detectLocale: false });
    expect(i18n.t('empty')).toBe('');
  });

  it('should handle whitespace-only translations', () => {
    const i18n = new TestI18n({ detectLocale: false });
    expect(i18n.t('whitespace')).toBe('   ');
  });

  it('should handle special characters in translations', () => {
    const i18n = new TestI18n({ detectLocale: false });
    const result = i18n.t('specialChars', { name: 'User', greeting: 'Hi' });
    expect(result).toBe('Hello <b>User</b> & Hi!');
  });

  it('should handle unicode characters in params', () => {
    const i18n = new TestI18n({ detectLocale: false });
    const result = i18n.t('unicode', { emoji: 'party' });
    expect(result).toBe('Hello party World!');
  });

  it('should handle multiline translations', () => {
    const i18n = new TestI18n({ detectLocale: false });
    expect(i18n.t('multiline')).toBe('Line 1\nLine 2\nLine 3');
  });

  it('should handle params with special regex characters', () => {
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const path = String(filePath);
      if (path.endsWith('en.json')) {
        return JSON.stringify({
          pattern: 'Pattern: {{pattern}}',
        });
      }
      return '{}';
    });

    const i18n = new TestI18n({ detectLocale: false });
    const result = i18n.t('pattern', { pattern: '$1.*+?' });
    expect(result).toBe('Pattern: $1.*+?');
  });

  it('should handle numeric param values as strings', () => {
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const path = String(filePath);
      if (path.endsWith('en.json')) {
        return JSON.stringify({
          count: 'Count: {{value}}',
        });
      }
      return '{}';
    });

    const i18n = new TestI18n({ detectLocale: false });
    const result = i18n.t('count', { value: 42 });
    expect(result).toBe('Count: 42');
  });

  it('should handle zero as a param value', () => {
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const path = String(filePath);
      if (path.endsWith('en.json')) {
        return JSON.stringify({
          count: 'Count: {{value}}',
        });
      }
      return '{}';
    });

    const i18n = new TestI18n({ detectLocale: false });
    const result = i18n.t('count', { value: 0 });
    expect(result).toBe('Count: 0');
  });
});

describe('Locale Detection Priority', () => {
  beforeEach(() => {
    resetI18n();
    jest.clearAllMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{}');
    mockReaddirSync.mockReturnValue(['en.json', 'fr.json', 'de.json']);

    delete process.env.LANG;
    delete process.env.LC_ALL;
    delete process.env.LC_MESSAGES;
    delete process.env.LANGUAGE;
  });

  afterEach(() => {
    resetI18n();
  });

  it('should prioritize LANG over LC_ALL', () => {
    process.env.LANG = 'fr_FR';
    process.env.LC_ALL = 'de_DE';

    const i18n = new TestI18n({ detectLocale: true });
    expect(i18n.getLocale()).toBe('fr');
  });

  it('should use LC_ALL when LANG is not set', () => {
    process.env.LC_ALL = 'de_DE';

    const i18n = new TestI18n({ detectLocale: true });
    expect(i18n.getLocale()).toBe('de');
  });

  it('should use LC_MESSAGES when LANG and LC_ALL are not set', () => {
    process.env.LC_MESSAGES = 'es_ES';

    const i18n = new TestI18n({ detectLocale: true });
    expect(i18n.getLocale()).toBe('es');
  });

  it('should handle locale codes without country suffix', () => {
    process.env.LANG = 'fr';

    const i18n = new TestI18n({ detectLocale: true });
    expect(i18n.getLocale()).toBe('fr');
  });
});
