// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeckDesignEditor,
  DocDesignEditor,
  ImageDesignEditor,
} from '../src/renderer/components/deliverables/DesignViewEditors';

afterEach(cleanup);

describe('Design View structured editors', () => {
  it('edits the selected document block without touching its siblings', () => {
    const onChange = vi.fn();
    render(<DocDesignEditor value={{
      title: 'Rapport',
      blocks: [
        { type: 'h1', text: 'Rapport' },
        { type: 'p', text: 'Version initiale' },
      ],
    }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Version initiale/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Version révisée' } });

    expect(onChange).toHaveBeenCalledWith({
      title: 'Rapport',
      blocks: [
        { type: 'h1', text: 'Rapport' },
        { type: 'p', text: 'Version révisée' },
      ],
    });
  });

  it('adds a real slide to the deck draft used by export', () => {
    const onChange = vi.fn();
    render(<DeckDesignEditor value={{
      title: 'Robot',
      slides: [{ title: 'Introduction', bullets: ['But'] }],
    }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une slide' }));
    expect(onChange).toHaveBeenCalledWith({
      title: 'Robot',
      slides: [
        { title: 'Introduction', bullets: ['But'] },
        { title: 'Nouvelle slide', bullets: [] },
      ],
    });
  });

  it('shows the mark tool and keeps generation disabled until a region exists', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      media: {
        editImage: vi.fn(),
        imageEditHistory: vi.fn(async () => ({ ok: true })),
        capabilities: vi.fn(async () => ({ imageEditing: true, imageMasking: false })),
      },
    };
    render(<ImageDesignEditor value="/tmp/source.png" onChange={vi.fn()} />);

    expect(screen.getByLabelText('Tracer une zone à modifier')).toBeTruthy();
    expect(screen.getByText('Aucune zone marquée.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Appliquer aux zones' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText(/ne prend pas de masque alpha/i)).toBeTruthy();
  });

  it('restores a durable head after remount and rolls back through its parent link', async () => {
    const sourcePath = '/workspace/.codebuddy/media-generation/images/source.png';
    const editedPath = '/workspace/.codebuddy/media-generation/images/edit.png';
    const versions = [
      { id: 'source-id', parentId: null, path: sourcePath, createdAt: 1 },
      { id: 'edit-id', parentId: 'source-id', path: editedPath, createdAt: 2 },
    ];
    const imageEditHistory = vi.fn(async () => ({
      ok: true,
      history: { chainId: 'chain-id', headVersionId: 'edit-id', versions },
    }));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      media: {
        editImage: vi.fn(),
        imageEditHistory,
        capabilities: vi.fn(async () => ({ imageEditing: true, imageMasking: true })),
      },
    };

    function Harness() {
      const [value, setValue] = React.useState(sourcePath);
      return <ImageDesignEditor value={value} onChange={setValue} />;
    }

    render(<Harness />);
    await waitFor(() => {
      expect(screen.getByAltText('Image à éditer').getAttribute('src')).toBe(`file://${editedPath}`);
    });
    expect(screen.getByTestId('image-version-count').textContent).toMatch(/2 versions conservées/);
    expect(imageEditHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Version précédente' }));
    await waitFor(() => {
      expect(screen.getByAltText('Image à éditer').getAttribute('src')).toBe(`file://${sourcePath}`);
    });
    expect(imageEditHistory).toHaveBeenCalledTimes(1);
  });
});
