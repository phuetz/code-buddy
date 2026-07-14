import { describe, expect, it, vi } from 'vitest';
import { CognitiveMesh } from '../../src/cognition/cognitive-mesh.js';
import { GlobalWorkspace } from '../../src/cognition/global-workspace.js';
import {
  isLoopbackCognitiveRoute,
  registerDefaultVoiceSpecialists,
} from '../../src/cognition/voice-specialists.js';

describe('voice cognitive specialists', () => {
  it('fails closed for non-loopback inference routes', () => {
    const mesh = new CognitiveMesh(new GlobalWorkspace());
    const registration = registerDefaultVoiceSpecialists(mesh, {
      apiKey: 'secret', model: 'cloud-model', baseURL: 'https://api.example.com/v1',
    });
    expect(registration).toMatchObject({ enabled: false, reason: 'route-not-loopback' });
    expect(mesh.metrics()).toEqual([]);
  });

  it('creates independent persistent clients for local roles', () => {
    const mesh = new CognitiveMesh(new GlobalWorkspace());
    const factory = vi.fn(() => ({ chat: vi.fn() }));
    const registration = registerDefaultVoiceSpecialists(
      mesh,
      { apiKey: 'ollama', model: 'qwen', baseURL: 'http://127.0.0.1:11434/v1' },
      { clientFactory: factory },
    );
    expect(registration.enabled).toBe(true);
    expect(registration.specialistIds).toEqual(['conversation-reflector', 'conversation-critic']);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(mesh.metrics().map((metric) => metric.id)).toEqual(registration.specialistIds);
  });

  it('recognizes only explicit loopback hosts as private local inference', () => {
    expect(isLoopbackCognitiveRoute('http://localhost:11434/v1')).toBe(true);
    expect(isLoopbackCognitiveRoute('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLoopbackCognitiveRoute('http://192.168.1.20:11434/v1')).toBe(false);
    expect(isLoopbackCognitiveRoute('gemini-cli://local')).toBe(false);
  });
});
