/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GpuMediaAdminPanel } from './GpuMediaAdminPanel';
import type { GpuMediaJobView } from '../../../shared/gpu-media-admin';

const queuedPano: GpuMediaJobView = {
  id: 'gpu-pano-1',
  kind: 'panoworld_reconstruct',
  status: 'queued',
  progress: 0,
};

const succeededPano: GpuMediaJobView = {
  ...queuedPano,
  id: 'gpu-pano-done',
  status: 'succeeded',
  progress: 1,
  output: { plyPath: 'D:\\results\\point_cloud.ply' },
};

function makeApi() {
  return {
    gpuMedia: {
      capabilities: vi.fn().mockResolvedValue({
        protocolVersion: 1,
        workerId: 'gpuNode-test',
        jobs: ['panoworld_reconstruct', 'avatar_video_render'],
        queueDepth: 0,
        gpus: [{ name: 'RTX 3090', vramMb: 24_576, busy: false }],
      }),
      submit: vi.fn().mockResolvedValue(queuedPano),
      status: vi.fn().mockResolvedValue(succeededPano),
      cancel: vi.fn().mockResolvedValue({ ...queuedPano, status: 'cancelled' }),
      download: vi.fn().mockResolvedValue({
        ok: true,
        format: 'json',
        path: '/tmp/panoworld.json',
      }),
    },
    selectFiles: vi.fn().mockResolvedValue([]),
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('GpuMediaAdminPanel', () => {
  it('submits the bounded single-2048 form and cancels the queued job', async () => {
    const api = makeApi();
    (window as unknown as { electronAPI: unknown }).electronAPI = api;
    render(<GpuMediaAdminPanel />);

    expect(await screen.findByText(/gpuNode-test/)).toBeTruthy();
    fireEvent.change(screen.getByTestId('gpu-scene-id'), { target: { value: 'kitchen' } });
    fireEvent.change(screen.getByTestId('gpu-room-id'), { target: { value: 'living-room' } });
    fireEvent.change(screen.getByTestId('gpu-image-path'), {
      target: { value: 'D:\\captures\\kitchen.jpg' },
    });
    fireEvent.change(screen.getByTestId('gpu-output-dir'), {
      target: { value: 'D:\\results' },
    });
    fireEvent.click(screen.getByTestId('gpu-submit'));

    await waitFor(() =>
      expect(api.gpuMedia.submit).toHaveBeenCalledWith({
        kind: 'panoworld_reconstruct',
        sceneId: 'kitchen',
        roomId: 'living-room',
        imagePath: 'D:\\captures\\kitchen.jpg',
        outputDir: 'D:\\results',
      })
    );
    expect(await screen.findByTestId('gpu-job-detail')).toBeTruthy();
    fireEvent.click(screen.getByTestId('gpu-cancel'));
    await waitFor(() => expect(api.gpuMedia.cancel).toHaveBeenCalledWith('gpu-pano-1'));
  });

  it('restores an existing job and exports its PanoWorld manifest', async () => {
    const api = makeApi();
    (window as unknown as { electronAPI: unknown }).electronAPI = api;
    render(<GpuMediaAdminPanel />);

    fireEvent.change(screen.getByTestId('gpu-existing-id'), {
      target: { value: 'gpu-pano-done' },
    });
    fireEvent.click(screen.getByTestId('gpu-existing-add'));

    await waitFor(() =>
      expect(screen.getByTestId('gpu-job-output').textContent).toContain('point_cloud.ply')
    );
    fireEvent.click(screen.getByTestId('gpu-download'));
    await waitFor(() => expect(api.gpuMedia.download).toHaveBeenCalledWith('gpu-pano-done'));
    expect(await screen.findByText(/Manifeste PanoWorld enregistré/)).toBeTruthy();
  });
});
