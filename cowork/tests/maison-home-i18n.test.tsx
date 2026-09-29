/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaisonHomeCard } from '../src/renderer/components/home/MaisonHomeCard';
import en from '../src/renderer/i18n/locales/en.json';
import fr from '../src/renderer/i18n/locales/fr.json';

const resources = { en: { translation: en }, fr: { translation: fr } };

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'electronAPI');
});

describe('MaisonHomeCard with real locales', () => {
  it.each([
    ['en', 'Persistent Timers', 'Encrypted Meal Profile'],
    ['fr', 'Minuteurs persistants', 'Profil repas chiffré'],
  ] as const)('renders %s live details', async (lang, timerLabel, mealLabel) => {
    const i18n = createInstance();
    await i18n.init({ lng: lang, resources, fallbackLng: false, initImmediate: false });
    const now = Date.now();
    const snapshot = vi.fn().mockResolvedValue({
      status: 'ready',
      snapshot: {
        day: { kind: 'weekend' }, presence: { state: 'present', displayName: 'Alex' },
        mode: 'free-day', provenance: { kind: 'calendar', observedAt: now }, nextMeal: null,
      },
      activeTimers: [{ id: 'timer-1', label: 'Pasta', state: 'active', remainingMs: 60000, dueAt: new Date(now + 60000).toISOString() }],
      foodProfile: { configured: true, constraintCount: 1, unknownCount: 0 }, warnings: [],
    });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { maison: { snapshot } } });
    render(<I18nextProvider i18n={i18n}><MaisonHomeCard /></I18nextProvider>);
    expect(await screen.findByText(timerLabel)).toBeInTheDocument();
    expect(screen.getByText(mealLabel)).toBeInTheDocument();
    if (lang === 'en') {
      expect(i18n.t('maisonCard.explicitConstraints', { count: 1 })).toBe('1 explicit constraint');
      expect(i18n.t('maisonCard.explicitConstraints', { count: 2 })).toBe('2 explicit constraints');
    }
    expect(screen.getByTestId('maison-home-card').textContent).not.toContain('maisonCard.');
  });
});
