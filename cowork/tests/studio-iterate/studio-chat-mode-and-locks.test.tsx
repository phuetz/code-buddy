/**
 * Boutons ajoutés à App Studio : bascule Construire/Discuter, « Implémenter ce
 * plan », Stop du chat, verrou dans l'arbre de fichiers. Rendu réel (jsdom),
 * chaque bouton doit appeler son gestionnaire.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StudioChatPanel } from '../../src/renderer/components/studio-iterate/StudioChatPanel';
import { StudioFileTree } from '../../src/renderer/components/studio/StudioFileTree';

// jsdom n'implémente pas scrollIntoView (le panneau défile vers le dernier message).
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe('StudioChatPanel — mode discussion', () => {
  it('bascule de mode et n’affiche « Implémenter ce plan » qu’en discussion, après une réponse', () => {
    const onModeChange = vi.fn();
    const onImplementPlan = vi.fn();
    const messages = [
      { id: '1', role: 'user' as const, text: '💬 Idée ?' },
      { id: '2', role: 'assistant' as const, text: '1. Ajouter un thème sombre' },
    ];
    const { rerender } = render(
      <StudioChatPanel messages={messages} mode="build" onModeChange={onModeChange} onImplementPlan={onImplementPlan} />,
    );
    expect(screen.queryByTestId('studio-implement-plan')).toBeNull();
    fireEvent.click(screen.getByTestId('studio-mode-discuss'));
    expect(onModeChange).toHaveBeenCalledWith('discuss');

    rerender(
      <StudioChatPanel messages={messages} mode="discuss" onModeChange={onModeChange} onImplementPlan={onImplementPlan} />,
    );
    expect(screen.getByText(/aucun fichier ne sera modifié/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('studio-implement-plan'));
    expect(onImplementPlan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('studio-mode-build'));
    expect(onModeChange).toHaveBeenLastCalledWith('build');

    // Pendant un tour : pas de bouton d'implémentation, et Stop appelle onStop.
    const onStop = vi.fn();
    rerender(
      <StudioChatPanel messages={messages} busy mode="discuss" onModeChange={onModeChange} onImplementPlan={onImplementPlan} onStop={onStop} />,
    );
    expect(screen.queryByTestId('studio-implement-plan')).toBeNull();
    fireEvent.click(screen.getByText('Stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('StudioFileTree — verrous', () => {
  const tree = [
    { name: 'src', path: 'src', type: 'directory' as const, children: [{ name: 'App.tsx', path: 'src/App.tsx', type: 'file' as const }] },
    { name: 'package.json', path: 'package.json', type: 'file' as const },
  ];

  it('affiche le cadenas des fichiers verrouillés et bascule le verrou', () => {
    const onToggleLock = vi.fn();
    render(<StudioFileTree tree={tree} onOpen={() => {}} lockedPaths={['package.json']} onToggleLock={onToggleLock} />);
    expect(screen.getByTestId('studio-locked-package.json')).toBeTruthy();
    expect(screen.getByLabelText('Déverrouiller package.json')).toBeTruthy();
    fireEvent.click(screen.getByTestId('studio-lock-toggle-src'));
    expect(onToggleLock).toHaveBeenCalledWith('src');
    fireEvent.click(screen.getByTestId('studio-lock-toggle-package.json'));
    expect(onToggleLock).toHaveBeenLastCalledWith('package.json');
  });

  it('sans gestionnaire, aucun bouton de verrou', () => {
    render(<StudioFileTree tree={tree} onOpen={() => {}} />);
    expect(screen.queryByTestId('studio-lock-toggle-src')).toBeNull();
  });
});
