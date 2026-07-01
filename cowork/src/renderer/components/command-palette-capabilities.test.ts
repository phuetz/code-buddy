import { describe, it, expect, vi } from 'vitest';
import { CAPABILITY_COMMANDS } from './command-palette-capabilities';
import type { AppState } from '../store';

/**
 * The ⌘K palette is the new shell's only universal navigation surface (no TopMenuBar). These tests
 * guard that (a) every key capability has an entry, (b) ids/labels are unique, and (c) each entry's
 * `run` fires exactly one store setter — so a wiring typo (wrong or missing setter) is caught here,
 * not by the user staring at a dead menu item.
 */
describe('CAPABILITY_COMMANDS', () => {
  it('covers every key capability of Code Buddy', () => {
    const ids = new Set(CAPABILITY_COMMANDS.map((c) => c.id));
    const mustHave = [
      'cap-fleet',
      'cap-autonomy',
      'cap-missions',
      'cap-workflows',
      'cap-evolution',
      'cap-memory',
      'cap-research',
      'cap-companion',
      'cap-channels',
      'cap-devices',
      'cap-global-search',
    ];
    for (const id of mustHave) {
      expect(ids.has(id), `missing capability ${id}`).toBe(true);
    }
    // A meaningful backstop — not just the handful above.
    expect(CAPABILITY_COMMANDS.length).toBeGreaterThanOrEqual(25);
  });

  it('has unique ids and non-empty labels/descriptions', () => {
    const ids = CAPABILITY_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAPABILITY_COMMANDS) {
      expect(c.label.trim().length).toBeGreaterThan(0);
      expect(c.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('each run() fires exactly one store setter with true', () => {
    for (const c of CAPABILITY_COMMANDS) {
      // A recording proxy: any setShow* access returns a spy; anything else throws so we notice a
      // capability that reaches for non-setter state.
      const calls: Array<{ name: string; arg: unknown }> = [];
      const fakeStore = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (typeof prop === 'string' && prop.startsWith('setShow')) {
              return (arg: unknown) => calls.push({ name: prop, arg });
            }
            throw new Error(`${c.id} touched non-setter store member: ${String(prop)}`);
          },
        },
      ) as unknown as AppState;

      c.run(fakeStore);
      expect(calls.length, `${c.id} should fire exactly one setter`).toBe(1);
      expect(calls[0]!.name).toMatch(/^setShow/);
      expect(calls[0]!.arg).toBe(true);
    }
  });

  it('run is a plain function that does not throw', () => {
    const noop = new Proxy(
      {},
      { get: () => vi.fn() },
    ) as unknown as AppState;
    for (const c of CAPABILITY_COMMANDS) {
      expect(() => c.run(noop)).not.toThrow();
    }
  });
});
