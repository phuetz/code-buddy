// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowSceneTimeline } from '../src/renderer/components/videostudio/FlowSceneTimeline';
import type { FlowScene } from '../src/renderer/components/videostudio/flow-studio-model';

afterEach(cleanup);

function videoScene(id: string, path: string, youtubeMetadataPath?: string): FlowScene {
  return {
    id,
    title: id,
    prompt: id,
    durationSeconds: 6,
    status: 'done',
    mediaType: 'video',
    path,
    ...(youtubeMetadataPath ? { youtubeMetadataPath } : {}),
  };
}

describe('FlowSceneTimeline', () => {
  it('does not count an assembled master as a source clip', () => {
    const onAssemble = vi.fn();
    render(<FlowSceneTimeline
      scenes={[
        videoScene('source', '/workspace/videos/source.mp4'),
        videoScene('master', '/workspace/films/master.mp4', '/workspace/films/master.mp4.youtube.json'),
      ]}
      selectedId="source"
      onSelect={vi.fn()}
      onAdd={vi.fn()}
      onExtend={vi.fn()}
      onExportAll={vi.fn()}
      onAssemble={onAssemble}
    />);

    expect((screen.getByTestId('flow-assemble') as HTMLButtonElement).disabled).toBe(true);
    expect(onAssemble).not.toHaveBeenCalled();
  });
});
