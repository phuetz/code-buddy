// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionAvatarRendererStatus } from '../src/renderer/components/companion/CompanionAvatarRendererStatus';
import type { CompanionAvatarRendererSnapshot } from '../src/shared/avatar-renderer';

const READY: CompanionAvatarRendererSnapshot = {
  generatedAt: '2026-07-14T12:00:00.000Z',
  bridgeEnabled: true,
  audioPolicy: 'auto',
  audioStreamingActive: true,
  connectedCount: 1,
  readyCount: 1,
  renderers: [
    {
      rendererId: 'darkstar-metahuman-lisa',
      displayName: 'Lisa MetaHuman on Darkstar',
      protocolVersion: 1,
      runtime: 'unreal',
      runtimeVersion: '5.8',
      project: 'D:/DEV/AvatarStudio',
      capabilities: {
        audioDrivenAnimation: true,
        wavStream: true,
        affect: true,
        gestures: true,
        gaze: true,
        interruptionAck: true,
      },
      phase: 'playing',
      lastSequence: 41,
      fps: 59.7,
      audioBufferMs: 80,
      mouthLatencyMs: 73,
      droppedAudioChunks: 0,
      connected: true,
      connectedAt: '2026-07-14T11:59:00.000Z',
      lastSeenAt: '2026-07-14T12:00:00.000Z',
    },
  ],
  privacy: {
    textIncluded: false,
    audioIncluded: false,
    connectionCredentialsIncluded: false,
  },
};

describe('CompanionAvatarRendererStatus', () => {
  it('shows evidence-backed MetaHuman readiness and bounded telemetry', () => {
    const { container } = render(
      <CompanionAvatarRendererStatus snapshot={READY} />,
    );

    expect(screen.getByText('voix → visage active')).toBeTruthy();
    expect(screen.getByText('Lisa MetaHuman on Darkstar')).toBeTruthy();
    expect(screen.getByText('prouvée')).toBeTruthy();
    expect(screen.getByText('60 fps')).toBeTruthy();
    expect(screen.getByText('73 ms')).toBeTruthy();
    expect(container.textContent).not.toContain('PRIVATE_TRANSCRIPT');
  });

  it('keeps animation honestly locked when no Unreal renderer is connected', () => {
    render(
      <CompanionAvatarRendererStatus
        snapshot={{
          ...READY,
          audioStreamingActive: false,
          connectedCount: 0,
          readyCount: 0,
          renderers: [],
        }}
      />,
    );

    expect(screen.getByText('voix → visage en attente')).toBeTruthy();
    expect(screen.getByText('Aucun renderer Unreal connecté')).toBeTruthy();
    expect(screen.getByText(/Audio Live Link soit réellement validé/)).toBeTruthy();
  });

  it('surfaces bridge failures instead of inventing renderer state', () => {
    render(
      <CompanionAvatarRendererStatus
        snapshot={null}
        error="core avatar renderer registry unavailable"
      />,
    );

    expect(screen.getByText('core avatar renderer registry unavailable')).toBeTruthy();
    expect(screen.queryByText('voix → visage active')).toBeNull();
  });
});
