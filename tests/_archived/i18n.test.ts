/**
 * Tests for i18n module — all 6 locales, translation lookup, interpolation.
 */
import { getI18n, t, resetI18n } from '../src/i18n/index.js';

describe('I18n module', () => {
  beforeEach(() => {
    resetI18n();
    // Ensure clean environment
    delete process.env.LANG;
    delete process.env.LC_ALL;
    delete process.env.LANGUAGE;
  });

  afterEach(() => {
    resetI18n();
  });

  it('defaults to English', () => {
    const i18n = getI18n();
    expect(i18n.getLocale()).toBe('en');
    expect(i18n.t('common.yes')).toBe('Yes');
  });

  it('returns available locales including all 6', () => {
    const locales = getI18n().getAvailableLocales();
    expect(locales).toContain('en');
    expect(locales).toContain('fr');
    expect(locales).toContain('de');
    expect(locales).toContain('es');
    expect(locales).toContain('ja');
    expect(locales).toContain('zh');
  });

  it('switches locale and returns correct translation', () => {
    const i18n = getI18n();

    i18n.setLocale('fr');
    expect(i18n.t('common.yes')).toBe('Oui');

    i18n.setLocale('de');
    expect(i18n.t('common.yes')).toBe('Ja');

    i18n.setLocale('es');
    expect(i18n.t('common.yes')).toBe('Sí');

    i18n.setLocale('ja');
    expect(i18n.t('common.yes')).toBe('はい');

    i18n.setLocale('zh');
    expect(i18n.t('common.yes')).toBe('是');
  });

  it('interpolates placeholders correctly', () => {
    const i18n = getI18n();
    i18n.setLocale('en');
    const result = i18n.t('cli.sessionLoaded', { name: 'my-session' });
    expect(result).toBe('Session loaded: my-session');
  });

  it('interpolates placeholders in German', () => {
    const i18n = getI18n();
    i18n.setLocale('de');
    const result = i18n.t('cli.sessionLoaded', { name: 'meine-sitzung' });
    expect(result).toBe('Sitzung geladen: meine-sitzung');
  });

  it('falls back to key path for unknown keys', () => {
    const i18n = getI18n();
    const result = i18n.t('nonexistent.key');
    expect(result).toBe('nonexistent.key');
  });

  it('shorthand t() function works', () => {
    resetI18n();
    const result = t('common.cancel');
    expect(result).toBe('Cancel');
  });

  it('emits localeChanged event on setLocale', () => {
    const i18n = getI18n();
    const handler = jest.fn();
    i18n.on('localeChanged', handler);
    i18n.setLocale('es');
    expect(handler).toHaveBeenCalledWith('es');
    i18n.off('localeChanged', handler);
  });

  it('German translations cover all categories', () => {
    const i18n = getI18n();
    i18n.setLocale('de');

    expect(i18n.t('common.cancel')).toBe('Abbrechen');
    expect(i18n.t('cli.thinking')).toBe('Nachdenken...');
    expect(i18n.t('tools.readingFile', { path: '/foo' })).toBe('Datei lesen: /foo');
    expect(i18n.t('errors.unknown')).toBe('Ein unbekannter Fehler ist aufgetreten.');
    expect(i18n.t('help.title')).toBe('Code Buddy Hilfe');
  });

  it('Spanish translations cover all categories', () => {
    const i18n = getI18n();
    i18n.setLocale('es');

    expect(i18n.t('common.cancel')).toBe('Cancelar');
    expect(i18n.t('cli.thinking')).toBe('Pensando...');
    expect(i18n.t('tools.readingFile', { path: '/foo' })).toBe('Leyendo archivo: /foo');
    expect(i18n.t('errors.unknown')).toBe('Ocurrió un error desconocido.');
    expect(i18n.t('help.title')).toBe('Ayuda de Code Buddy');
  });

  it('Japanese translations cover all categories', () => {
    const i18n = getI18n();
    i18n.setLocale('ja');

    expect(i18n.t('common.cancel')).toBe('キャンセル');
    expect(i18n.t('cli.thinking')).toBe('考え中...');
    expect(i18n.t('tools.fileNotFound', { path: '/foo' })).toBe('ファイルが見つかりません: /foo');
    expect(i18n.t('errors.forbidden')).toBe('アクセスが拒否されました。');
    expect(i18n.t('help.title')).toBe('Code Buddyヘルプ');
  });

  it('Chinese translations cover all categories', () => {
    const i18n = getI18n();
    i18n.setLocale('zh');

    expect(i18n.t('common.cancel')).toBe('取消');
    expect(i18n.t('cli.thinking')).toBe('思考中...');
    expect(i18n.t('tools.fileNotFound', { path: '/bar' })).toBe('文件未找到: /bar');
    expect(i18n.t('errors.forbidden')).toBe('访问被拒绝。');
    expect(i18n.t('help.title')).toBe('Code Buddy 帮助');
  });

  it('getCategory returns correct typed object', () => {
    const i18n = getI18n();
    i18n.setLocale('fr');
    const common = i18n.getCategory('common');
    expect(common.yes).toBe('Oui');
    expect(common.no).toBe('Non');
  });
});
