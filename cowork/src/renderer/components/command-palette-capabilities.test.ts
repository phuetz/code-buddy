import { describe, it, expect } from 'vitest';
import { CAPABILITY_COMMANDS } from './command-palette-capabilities';
import { useAppStore } from '../store';

/**
 * The ⌘K palette is the new shell's only universal navigation surface (no TopMenuBar). These tests
 * guard that (a) every key capability has an entry, (b) ids/labels are unique, and (c) each entry's
 * `run` flips exactly one real store `show*` flag to true — so a wiring typo (wrong/missing setter)
 * is caught here, against the REAL store, not by the user staring at a dead menu item.
 *
 * NOTE — what this does NOT prove: that a *panel* reads the flipped flag and is mounted where the new
 * shell renders it. That mount-liveness was verified manually against App.tsx / DockWorkspace (the
 * hosts NewShell renders): most panels are mounted globally in App.tsx; autonomy/reasoning-trace dock
 * into the chat workspace, so their entries also switch primaryView to 'chat' (asserted below) to
 * avoid opening into a hidden subtree; and the previously-dead `showWorkflowProPanel` flag was given
 * a mounted overlay reader in App.tsx as part of this change.
 */

/** All boolean `show*` flags on the live store — the universe a capability may flip. */
function showFlags(): string[] {
  const s = useAppStore.getState() as unknown as Record<string, unknown>;
  return Object.keys(s).filter((k) => k.startsWith('show') && typeof s[k] === 'boolean');
}

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

  it('each run() flips exactly one real store show-flag to true (or navigates to a primary view)', () => {
    // Capabilities whose action IS the navigation — they switch primaryView instead of
    // opening an overlay, so no show-flag must flip.
    const viewSwitchers: Record<string, string> = { 'cap-creations': 'creations' };
    const flags = showFlags();
    expect(flags.length).toBeGreaterThan(20); // sanity: the store really exposes show* flags
    for (const c of CAPABILITY_COMMANDS) {
      // Reset every show-flag to false, then run the capability and see which one it turns on.
      const reset: Record<string, boolean> = {};
      for (const f of flags) reset[f] = false;
      useAppStore.setState(reset as never);
      useAppStore.getState().setPrimaryView('chat');

      c.run(useAppStore.getState());

      const after = useAppStore.getState() as unknown as Record<string, boolean>;
      const flipped = flags.filter((f) => after[f] === true);
      const expectedView = viewSwitchers[c.id];
      if (expectedView) {
        expect(flipped, `${c.id} is a view switcher — it must not open an overlay`).toHaveLength(0);
        expect(useAppStore.getState().primaryView, `${c.id} should navigate to ${expectedView}`).toBe(expectedView);
      } else {
        expect(flipped, `${c.id} should flip exactly one show-flag (flipped: ${flipped.join(',') || 'none'})`).toHaveLength(1);
      }
    }
  });

  it('chat-docked capabilities switch primaryView to chat so they are not opened into a hidden view', () => {
    const dockedIntoChat = ['cap-autonomy', 'cap-reasoning-trace'];
    for (const id of dockedIntoChat) {
      const cmd = CAPABILITY_COMMANDS.find((c) => c.id === id);
      expect(cmd, `expected capability ${id}`).toBeDefined();
      useAppStore.getState().setPrimaryView('advanced');
      cmd!.run(useAppStore.getState());
      expect(useAppStore.getState().primaryView, `${id} should force the chat view`).toBe('chat');
    }
  });
});
