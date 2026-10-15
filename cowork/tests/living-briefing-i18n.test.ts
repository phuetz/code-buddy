import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { buildLivingBriefing, type LivingBriefingInput } from '../src/renderer/components/living-briefing-model';
import en from '../src/renderer/i18n/locales/en.json';
import fr from '../src/renderer/i18n/locales/fr.json';
import zh from '../src/renderer/i18n/locales/zh.json';

const NOW = new Date('2026-07-12T07:30:00+02:00').getTime();
const resources = { en: { translation: en }, fr: { translation: fr }, zh: { translation: zh } };

function input(t: LivingBriefingInput['t']): LivingBriefingInput {
  return { t, now: NOW, activities: [], sessions: [], snapshot: null, daemonRunning: true, artifact: null };
}

describe('buildLivingBriefing with real locales', () => {
  it.each([
    ['en', 'Good morning', 'All is quiet, I am watching', 'Loop active'],
    ['fr', 'Bonjour', 'Tout est calme, je veille', 'Boucle active'],
    ['zh', '早上好', '一切平静，我正在看着', '循环激活'],
  ] as const)('renders the %s briefing and spoken text', async (lang, greeting, headline, daemon) => {
    const i18n = createInstance();
    await i18n.init({ lng: lang, resources, fallbackLng: false, initImmediate: false });
    const model = buildLivingBriefing(input(i18n.getFixedT(lang)));
    expect(model.greeting).toBe(greeting);
    expect(model.headline).toBe(headline);
    expect(model.daemonLabel).toBe(daemon);
    expect(model.spokenText).toContain(headline);
    expect(model.summary).not.toMatch(/^livingBriefing\./);
  });

  it('uses independent singular and plural forms for the factual summary', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources, fallbackLng: false, initImmediate: false });
    const t = i18n.getFixedT('en');
    expect(t('livingBriefing.completedCount', { count: 1 })).toBe('1 task completed');
    expect(t('livingBriefing.completedCount', { count: 3 })).toBe('3 tasks completed');
    expect(t('livingBriefing.timerDueLabel', { count: 2 })).toBe('2 timers are done');
    const model = buildLivingBriefing({
      ...input(t),
      maison: {
        status: 'ready',
        snapshot: {
          day: { kind: 'weekend' },
          presence: { state: 'present' },
          mode: 'normal',
          provenance: { kind: 'calendar', observedAt: NOW },
          nextMeal: null,
        },
        activeTimers: [
          { id: 'one', label: 'One', state: 'due', remainingMs: 0, dueAt: new Date(NOW).toISOString() },
          { id: 'two', label: 'Two', state: 'due', remainingMs: 0, dueAt: new Date(NOW).toISOString() },
        ],
        foodProfile: { configured: true, constraintCount: 1, unknownCount: 1 },
        warnings: [],
      },
    });
    expect(model.maisonCue?.label).toBe('2 timers are done');
    expect(model.maisonCue?.detail).toContain('1 dietary constraint remains to be confirmed');
    expect(model.spokenText).toContain('2 kitchen timers are done');
  });
});
