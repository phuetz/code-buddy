/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import i18n from '../src/renderer/i18n/config';
import { HelpDocs } from '../src/renderer/components/HelpDocs';
import { ScreenHelpButton } from '../src/renderer/components/ScreenHelpButton';
import { useAppStore } from '../src/renderer/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderHelp() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<HelpDocs onClose={() => useAppStore.getState().setShowHelpDocs(false)} />);
  });
}

describe('HelpDocs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useAppStore.setState({ showHelpDocs: true, helpDocsAnchor: null });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
    useAppStore.setState({ showHelpDocs: false, helpDocsAnchor: null });
  });

  it('opens the index and filters screens from search', async () => {
    await renderHelp();
    expect(document.querySelector('[data-testid="help-docs"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="help-docs-search"]')).toBeTruthy();

    const search = document.querySelector('[data-testid="help-docs-search"]') as HTMLInputElement;
    await act(async () => {
      Simulate.change(search, { target: { value: 'paired devices' } } as never);
    });

    expect(document.querySelector('[data-testid="help-docs-nav-devices"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="help-docs-nav-work-home"]')).toBeNull();
  });

  it('anchors on a given screen from the store', async () => {
    useAppStore.setState({ showHelpDocs: true, helpDocsAnchor: 'memory' });
    await renderHelp();
    const article = document.querySelector('[data-testid="help-docs-article"]');
    expect(article?.getAttribute('data-help-screen')).toBe('memory');
    expect(document.querySelector('[data-testid="help-docs-article-title"]')?.textContent).toMatch(
      /Memory/i
    );
    expect(document.querySelector('[data-testid="help-docs-purpose"]')?.textContent).toMatch(
      /long-term notes/i
    );
  });

  it('moves between screens with the arrow keys', async () => {
    await renderHelp();
    const search = document.querySelector('[data-testid="help-docs-search"]') as HTMLInputElement;
    expect(document.querySelector('[data-testid="help-docs-article"]')?.getAttribute('data-help-screen')).toBe(
      'work-home'
    );
    await act(async () => {
      Simulate.keyDown(search, { key: 'ArrowDown' });
    });
    expect(document.querySelector('[data-testid="help-docs-article"]')?.getAttribute('data-help-screen')).toBe(
      'new-task'
    );
  });

  it('closes on Escape', async () => {
    await renderHelp();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(useAppStore.getState().showHelpDocs).toBe(false);
  });

  it('screen help button opens help on that screen', async () => {
    useAppStore.setState({ showHelpDocs: false, helpDocsAnchor: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<ScreenHelpButton screenId="devices" />);
    });
    const button = document.querySelector('[data-testid="screen-help-devices"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(useAppStore.getState().showHelpDocs).toBe(true);
    expect(useAppStore.getState().helpDocsAnchor).toBe('devices');
  });
});
