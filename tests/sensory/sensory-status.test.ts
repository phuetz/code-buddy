/**
 * Sensory status snapshot writer — hermetic, isolated file, no running server.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { FALLBACK_HEARTBEAT_SOURCE } from '../../src/sensory/heartbeat-fallback.js';
import {
  flagsFromEnv,
  readSensoryStatusSnapshot,
  wireSensoryStatusSnapshot,
} from '../../src/sensory/sensory-status.js';

const QA = join(process.cwd(), '_qa/grok-v2/sensory-status-snap');
const SNAP = join(QA, 'sensory-status.json');

let unwire: (() => void) | undefined;
const originalFile = process.env.CODEBUDDY_SENSORY_STATUS_FILE;

beforeEach(async () => {
  await rm(QA, { recursive: true, force: true });
  await mkdir(QA, { recursive: true });
  process.env.CODEBUDDY_SENSORY_STATUS_FILE = SNAP;
  delete process.env.CODEBUDDY_SENSORY;
  delete process.env.CODEBUDDY_SYSTEM_VITALS;
  delete process.env.CODEBUDDY_SCHEDULE_TICKS;
  delete process.env.CODEBUDDY_DOMAIN_EVENTS;
  delete process.env.CODEBUDDY_SENSORY_RULES;
  delete process.env.CODEBUDDY_HEARTBEAT_FALLBACK;
});

afterEach(async () => {
  unwire?.();
  unwire = undefined;
  if (originalFile === undefined) delete process.env.CODEBUDDY_SENSORY_STATUS_FILE;
  else process.env.CODEBUDDY_SENSORY_STATUS_FILE = originalFile;
  await rm(QA, { recursive: true, force: true });
});

describe('sensory-status snapshot', () => {
  it('flagsFromEnv are all false when unset (byte-identical default)', () => {
    expect(flagsFromEnv({})).toEqual({
      SENSORY: false,
      SYSTEM_VITALS: false,
      SCHEDULE_TICKS: false,
      DOMAIN_EVENTS: false,
      RULES: false,
      HEARTBEAT_FALLBACK: false,
    });
  });

  it('records rust vs fallback heartbeats and keeps the last 5 system/time percepts', () => {
    unwire = wireSensoryStatusSnapshot({
      treatments: [{ name: 'system-vitals', everyBeats: 30 }],
      flags: {
        SENSORY: true,
        SYSTEM_VITALS: true,
        SCHEDULE_TICKS: false,
        DOMAIN_EVENTS: false,
        RULES: false,
        HEARTBEAT_FALLBACK: true,
      },
      pid: process.pid,
      path: SNAP,
    });
    const bus = getGlobalEventBus();
    bus.emit('sensory:perception', {
      source: 'buddy-sense',
      metadata: { modality: 'vital', kind: 'heartbeat', payload: { beat: 4 } },
    });
    let snap = readSensoryStatusSnapshot(SNAP);
    expect(snap?.heartbeat.source).toBe('rust');
    expect(snap?.heartbeat.beat).toBe(4);
    expect(snap?.treatments).toEqual([{ name: 'system-vitals', everyBeats: 30 }]);

    bus.emit('sensory:perception', {
      source: FALLBACK_HEARTBEAT_SOURCE,
      metadata: { modality: 'vital', kind: 'heartbeat', payload: { beat: 5 } },
    });
    snap = readSensoryStatusSnapshot(SNAP);
    expect(snap?.heartbeat.source).toBe('fallback');
    expect(snap?.heartbeat.beat).toBe(5);

    for (let i = 0; i < 7; i++) {
      bus.emit('sensory:perception', {
        source: 'system-vitals',
        metadata: { modality: 'system', kind: 'resource_threshold', payload: { n: i } },
      });
    }
    bus.emit('sensory:perception', {
      source: 'schedule',
      metadata: { modality: 'time', kind: 'tick', payload: { hhmm: '04:21' } },
    });
    // audio must not enter the ring
    bus.emit('sensory:perception', {
      source: 'buddy-sense',
      metadata: { modality: 'audio', kind: 'speech_end', payload: {} },
    });
    snap = readSensoryStatusSnapshot(SNAP);
    expect(snap?.recent).toHaveLength(5);
    expect(snap?.recent.map((p) => p.payload)).toEqual([
      { n: 3 },
      { n: 4 },
      { n: 5 },
      { n: 6 },
      { hhmm: '04:21' },
    ]);
    expect(snap?.recent[4]).toMatchObject({ modality: 'time', kind: 'tick' });
  });
});
