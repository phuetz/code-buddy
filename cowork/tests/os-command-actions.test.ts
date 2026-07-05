import { describe, expect, it } from 'vitest';

import { filterActions, osCommandActions } from '../src/renderer/components/os-actions/os-command-actions.js';

describe('os-command-actions', () => {
  it('returns all actions for an empty query', () => {
    expect(filterActions('')).toHaveLength(osCommandActions.length);
  });

  it('filters by label, category, id, or callback', () => {
    expect(filterActions('mission').map((action) => action.id)).toContain('mission.pause');
    expect(filterActions('onPeerPause')).toEqual([{ id: 'fleet.peer.pause', label: 'Mettre un pair en pause', category: 'fleet', callbackName: 'onPeerPause' }]);
  });
});
