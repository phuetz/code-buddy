import { describe, it, expect, afterEach } from 'vitest';
import { CanvasStore, MAX_CANVAS_SNAPSHOTS } from '../../src/server/routes/canvas.js';

describe('CanvasStore Bounded Memory', () => {
  const originalEnv = process.env.CODEBUDDY_CANVAS_MAX_SNAPSHOTS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CODEBUDDY_CANVAS_MAX_SNAPSHOTS;
    } else {
      process.env.CODEBUDDY_CANVAS_MAX_SNAPSHOTS = originalEnv;
    }
  });

  it('should evict the oldest snapshots beyond MAX_CANVAS_SNAPSHOTS', () => {
    const store = new CanvasStore();
    const ids: string[] = [];

    // Push MAX + 20 snapshots
    const totalToPush = MAX_CANVAS_SNAPSHOTS + 20;
    for (let i = 0; i < totalToPush; i++) {
      const snap = store.push(`<html>${i}</html>`);
      ids.push(snap.id);
    }

    // Verify limit
    const list = store.list();
    expect(list.length).toBe(MAX_CANVAS_SNAPSHOTS);

    // Verify the first 20 are gone
    for (let i = 0; i < 20; i++) {
      expect(store.get(ids[i])).toBeUndefined();
    }

    // Verify the last is current
    const current = store.getCurrent();
    expect(current?.id).toBe(ids[ids.length - 1]);
  });

  it('should fallback to default limit on invalid environment variables', () => {
    const invalidValues = ['abc', '0', '-3', '2garbage', '1.5'];

    for (const val of invalidValues) {
      process.env.CODEBUDDY_CANVAS_MAX_SNAPSHOTS = val;
      const store = new CanvasStore();

      for (let i = 0; i < MAX_CANVAS_SNAPSHOTS + 5; i++) {
        store.push(`<html>${i}</html>`);
      }

      expect(store.list().length).toBe(MAX_CANVAS_SNAPSHOTS);
    }
  });

  it('reset() should clear the list of snapshots', () => {
    const store = new CanvasStore();
    store.push('<html>1</html>');
    store.push('<html>2</html>');

    expect(store.list().length).toBe(2);

    store.reset();

    expect(store.list().length).toBe(0);
    expect(store.getCurrent()).toBeNull();
  });

  it('honours a smaller configured bound and keeps the current snapshot', () => {
    process.env.CODEBUDDY_CANVAS_MAX_SNAPSHOTS = '1';
    const store = new CanvasStore();
    const first = store.push('<html>first</html>');
    const second = store.push('<html>second</html>');
    expect(store.get(first.id)).toBeUndefined();
    expect(store.list().map(snapshot => snapshot.id)).toEqual([second.id]);
    expect(store.getCurrent()?.id).toBe(second.id);
  });
});
