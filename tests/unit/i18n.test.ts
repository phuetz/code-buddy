/**
 * Unit tests for i18n System
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  t,
  setLocale,
  getLocale,
  isLocaleSupported,
  getSupportedLocales,
  resetI18n,
} from '../../src/i18n/index';

describe('i18n System', () => {
  beforeEach(() => {
    resetI18n();
  });

  afterEach(() => {
    resetI18n();
    // Clean up env vars
    delete process.env.CODEBUDDY_LOCALE;
    delete process.env.LANG;
    delete process.env.LC_ALL;
  });

  it('should return English strings by default', () => {
    setLocale('en');
    expect(t('common.yes')).toBe('Yes');
    expect(t('common.no')).toBe('No');
    expect(t('cli.welcome')).toBe('Welcome to Code Buddy!');
  });

  it('should return French strings when locale is fr', () => {
    setLocale('fr');
    expect(t('common.yes')).toBe('Oui');
    expect(t('common.no')).toBe('Non');
    expect(t('cli.welcome')).toContain('Bienvenue');
  });

  it('should interpolate parameters', () => {
    setLocale('en');
    const result = t('tools.executing', { tool: 'grep' });
    expect(result).toBe('Executing grep...');
  });

  it('should interpolate multiple parameters', () => {
    setLocale('en');
    const result = t('tools.failed', { tool: 'bash', error: 'timeout' });
    expect(result).toBe('bash failed: timeout');
  });

  it('should fall back to English for untranslated env locales', () => {
    process.env.CODEBUDDY_LOCALE = 'de';
    resetI18n();
    expect(getLocale()).toBe('en');
    expect(t('common.yes')).toBe('Yes');
  });

  it('should auto-detect locale from CODEBUDDY_LOCALE env', () => {
    process.env.CODEBUDDY_LOCALE = 'fr';
    resetI18n(); // Reset auto-detection
    expect(getLocale()).toBe('fr');
    expect(t('common.yes')).toBe('Oui');
  });

  it('should auto-detect locale from LANG env', () => {
    delete process.env.CODEBUDDY_LOCALE;
    process.env.LANG = 'fr_FR.UTF-8';
    resetI18n();
    expect(getLocale()).toBe('fr');
  });

  it('should return en for unsupported locale in env', () => {
    process.env.CODEBUDDY_LOCALE = 'ko';
    resetI18n();
    expect(getLocale()).toBe('en');
  });

  it('should list only translated locales', () => {
    const locales = getSupportedLocales();
    expect(locales).toEqual(['en', 'fr']);
  });

  it('should validate locale support', () => {
    expect(isLocaleSupported('en')).toBe(true);
    expect(isLocaleSupported('fr')).toBe(true);
    expect(isLocaleSupported('de')).toBe(false);
    expect(isLocaleSupported('ko')).toBe(false);
    expect(isLocaleSupported('pt')).toBe(false);
  });
});
