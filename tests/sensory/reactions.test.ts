import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { logger } from '../../src/utils/logger.js';
import { getSensoryMemory } from '../../src/sensory/sensory-memory.js';
import { shouldWireSpeechReaction, wireSensoryReactions } from '../../src/sensory/reactions.js';

afterEach(() => {
  vi.restoreAllMocks();
  getSensoryMemory().drain();
});

describe('shouldWireSpeechReaction — the speech security invariant', () => {
  it('requires both the opt-in and a non-empty shared token', () => {
    expect(shouldWireSpeechReaction({ speech: 'true', token: 'secret' })).toBe(true);
    expect(shouldWireSpeechReaction({ speech: 'true', token: undefined })).toBe(false);
    expect(shouldWireSpeechReaction({ speech: 'true', token: '' })).toBe(false);
    expect(shouldWireSpeechReaction({ speech: 'false', token: 'secret' })).toBe(false);
    expect(shouldWireSpeechReaction({ token: 'secret' })).toBe(false);
  });
});

describe('wireSensoryReactions logging', () => {
  it('keeps low-salience heartbeat noise at debug and salient events at info', () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const unwire = wireSensoryReactions();
    const bus = getGlobalEventBus();
    try {
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: { modality: 'vital', kind: 'heartbeat', salience: 12 },
      });
      expect(debug).toHaveBeenCalledWith('[sensory] vital/heartbeat (salience 12)');
      expect(info).not.toHaveBeenCalled();

      bus.emit('sensory:perception', {
        source: 'test',
        metadata: { modality: 'vision', kind: 'motion', salience: 180 },
      });
      expect(info).toHaveBeenCalledWith('[sensory] vision/motion (salience 180)');
    } finally {
      unwire();
    }
  });
});
