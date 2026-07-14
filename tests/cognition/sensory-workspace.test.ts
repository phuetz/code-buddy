import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wireSensoryWorkspace } from '../../src/cognition/sensory-workspace.js';
import { getGlobalEventBus, resetEventBus } from '../../src/events/event-bus.js';

describe('sensory cognitive workspace shadow adapter', () => {
  beforeEach(() => resetEventBus());
  afterEach(() => resetEventBus());

  it('publishes only safe local metadata and derives deterministic world facts', async () => {
    const cognition = wireSensoryWorkspace();
    try {
      getGlobalEventBus().emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_entered',
          salience: 200,
          payload: {
            imagePath: '/private/camera/frame.jpg',
            base64: 'secret-image',
            transcript: 'private words',
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const items = cognition.workspace.snapshot();
      expect(items.map((item) => item.kind)).toEqual(expect.arrayContaining(['percept', 'fact']));
      expect(items.every((item) => item.privacy === 'local-only')).toBe(true);
      const serialized = JSON.stringify(items);
      expect(serialized).not.toContain('/private/camera');
      expect(serialized).not.toContain('secret-image');
      expect(serialized).not.toContain('private words');
      expect(serialized).toContain('"visibility":"visible"');
    } finally {
      cognition.close();
    }
  });
});
