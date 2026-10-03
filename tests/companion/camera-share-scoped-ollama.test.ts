import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  maybeHandleCameraShareRequest,
  resetCameraShareCooldown,
} from '../../src/companion/camera-share.js';

const clientArguments = vi.hoisted(() => vi.fn());

vi.mock('../../src/tools/image-input.js', () => ({
  loadImageFromFile: vi.fn(async () => ({ data: 'fake-frame' })),
  buildMultimodalContent: vi.fn(() => 'fake-content'),
}));
vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    constructor(...args: unknown[]) {
      clientArguments(...args);
    }

    async chat() {
      return { choices: [{ message: { content: 'Un bureau.' } }] };
    }
  },
}));

beforeEach(() => {
  resetCameraShareCooldown();
  clientArguments.mockClear();
});

describe('camera-share scoped Ollama endpoint', () => {
  it('passes the scoped endpoint to the default image analyzer', async () => {
    const result = await maybeHandleCameraShareRequest("qu'est-ce que tu vois ?", {
      env: {
        CODEBUDDY_VISION_MODEL: 'moondream',
        CODEBUDDY_VISION_REMOTE_IMAGE: 'false',
        OLLAMA_HOST: 'http://127.0.0.1:11435',
      },
      capture: async () => ({ success: true, path: '/tmp/fake-camera-frame.jpg' }),
    });

    expect(clientArguments).toHaveBeenCalledWith(
      'ollama', 'moondream', 'http://127.0.0.1:11435/v1',
    );
    expect(result?.spokenReply).toContain('Un bureau.');
  });
});
