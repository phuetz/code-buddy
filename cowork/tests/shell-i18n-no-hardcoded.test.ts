/**
 * @vitest-environment jsdom
 *
 * Cowork 2.4, étape E2 — « Une seule langue par écran ».
 *
 * Rend le rail du shell, l'accueil et la barre d'App Studio (barre d'actions +
 * chat d'itération) en français PUIS en anglais, et vérifie :
 *  - en `fr`, qu'aucune des chaînes anglaises relevées par l'audit Grok
 *    (§ 2.2 rail, § 2.3 accueil, § 2.8 App Studio) ne réapparaît ;
 *  - en `en` (langue par défaut), qu'aucune chaîne française codée en dur
 *    ne réapparaît, ni aucun caractère accentué français ;
 *  - que les libellés du rail sont ceux de la locale active ;
 *  - qu'Entrée envoie et que Maj+Entrée va à la ligne, à l'accueil comme au studio ;
 *  - que les nouvelles clés existent dans les trois locales.
 *
 * Sont lus le texte ET les attributs `title`, `aria-label` et `placeholder`.
 *
 * Hors périmètre E2 (plan PLAN-2-4.md, liste de fichiers) et donc retirés de la
 * lecture de l'accueil : le briefing vivant (`living-briefing`) et la carte
 * Maison (`maison-home-card`), écrits en français dans leurs propres modules.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const startSessionSpy = vi.fn(async () => null);
vi.mock('../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({
    startSession: startSessionSpy,
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    getSessionMessages: vi.fn(async () => []),
    getSessionTraceSteps: vi.fn(async () => []),
  }),
}));
// CodeMirror et xterm ne sont pas l'objet du test (jsdom ne les mesure pas).
vi.mock('../src/renderer/components/studio/CodeEditorPane', () => ({
  CodeEditorPane: () => React.createElement('div', { 'data-testid': 'editor' }),
}));
vi.mock('../src/renderer/components/studio/TerminalPane', () => ({
  TerminalPane: () => React.createElement('div', { 'data-testid': 'terminal' }),
}));

import i18n from '../src/renderer/i18n/config';
import { useAppStore } from '../src/renderer/store';
import { NewShell, studioSuggestions } from '../src/renderer/components/NewShell';
import { AppStudioView } from '../src/renderer/components/studio/AppStudioView';
import { StudioChatPanel } from '../src/renderer/components/studio-iterate/StudioChatPanel';

const localesDir = path.resolve(process.cwd(), 'src/renderer/i18n/locales');
type Json = Record<string, unknown>;
const readLocale = (lang: string): Json =>
  JSON.parse(fs.readFileSync(path.join(localesDir, `${lang}.json`), 'utf8')) as Json;

/** Chaînes anglaises citées par Grok (§ 2.2, 2.3, 2.8) : interdites en `fr`. */
const ENGLISH_FORBIDDEN_IN_FR = [
  // § 2.2 rail
  'Activity', 'Files', 'Creations', 'Video Studio', 'Meeting', 'Library', 'Capabilities',
  'Mission Control', 'Labs', 'Advanced', 'History', 'Conversation history',
  'Chat with Code Buddy', 'Break a mission', 'Watch the tools', 'Browse the project files',
  // § 2.3 accueil
  'What would you like to do?', 'Tell Code Buddy', 'e.g. fix the login bug', 'Send',
  'Deck', 'Sheet', 'Pod', 'Search', 'Code / fix', 'Create a document',
  'Describe the bug or the feature', 'Wide research', 'Your topic will travel',
  'Build a web app', 'Find & fix a bug', 'Review my changes', 'Open a pull request',
  // § 2.8 App Studio
  'Iterate on the app', 'Ask for a change', 'e.g. Make the primary button',
  'Change the theme', 'Add a dark mode', 'Make it responsive', 'Pushing…',
  'Pushed to GitHub', 'Editor', 'Preview', 'Run', 'Export', 'New app', 'Start a new app',
  'Ctrl/⌘ + Enter', 'Iteration message', 'Describe the next iteration',
];

/** Chaînes françaises autrefois codées en dur dans ces écrans : interdites en `en`. */
const FRENCH_FORBIDDEN_IN_EN = [
  'Sessions récentes', 'Missions prêtes', 'Sans titre', 'Espace Cowork', 'Choisir le thème',
  'Apparence', 'Palette de commandes', 'Raccourcis clavier', 'Chargement', 'Construire',
  'Discuter', 'Mode discussion', 'Implémenter ce plan', 'Mode du chat', 'Pièces jointes',
  'Retirer', 'Joindre une maquette', 'Contexte', 'jetons', 'Déployer', 'Construction…',
  'Panneau du bas', 'Fermer', 'Clair', 'Sombre', 'Système',
];

