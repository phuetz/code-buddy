/**
 * Automations IPC — a THIN bridge for administering the robot's behaviors (reminders +
 * triggerable sensory rules) from Cowork. It delegates every read/write to the CORE modules
 * (`companion/reminders.js` + `sensory/sensory-rules-engine.js`) via `loadCoreModule` — it does
 * NO JSON I/O of its own, so the GUI and the `buddy remind` / `buddy rules` CLI share one source
 * of truth (and the rules' hot-reload makes edits live on the running robot).
 *
 * @module main/ipc/automations-ipc
 */
import { ipcMain } from 'electron';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';

interface RemindersMod {
  listReminders(): Promise<Array<Record<string, unknown>>>;
  setReminderEnabled(id: string, enabled: boolean): Promise<unknown>;
  markDone(id: string, via: string): Promise<unknown>;
  removeReminder(id: string): Promise<boolean>;
}
interface RulesMod {
  listSensoryRules(): Promise<Array<Record<string, unknown>>>;
  toggleSensoryRule(id: string, enabled: boolean): Promise<boolean>;
  removeSensoryRule(id: string): Promise<boolean>;
  readRuleRuns(limit?: number): Promise<Array<Record<string, unknown>>>;
}

const loadReminders = () => loadCoreModule<RemindersMod>('companion/reminders.js');
const loadRules = () => loadCoreModule<RulesMod>('sensory/sensory-rules-engine.js');

export function registerAutomationsIpcHandlers(): void {
  ipcMain.handle('automations.list', async () => {
    try {
      const [rem, rules] = await Promise.all([loadReminders(), loadRules()]);
      return {
        ok: true as const,
        reminders: (await rem?.listReminders?.()) ?? [],
        rules: (await rules?.listSensoryRules?.()) ?? [],
        runs: (await rules?.readRuleRuns?.(20)) ?? [],
      };
    } catch (err) {
      logError('[automations.list] failed:', err);
      return { ok: false as const, error: String(err), reminders: [], rules: [], runs: [] };
    }
  });

  ipcMain.handle('automations.toggle', async (_e, kind: 'rule' | 'reminder', id: string, enabled: boolean) => {
    try {
      if (kind === 'rule') {
        const m = await loadRules();
        return { ok: Boolean(await m?.toggleSensoryRule?.(id, enabled)) };
      }
      const m = await loadReminders();
      return { ok: Boolean(await m?.setReminderEnabled?.(id, enabled)) };
    } catch (err) {
      logError('[automations.toggle] failed:', err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('automations.remove', async (_e, kind: 'rule' | 'reminder', id: string) => {
    try {
      if (kind === 'rule') {
        const m = await loadRules();
        return { ok: Boolean(await m?.removeSensoryRule?.(id)) };
      }
      const m = await loadReminders();
      return { ok: Boolean(await m?.removeReminder?.(id)) };
    } catch (err) {
      logError('[automations.remove] failed:', err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('automations.reminderDone', async (_e, id: string) => {
    try {
      const m = await loadReminders();
      return { ok: Boolean(await m?.markDone?.(id, 'cli')) };
    } catch (err) {
      logError('[automations.reminderDone] failed:', err);
      return { ok: false, error: String(err) };
    }
  });
}
