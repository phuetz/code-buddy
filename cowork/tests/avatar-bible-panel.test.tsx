// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AvatarBiblePanel,
  selectPreviewAvatars,
} from '../src/renderer/components/videostudio/AvatarBiblePanel';
import type { AvatarBibleEntry, AvatarBibleSnapshot } from '../src/shared/avatar-bible';

const avatar: AvatarBibleEntry = {
  id: 'f65b8e2d-83ca-4b26-8bc2-b21ece813c4b',
  name: 'Buddy cyan',
  role: 'front',
  rights: 'owned',
  consent: 'not-applicable',
  notes: 'Visière cyan',
  sha256: 'a'.repeat(64),
  mime: 'image/png',
  bytes: 1024,
  width: 512,
  height: 512,
  createdAt: '2026-07-12T15:00:00.000Z',
  updatedAt: '2026-07-12T15:00:00.000Z',
};

function snapshot(avatars: AvatarBibleEntry[] = [], masterId?: string): AvatarBibleSnapshot {
  return {
    schemaVersion: 1,
    revision: avatars.length,
    updatedAt: '2026-07-12T15:00:00.000Z',
    ...(masterId ? { masterId } : {}),
    avatars,
    privacy: {
      projectScoped: true,
      containsFaceEmbeddings: false,
      note: 'No biometrics',
    },
  };
}

const api = {
  list: vi.fn(async () => ({ ok: true as const, snapshot: snapshot([avatar]) })),
  importImage: vi.fn(async () => ({ ok: true as const, snapshot: snapshot([avatar]), avatar })),
  update: vi.fn(async () => ({ ok: true as const, snapshot: snapshot([avatar]), avatar })),
  setMaster: vi.fn(async () => ({ ok: true as const, snapshot: snapshot([{ ...avatar, role: 'master' }], avatar.id) })),
  remove: vi.fn(async () => ({ ok: true as const, snapshot: snapshot(), removedId: avatar.id })),
  preview: vi.fn(async () => ({ ok: true as const, id: avatar.id, dataUrl: 'data:image/png;base64,AA==' })),
  materializeForFlow: vi.fn(async () => ({
    ok: true as const,
    id: avatar.id,
    name: avatar.name,
    path: '/workspace/.codebuddy/media-generation/images/avatar.png',
    url: 'file:///workspace/.codebuddy/media-generation/images/avatar.png',
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { avatarBible: api },
  });
});

afterEach(cleanup);

describe('AvatarBiblePanel', () => {
  it('explains the private empty state and imports metadata through the native-dialog bridge', async () => {
    api.list.mockResolvedValueOnce({ ok: true, snapshot: snapshot() });
    render(<AvatarBiblePanel />);
    expect((await screen.findByTestId('avatar-bible-empty')).textContent).toMatch(/mémoire visuelle/iu);
    expect(screen.getByText(/aucun enrôlement facial ni embedding biométrique/iu)).toBeTruthy();

    fireEvent.click(screen.getByTestId('avatar-bible-import-open'));
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Buddy principal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choisir l’image' }));
    await waitFor(() => expect(api.importImage).toHaveBeenCalledWith({
      name: 'Buddy principal',
      role: 'front',
      rights: 'owned',
      consent: 'not-applicable',
      notes: '',
    }));
  });

  it('sets a master, materializes a safe Flow copy, and confirms removal', async () => {
    const onUseAsset = vi.fn();
    render(<AvatarBiblePanel onUseAsset={onUseAsset} />);
    expect(await screen.findByText('Buddy cyan')).toBeTruthy();
    expect(api.preview).toHaveBeenCalledWith({ id: avatar.id });

    fireEvent.click(screen.getByRole('button', { name: /définir Buddy cyan comme avatar maître/iu }));
    await waitFor(() => expect(api.setMaster).toHaveBeenCalledWith({ id: avatar.id }));

    fireEvent.click(screen.getByRole('button', { name: /utiliser Buddy cyan dans Flow/iu }));
    await waitFor(() => expect(api.materializeForFlow).toHaveBeenCalledWith({ id: avatar.id }));
    expect(onUseAsset).toHaveBeenCalledWith(expect.objectContaining({
      id: avatar.id,
      path: expect.stringContaining('.codebuddy/media-generation/images'),
    }));

    fireEvent.click(screen.getByRole('button', { name: /supprimer Buddy cyan/iu }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirmer la suppression de Buddy cyan/iu }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ id: avatar.id }));
  });

  it('caps eager full-resolution previews to 24 files and 24 MiB, prioritizing the master', () => {
    const entries = Array.from({ length: 40 }, (_, index): AvatarBibleEntry => ({
      ...avatar,
      id: `${String(index).padStart(8, '0')}-83ca-4b26-8bc2-b21ece813c4b`,
      name: `Avatar ${index}`,
      bytes: 2 * 1024 * 1024,
    }));
    const master = entries[39]!;
    const selected = selectPreviewAvatars(snapshot(entries, master.id));
    expect(selected).toHaveLength(12);
    expect(selected[0]?.id).toBe(master.id);
    expect(selected.reduce((total, item) => total + item.bytes, 0)).toBe(24 * 1024 * 1024);
  });
});
