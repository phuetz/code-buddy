/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  HELP_COPY_FIELDS,
  SHELL_NAV_TREE,
  listShellNavScreenIds,
} from '../src/renderer/help/shell-nav-catalog';
import i18n from '../src/renderer/i18n/config';
import { handleHelpKeyDown } from '../src/renderer/help/open-screen-help';
import { ShellNavigation } from '../src/renderer/components/ShellNavigation';
import { useAppStore } from '../src/renderer/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const localesDir = path.resolve(process.cwd(), 'src/renderer/i18n/locales');
const coworkRoot = process.cwd();
const repoRoot = path.resolve(coworkRoot, '..');

function readLocale(name: string): {
  helpDocs: {
    screens: Record<string, Record<string, string>>;
    groups: Record<string, string>;
  };
} {
  return JSON.parse(fs.readFileSync(path.join(localesDir, name), 'utf8')) as {
    helpDocs: {
      screens: Record<string, Record<string, string>>;
      groups: Record<string, string>;
    };
  };
}

describe('shell navigation help coverage', () => {
  const screenIds = listShellNavScreenIds();
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useAppStore.setState({
      showHelpDocs: false,
      helpDocsAnchor: null,
      showMissionBoard: false,
      showDesktopSnapshot: false,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  async function renderNav() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<ShellNavigation />);
    });
  }

  it('renders every catalog screen as a sidebar control', async () => {
    expect(screenIds.length).toBeGreaterThan(0);
    expect(new Set(screenIds).size).toBe(screenIds.length);
    expect(SHELL_NAV_TREE.map((group) => group.id)).toEqual([
      'work',
      'agents',
      'automation',
      'companion',
      'insights',
      'system',
    ]);

    await renderNav();

    for (const id of screenIds) {
      const control = document.querySelector(`[data-help-screen="${id}"]`);
      expect(control, `missing sidebar control for ${id}`).toBeInstanceOf(HTMLButtonElement);
    }

    const rendered = [...document.querySelectorAll('[data-help-screen]')].map((el) =>
      el.getAttribute('data-help-screen')
    );
    expect(rendered).toEqual(screenIds);
  });

  it('opens the help index from the F1 shortcut handler', () => {
    useAppStore.setState({ showHelpDocs: false, helpDocsAnchor: 'devices' });
    const ignored = { key: 'F2', preventDefault() {} };
    expect(handleHelpKeyDown(ignored)).toBe(false);
    expect(useAppStore.getState().showHelpDocs).toBe(false);

    let prevented = false;
    const event = {
      key: 'F1',
      preventDefault() {
        prevented = true;
      },
    };
    expect(handleHelpKeyDown(event)).toBe(true);
    expect(prevented).toBe(true);
    expect(useAppStore.getState().showHelpDocs).toBe(true);
    expect(useAppStore.getState().helpDocsAnchor).toBeNull();
  });

  it('wires mission board and desktop snapshot buttons to the store', async () => {
    await renderNav();
    const mission = document.querySelector(
      '[data-help-screen="mission-board"]'
    ) as HTMLButtonElement;
    const snapshot = document.querySelector(
      '[data-help-screen="desktop-snapshot"]'
    ) as HTMLButtonElement;

    await act(async () => {
      mission.click();
    });
    expect(useAppStore.getState().showMissionBoard).toBe(true);

    await act(async () => {
      snapshot.click();
    });
    expect(useAppStore.getState().showDesktopSnapshot).toBe(true);
  });

  it('gives every sidebar entry help copy in French and English', () => {
    const en = readLocale('en.json');
    const fr = readLocale('fr.json');

    for (const group of SHELL_NAV_TREE) {
      expect(en.helpDocs.groups[group.id], `en group ${group.id}`).toBeTruthy();
      expect(fr.helpDocs.groups[group.id], `fr group ${group.id}`).toBeTruthy();
    }

    for (const id of screenIds) {
      const enScreen = en.helpDocs.screens[id];
      const frScreen = fr.helpDocs.screens[id];
      expect(enScreen, `missing English help for ${id}`).toBeTruthy();
      expect(frScreen, `missing French help for ${id}`).toBeTruthy();
      for (const field of HELP_COPY_FIELDS) {
        expect(typeof enScreen[field], `en ${id}.${field}`).toBe('string');
        expect(typeof frScreen[field], `fr ${id}.${field}`).toBe('string');
        expect(enScreen.title.trim().length).toBeGreaterThan(0);
        expect(frScreen.title.trim().length).toBeGreaterThan(0);
        expect(enScreen.purpose.trim().length).toBeGreaterThan(0);
        expect(frScreen.purpose.trim().length).toBeGreaterThan(0);
        expect(enScreen.when.trim().length).toBeGreaterThan(0);
        expect(frScreen.when.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('fails if a locale help screen is not in the navigation tree', () => {
    const en = readLocale('en.json');
    const allowed = new Set(screenIds);
    for (const id of Object.keys(en.helpDocs.screens)) {
      expect(allowed.has(id as (typeof screenIds)[number]), `orphan help id ${id}`).toBe(true);
    }
  });

  it('keeps the cowork lockfile root license as MIT', () => {
    const lock = JSON.parse(
      fs.readFileSync(path.join(coworkRoot, 'package-lock.json'), 'utf8')
    ) as { packages: { '': { license?: string } } };
    expect(lock.packages[''].license).toBe('MIT');
  });

  it('does not leave the stray APPDATA directory at the repo root', () => {
    expect(fs.existsSync(path.join(repoRoot, '${APPDATA}'))).toBe(false);
  });

  it('keeps the screen-help deliverable inside the worktree', () => {
    const deliverable = path.join(
      repoRoot,
      'Partage',
      '20260917-cowork-comparaison',
      'AIDE-ECRANS.md'
    );
    expect(fs.existsSync(deliverable)).toBe(true);
    const text = fs.readFileSync(deliverable, 'utf8');
    expect(text.includes('Écrans couverts (36)')).toBe(true);
  });
});