/** Lettres et signes propres au français : absents d'un écran anglais. */
const FRENCH_MARKS = /[àâäçéèêëîïôöûùüÿœæ«»]/i;

function containsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, 'u').test(haystack);
}

/** Texte visible + attributs lus par l'utilisateur ou le lecteur d'écran. */
function readable(root: Element, exclude: string[] = []): string[] {
  const clone = root.cloneNode(true) as Element;
  for (const testId of exclude) clone.querySelectorAll(`[data-testid="${testId}"]`).forEach((n) => n.remove());
  const out: string[] = [];
  const walker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) out.push(text);
  }
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const value = el.getAttribute(attr);
      if (value) out.push(value);
    }
  }
  return out;
}

function offenders(strings: string[], forbidden: string[]): string[] {
  return forbidden.filter((needle) => strings.some((s) => containsWord(s, needle)));
}

function renderShell(): { rail: Element; home: Element } {
  render(React.createElement(NewShell, { onboardingActive: false }));
  return { rail: screen.getByTestId('shell-rail'), home: screen.getByTestId('home-view') };
}

function renderStudio(onSend = vi.fn()): Element[] {
  render(
    React.createElement(AppStudioView, {
      tree: [{ name: 'index.html', path: 'index.html', type: 'file' }],
      activeFile: null,
      fileContent: '',
      previewUrl: null,
      previewStatus: 'idle',
      terminalOutput: [],
      buildPhase: 'idle',
      buildElapsedMs: 0,
      templates: [],
      workingDir: '/tmp/projet',
      onScaffold: () => {},
      onPrompt: () => {},
      onOpenFile: () => {},
      onChangeFileContent: () => {},
      onSaveFile: () => {},
      onStartPreview: () => {},
      onReloadPreview: () => {},
      onStopBuild: () => {},
      onNewApp: () => {},
      console: { browser: [], server: [], onFix: () => {}, onClear: () => {} },
      chat: {
        messages: [{ id: 'm1', role: 'assistant', text: '', streaming: true }],
        busy: false,
        suggestions: studioSuggestions(i18n.t.bind(i18n)),
        mode: 'build',
        onModeChange: () => {},
        onSend,
        onStop: () => {},
        estimateTokens: () => 1234,
        onAttachImage: () => {},
        contextPanel: React.createElement('div'),
      },
    } as unknown as React.ComponentProps<typeof AppStudioView>),
  );
  return [
    screen.getByTestId('studio-new-app'),
    screen.getByTestId('studio-toolbar'),
    screen.getByTestId('studio-chat'),
  ];
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  localStorage.setItem('cowork.tourSeen', '1');
  useAppStore.setState({
    sessions: [
      {
        id: 's1',
        title: '',
        status: 'idle',
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: true,
        createdAt: 1,
        updatedAt: 2,
      } as never,
    ],
    activeSessionId: null,
    primaryView: 'chat',
    showOnboardingTour: false,
    workingDir: '/tmp/projet',
    activeProjectId: null,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('E2 — une seule langue par écran', () => {
  describe('en français', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('fr');
      });
    });

    it('le rail n’affiche aucune chaîne anglaise et prend ses libellés dans fr.json', () => {
      const { rail } = renderShell();
      expect(offenders(readable(rail), ENGLISH_FORBIDDEN_IN_FR)).toEqual([]);

      const fr = readLocale('fr') as { shell: { rail: Record<string, { label: string }> } };
      expect(screen.getByTestId('rail-os').textContent?.endsWith(fr.shell.rail.os!.label)).toBe(true);
      expect(screen.getByTestId('rail-workspace').textContent?.endsWith(fr.shell.rail.workspace!.label)).toBe(true);
      expect(screen.getByTestId('rail-history').textContent).toContain('Historique');
    });

    it('l’accueil n’affiche aucune chaîne anglaise citée par Grok', () => {
      const { home } = renderShell();
      const strings = readable(home, ['living-briefing', 'maison-home-card']);
      expect(offenders(strings, ENGLISH_FORBIDDEN_IN_FR)).toEqual([]);
      expect(strings).toContain('Que voulez-vous faire ?');
      expect(strings).toContain('Sans titre');
      expect(screen.getByTestId('home-key-hint').textContent).toContain('Maj+Entrée');
    });

    it('la barre et le chat d’App Studio n’affichent aucune chaîne anglaise', () => {
      const regions = renderStudio();
      const strings = regions.flatMap((r) => readable(r));
      expect(offenders(strings, ENGLISH_FORBIDDEN_IN_FR)).toEqual([]);
      expect(strings).toContain('Faire évoluer l’application');
      expect(strings).toContain('Changer le thème');
      expect(screen.getByTestId('studio-token-estimate').textContent).toContain('jetons');
    });
  });

  describe('en anglais (langue par défaut)', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('le rail n’affiche aucune chaîne française', () => {
      const { rail } = renderShell();
      const strings = readable(rail);
      expect(offenders(strings, FRENCH_FORBIDDEN_IN_EN)).toEqual([]);
      expect(strings.filter((s) => FRENCH_MARKS.test(s))).toEqual([]);
      expect(screen.getByTestId('rail-os').textContent?.endsWith('Mission Control')).toBe(true);
    });

    it('l’accueil n’affiche aucune chaîne française (hors briefing et carte Maison)', () => {
      const { home } = renderShell();
      const strings = readable(home, ['living-briefing', 'maison-home-card']);
      expect(offenders(strings, FRENCH_FORBIDDEN_IN_EN)).toEqual([]);
      expect(strings.filter((s) => FRENCH_MARKS.test(s))).toEqual([]);
      expect(strings).toContain('Recent sessions');
    });

    it('la barre et le chat d’App Studio n’affichent aucune chaîne française', () => {
      const regions = renderStudio();
      const strings = regions.flatMap((r) => readable(r));
      expect(offenders(strings, FRENCH_FORBIDDEN_IN_EN)).toEqual([]);
      expect(strings.filter((s) => FRENCH_MARKS.test(s))).toEqual([]);
      expect(strings).toContain('Deploy');
    });
  });

  it('Entrée envoie, Maj+Entrée va à la ligne, dans le chat du studio', () => {
    const onSend = vi.fn();
    render(React.createElement(StudioChatPanel, { messages: [], onSend }));
    const box = screen.getByLabelText('Iteration message');
    fireEvent.change(box, { target: { value: 'Ajoute un pied de page' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Ajoute un pied de page');
    expect(screen.getByTestId('studio-key-hint').textContent).toContain('Shift+Enter');
  });

  it('les nouvelles clés existent dans les trois locales', () => {
    const flatten = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value as Json).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
        : [prefix];
    const pick = (locale: Json) => {
      const settings = locale.settings as Json;
      return flatten({
        shell: locale.shell,
        homeView: locale.homeView,
        recipes: locale.recipes,
        studio: locale.studio,
        studioChat: locale.studioChat,
        settings: { tabGroup: settings.tabGroup, tunnel: settings.tunnel, tunnelDesc: settings.tunnelDesc },
      }).sort();
    };
    const en = pick(readLocale('en'));
    expect(en.length).toBeGreaterThan(100);
    expect(pick(readLocale('fr'))).toEqual(en);
    expect(pick(readLocale('zh'))).toEqual(en);
  });

  it('chaque clé t(\'…\') des écrans traités existe en en, fr et zh', () => {
    const files = [
      'components/NewShell.tsx',
      'components/HomeView.tsx',
      'components/SettingsPanel.tsx',
      'components/studio/AppStudioView.tsx',
      'components/studio-iterate/StudioChatPanel.tsx',
    ];
    const lookup = (locale: Json, key: string): unknown =>
      key.split('.').reduce<unknown>(
        (node, part) => (node && typeof node === 'object' ? (node as Json)[part] : undefined),
        locale,
      );
    const missing: string[] = [];
    for (const lang of ['en', 'fr', 'zh']) {
      const locale = readLocale(lang);
      for (const file of files) {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/renderer', file), 'utf8');
        for (const [, key] of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
          if (typeof lookup(locale, key!) !== 'string') missing.push(`${lang}:${file}:${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('les réglages : titres de groupes traduits, aucun repli chinois codé en dur', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/[一-鿿]/);
    expect(source).toContain("t(`settings.tabGroup.${grp.id}`, grp.label)");
    const groups = ['essentials', 'models', 'tools', 'extend', 'automation', 'security', 'ops'];
    const fr = readLocale('fr') as { settings: { tabGroup: Record<string, string> } };
    const en = readLocale('en') as { settings: { tabGroup: Record<string, string> } };
    for (const id of groups) {
      expect(fr.settings.tabGroup[id]).toBeTruthy();
      expect(fr.settings.tabGroup[id]).not.toBe(en.settings.tabGroup[id]);
    }
  });
});
