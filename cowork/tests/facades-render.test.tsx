/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/renderer/hooks/useIPC', () => ({ useIPC: () => ({ startSession: vi.fn() }) }));
import i18n from '../src/renderer/i18n/config';
import { useAppStore } from '../src/renderer/store';
import { HomeView } from '../src/renderer/components/HomeView';
import { NewShell } from '../src/renderer/components/NewShell';
import { LabsGallery } from '../src/renderer/components/labs/LabsGallery';
import { LABS_ENTRIES } from '../src/renderer/components/labs/labs-catalog';

const emptyHandler = (value: unknown) => typeof value === 'function' && /=>\s*\{\s*\}/.test(String(value));
function expectNoEmptyButtonHandlers(root: HTMLElement) {
  for (const button of root.querySelectorAll('button')) {
    const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
    const props = propsKey ? (button as unknown as Record<string, Record<string, unknown>>)[propsKey] : undefined;
    expect(emptyHandler(props?.onClick), button.textContent ?? '').toBe(false);
  }
}
afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage('en');
  useAppStore.setState({ sessions: [], activeSessionId: null, primaryView: 'chat', showSkillsManager: false, showLiveLauncher: false, creationsTab: 'deck', creationsSeed: null, chatComposerSeed: null });
});
describe('E3: controls perform their advertised action', () => {
  it('removes the Code / fix chip that only erased the draft', () => {
    render(<HomeView />);
    expect(screen.queryByRole('button', { name: /Code \/ fix/ })).toBeNull();
  });
  it('opens the document studio with the subject instead of the skills manager', () => {
    render(<HomeView />);
    fireEvent.change(screen.getByTestId('home-input'), { target: { value: 'Project report' } });
    fireEvent.click(screen.getByRole('button', { name: /Create a document/ }));
    expect(useAppStore.getState()).toMatchObject({ primaryView: 'creations', creationsTab: 'doc', creationsSeed: 'Project report', showSkillsManager: false });
  });
  it('HomeView has no rendered button with an empty click handler', () => {
    const { container } = render(<HomeView />);
    expectNoEmptyButtonHandlers(container);
  });
  it('LabsGallery opens a real preview and every offered preview has no placeholder callbacks', async () => {
    const { container } = render(<LabsGallery />);
    expectNoEmptyButtonHandlers(container);
    for (const entry of LABS_ENTRIES) {
      // Check the actual props handed to the drawer, including forwarding handlers
      // such as () => onGenerate(...), whose function body itself is not empty.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: new RegExp('\\b' + entry.slice.id + '\\b') }));
        await entry.load();
      });
      expect(container.querySelector('aside')?.textContent).toContain(entry.slice.title);
      await waitFor(() => expect(screen.getByTestId('labs-preview-content').firstElementChild).not.toBeNull());
      expectNoEmptyButtonHandlers(screen.getByTestId('labs-preview-content'));
      expect(Object.entries(entry.props).filter(([, value]) => emptyHandler(value)), entry.slice.id).toEqual([]);
    }
  });
  it('does not advertise the activity panel as a project file browser', () => {
    render(<NewShell />);
    const rail = screen.getByTestId('shell-rail');
    expect(rail.textContent).not.toContain('Files');
  });
});
