// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoStudioView } from '../src/renderer/components/videostudio/VideoStudioView';

function installApi(options: { withCharacter?: boolean; longCat?: boolean } = {}) {
  const media = {
    capabilities: vi.fn(async () => ({
      imageGeneration: true,
      imageReferences: true,
      videoGeneration: true,
      videoReferences: true,
      firstFrame: true,
      lastFrame: false,
      audio: true,
      provider: 'test',
      model: 'test-video',
    })),
    generateVideo: vi.fn(async () => ({ ok: false, error: 'cinematic unavailable' })),
  };
  const film = {
    produce: vi.fn(async () => ({ ok: true, filmPath: '/workspace/film.mp4', url: 'file:///workspace/film.mp4' })),
    onProgress: vi.fn(() => () => undefined),
  };
  const gpuMedia = {
    capabilities: vi.fn(async () => ({
      protocolVersion: 1 as const,
      workerId: 'darkstar',
      jobs: options.longCat ? ['avatar_video_render' as const] : [],
    })),
    submitAvatar: vi.fn(async () => ({ id: 'gpu-longcat-1', kind: 'avatar_video_render' as const, status: 'running' as const })),
    status: vi.fn(async () => ({ id: 'gpu-longcat-1', kind: 'avatar_video_render' as const, status: 'cancelled' as const })),
    cancel: vi.fn(async () => ({ id: 'gpu-longcat-1', kind: 'avatar_video_render' as const, status: 'cancelled' as const })),
    materialize: vi.fn(),
  };
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      media,
      film,
      gpuMedia,
      creativeAssets: {
        list: vi.fn(async () => ({
          ok: true,
          assets: options.withCharacter ? [{
            id: 'mysoulmate:lisa-main',
            name: 'Lisa',
            kind: 'image',
            source: 'mysoulmate',
            url: 'file:///catalog/lisa.png',
            size: 8,
            mtimeMs: 1,
            contentTier: 'safe',
            qaStatus: 'approved',
            companionId: 'lisa',
          }] : [],
        })),
      },
    },
  });
  return { film, gpuMedia, media };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VideoStudioView generation routing', () => {
  it('does not turn a failed scene render into a multi-scene film fallback', async () => {
    const { film, media } = installApi();
    render(<VideoStudioView />);
    fireEvent.change(screen.getByTestId('flow-prompt'), { target: { value: 'Une scène vidéo originale dans Paris.' } });
    fireEvent.click(screen.getByTestId('flow-generate'));

    expect(await screen.findByText('cinematic unavailable')).toBeTruthy();
    expect(media.generateVideo).toHaveBeenCalledOnce();
    expect(film.produce).not.toHaveBeenCalled();
  });

  it('cancels the exact LongCat job and never starts a provider fallback', async () => {
    vi.useFakeTimers();
    const { film, gpuMedia, media } = installApi({ withCharacter: true, longCat: true });
    render(<VideoStudioView />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByTestId('flow-ingredient-mysoulmate:lisa-main'));
    fireEvent.click(screen.getByLabelText('Voix cohérente (LongCat)'));
    fireEvent.change(screen.getByTestId('flow-voice-profile'), { target: { value: 'lisa-fr-v1' } });
    fireEvent.change(screen.getByTestId('flow-prompt'), { target: { value: 'Lisa sourit face caméra dans un café lumineux.' } });
    fireEvent.click(screen.getByTestId('flow-generate'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    fireEvent.click(screen.getByTestId('flow-cancel-longcat'));
    await act(async () => { await Promise.resolve(); });
    expect(gpuMedia.cancel).toHaveBeenCalledWith('gpu-longcat-1');

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(gpuMedia.status).toHaveBeenCalledWith('gpu-longcat-1');
    expect(media.generateVideo).not.toHaveBeenCalled();
    expect(film.produce).not.toHaveBeenCalled();
    expect(screen.getByTestId('flow-notice').textContent).toMatch(/annul/iu);
  });
});
