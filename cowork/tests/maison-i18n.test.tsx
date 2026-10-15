/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaisonCard } from '../src/renderer/components/home/MaisonCard';
import en from '../src/renderer/i18n/locales/en.json';
import fr from '../src/renderer/i18n/locales/fr.json';
import zh from '../src/renderer/i18n/locales/zh.json';

const resources = { en: { translation: en }, fr: { translation: fr }, zh: { translation: zh } };

afterEach(cleanup);

describe('MaisonCard with real locales', () => {
  it.each([
    ['en', 'Change', 'Guest', 'Silence', 'Weekend'],
    ['fr', 'Changer', 'Invités', 'Silence', 'Week-end'],
    ['zh', '更改', '访客', '静音', '周末'],
  ] as const)('renders %s labels and model text', async (lang, change, guest, silence, day) => {
    const i18n = createInstance();
    await i18n.init({ lng: lang, resources, fallbackLng: false, initImmediate: false });
    render(<I18nextProvider i18n={i18n}><MaisonCard
      snapshot={{
        day: { kind: 'weekend' }, presence: { state: 'present', displayName: 'Alex' },
        mode: 'free-day', provenance: { kind: 'calendar', observedAt: Date.now() }, nextMeal: null,
      }}
      status="ready"
      onModeChange={vi.fn()} onSilenceChange={vi.fn()} onStartCooking={vi.fn()}
      onGuestsChange={vi.fn()} onRefresh={vi.fn()}
    /></I18nextProvider>);
    expect(screen.getByTestId('maison-change-mode')).toHaveTextContent(change);
    expect(screen.getByTestId('maison-guests')).toHaveTextContent(guest);
    expect(screen.getByTestId('maison-silence')).toHaveTextContent(silence);
    expect(screen.getByTestId('maison-day')).toHaveTextContent(day);
    if (lang === 'en') {
      expect(screen.getByRole('region', { name: 'The day can stay truly free' })).toBeInTheDocument();
      expect(screen.getByTestId('maison-provenance')).toHaveTextContent('Local calendar');
      expect(screen.getByTestId('maison-card')).not.toHaveTextContent('Le temps peut rester vraiment libre');
    }
    expect(screen.getByTestId('maison-card').textContent).not.toContain('maisonCard.');
  });
});
