/**
 * FleetRegistry tests — Phase (d).17.
 *
 * Verifies the singleton registry promoted from fleet-handler.ts:
 * - getFleetRegistry() returns the same instance
 * - register / get / has / unregister / size / list / ids / clear
 * - _resetFleetRegistryForTests gives a fresh instance on next call
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';

function makeStubListener(): FleetListenerPublicAPI {
  return {
    disconnect: async () => undefined,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request: async () => ({}),
    getLastSeen: () => ({ at: null, reason: null, ageMs: null }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    }),
    getEventHistory: () => [],
  };
}

function makeEntry(id: string, url = `ws://example/${id}`): ActiveListenerEntry {
  return {
    id,
    url,
    startedAt: new Date(),
    eventCount: 0,
    autoReconnect: false,
    maxAttempts: 5,
    listener: makeStubListener(),
  };
}

describe('FleetRegistry', () => {
  beforeEach(() => {
    _resetFleetRegistryForTests();
  });

  it('is a singleton', () => {
    const a = getFleetRegistry();
    const b = getFleetRegistry();
    expect(a).toBe(b);
  });

  it('starts empty', () => {
    const reg = getFleetRegistry();
    expect(reg.size()).toBe(0);
    expect(reg.list()).toEqual([]);
    expect(reg.ids()).toEqual([]);
  });

  it('register/get/has', () => {
    const reg = getFleetRegistry();
    const entry = makeEntry('gpuNode');
    reg.register(entry);
    expect(reg.size()).toBe(1);
    expect(reg.has('gpuNode')).toBe(true);
    expect(reg.has('ministar')).toBe(false);
    expect(reg.get('gpuNode')).toBe(entry);
    expect(reg.get('ministar')).toBeUndefined();
  });

  it('register replaces an existing entry with the same id', () => {
    const reg = getFleetRegistry();
    const a = makeEntry('peer', 'ws://a');
    const b = makeEntry('peer', 'ws://b');
    reg.register(a);
    reg.register(b);
    expect(reg.size()).toBe(1);
    expect(reg.get('peer')).toBe(b);
  });

  it('unregister returns true on hit, false on miss', () => {
    const reg = getFleetRegistry();
    reg.register(makeEntry('gpuNode'));
    expect(reg.unregister('gpuNode')).toBe(true);
    expect(reg.unregister('gpuNode')).toBe(false);
    expect(reg.size()).toBe(0);
  });

  it('list and ids reflect registration order', () => {
    const reg = getFleetRegistry();
    reg.register(makeEntry('a'));
    reg.register(makeEntry('b'));
    reg.register(makeEntry('c'));
    expect(reg.ids()).toEqual(['a', 'b', 'c']);
    expect(reg.list().map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('clear empties the registry', () => {
    const reg = getFleetRegistry();
    reg.register(makeEntry('a'));
    reg.register(makeEntry('b'));
    reg.clear();
    expect(reg.size()).toBe(0);
    expect(reg.list()).toEqual([]);
  });

  it('_resetFleetRegistryForTests gives a fresh singleton', () => {
    const a = getFleetRegistry();
    a.register(makeEntry('peer'));
    expect(a.size()).toBe(1);
    _resetFleetRegistryForTests();
    const b = getFleetRegistry();
    expect(b).not.toBe(a);
    expect(b.size()).toBe(0);
  });
});
