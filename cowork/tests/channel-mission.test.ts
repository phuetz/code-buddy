import { describe, expect, it } from 'vitest';

import { validateAssignment } from '../src/renderer/utils/channel-mission';

describe('validateAssignment', () => {
  it('accepts a complete assignment', () => {
    expect(validateAssignment({ channelId: 'slack', goal: 'Surveille les leads', posture: 'auto' })).toEqual({ ok: true });
  });

  it('requires a channel', () => {
    expect(validateAssignment({ channelId: '', goal: 'Surveille les leads', posture: 'auto' })).toEqual({
      ok: false,
      error: 'channel_required',
    });
  });

  it('requires a meaningful goal', () => {
    expect(validateAssignment({ channelId: 'slack', goal: 'go', posture: 'auto' })).toEqual({
      ok: false,
      error: 'goal_too_short',
    });
  });
});
