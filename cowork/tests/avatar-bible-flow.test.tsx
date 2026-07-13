// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoStudioView } from '../src/renderer/components/videostudio/VideoStudioView';
import type { AvatarBibleEntry, AvatarBibleSnapshot } from '../src/shared/avatar-bible';
import type { ComfyLabSnapshot } from '../src/shared/comfy-lab';

const avatar: AvatarBibleEntry = {
  id: 'f65b8e2d-83ca-4b26-8bc2-b21ece813c4b',
  name: 'Buddy cyan',
  role: 'master',
  rights: 'owned',
  consent: 'not-applicable',
  sha256: 'a'.repeat(64),
  mime: 'image/png',
  bytes: 1024,
  width: 512,
  height: 512,
  createdAt: '2026-07-12T15:00:00.000Z',
  updatedAt: '2026-07-12T15:00:00.000Z',
};

const avatarSnapshot: AvatarBibleSnapshot = {
  schemaVersion: 1,
  revision: 1,
  updatedAt: avatar.updatedAt,
  masterId: avatar.id,
  avatars: [avatar],
  privacy: { projectScoped: true, containsFaceEmbeddings: false, note: 'private' },
};

const comfySnapshot: ComfyLabSnapshot = {
  schemaVersion: 1,
  generatedAt: avatar.updatedAt,
  installation: { found: false, source: 'none', reason: 'test' },
  probe: { state: 'unreachable', url: 'http://127.0.0.1:8188', cpuFallback: false, reason: 'test' },
  inventory: { modelFiles: 0, modelBytes: 0, templates: 0, nodes: 0, truncated: false },
  useCases: [],
  safety: { localOnly: true, implicitDownloads: false, implicitExecution: false, note: 'test' },
};

const media = {
  list: vi.fn(async () => []),
  capabilities: vi.fn(async () => ({
    imageGeneration: true,
    imageReferences: true,
    imageEditing: true,
    imageMasking: true,
    videoGeneration: true,
    videoReferences: true,
    firstFrame: true,
    lastFrame: false,
    audio: true,
    provider: 'comfyui',
    model: 'local',
  })),
  generateImage: vi.fn(async () => ({ ok: true, outputPath: '/generated/plain.png', url: 'file:///generated/plain.png' })),
  editImage: vi.fn(async () => ({ ok: true, outputPath: '/generated/avatar-edit.png', url: 'file:///generated/avatar-edit.png' })),
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      media,
      comfyLab: {
        inspect: vi.fn(async () => ({ ok: true, snapshot: comfySnapshot })),
        openComfyUi: vi.fn(),
        copyPlan: vi.fn(),
      },
      avatarBible: {
        list: vi.fn(async () => ({ ok: true, snapshot: avatarSnapshot })),
        preview: vi.fn(async () => ({ ok: true, id: avatar.id, dataUrl: 'data:image/png;base64,AA==' })),
        materializeForFlow: vi.fn(async () => ({
          ok: true,
          id: avatar.id,
          name: avatar.name,
          path: '/workspace/.codebuddy/media-generation/images/avatar-safe.png',
          url: 'file:///workspace/.codebuddy/media-generation/images/avatar-safe.png',
        })),
        importImage: vi.fn(),
        update: vi.fn(),
        setMaster: vi.fn(),
        remove: vi.fn(),
      },
    },
  });
});

afterEach(cleanup);

describe('Avatar Bible → Flow', () => {
  it('selects the materialized avatar as a character and uses image editing for identity-aware generation', async () => {
    render(<VideoStudioView />);
    fireEvent.click(screen.getByTestId('flow-comfy-lab-toggle'));
    expect(await screen.findByText('Buddy cyan')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /utiliser Buddy cyan dans Flow/iu }));

    const ingredient = await screen.findByTestId(`flow-ingredient-avatar-bible-${avatar.id}`);
    expect(ingredient.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('flow-prompt').getAttribute('value') ?? (screen.getByTestId('flow-prompt') as HTMLTextAreaElement).value).toMatch(/@Buddy cyan/iu);
    fireEvent.click(screen.getByTestId('flow-mode-image'));
    await waitFor(() => expect(screen.getByTestId('flow-capability-note').textContent).toMatch(/référence avatar/iu));
    fireEvent.click(screen.getByTestId('flow-generate'));

    await waitFor(() => expect(media.editImage).toHaveBeenCalledWith(expect.objectContaining({
      imagePath: '/workspace/.codebuddy/media-generation/images/avatar-safe.png',
      prompt: expect.stringMatching(/Buddy cyan/iu),
    })));
    expect(media.generateImage).not.toHaveBeenCalled();
  });
});
