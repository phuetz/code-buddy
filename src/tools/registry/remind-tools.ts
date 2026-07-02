/**
 * Reminder tool adapter.
 *
 * ITool exposing `remind` — the agent's PROPER way to set a reminder, instead of shelling
 * `buddy remind add` into the recurring store. That shell path was the second layer of the "train"
 * bug: told "j'ai un train demain", the ACT agent invented a two-reminder pattern and ran the CLI
 * twice, creating time-only (forever-daily) reminders. This tool wraps `addReminder` directly, so a
 * one-time event is a DATED one-shot (fires once then retires) and duplicates are de-duplicated by
 * construction. See src/companion/reminders.ts.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

export class RemindTool implements ITool {
  readonly name = 'remind';
  readonly description =
    "Set a reminder for the user. PREFER this over running `buddy remind add` in the shell. For a ONE-TIME event, pass `date` (YYYY-MM-DD) — it fires once at `time` on that day, then retires. Omit `date` for a DAILY recurring reminder. Idempotent: an identical reminder is not stacked. Use for 'rappelle-moi …' / 'remind me to …'.";

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    const time = typeof input.time === 'string' ? input.time.trim() : '';
    const date = typeof input.date === 'string' && input.date.trim() ? input.date.trim() : undefined;
    const message = typeof input.message === 'string' && input.message.trim() ? input.message.trim() : undefined;
    if (!label) return { success: false, error: 'remind: `label` is required' };
    if (!time) return { success: false, error: 'remind: `time` (HH:MM) is required' };

    // Lead time — fire BEFORE the event ("remind me 30 min before the train at 10:38" → 10:08), with
    // a label that says how far ahead. Same-day only (a lead crossing midnight keeps the event time).
    const lead = typeof input.leadMinutes === 'number' && input.leadMinutes > 0 ? Math.floor(input.leadMinutes) : 0;
    let fireTime = time;
    let leadLabel = label;
    if (lead > 0) {
      const [h, m] = time.split(':').map(Number);
      if (h !== undefined && m !== undefined) {
        const total = h * 60 + m - lead;
        if (total >= 0) {
          fireTime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
          const human = lead % 60 === 0 ? `${lead / 60} heure${lead / 60 > 1 ? 's' : ''}` : `${lead} minute${lead > 1 ? 's' : ''}`;
          leadLabel = `${label} (dans ${human})`;
        }
      }
    }

    try {
      const { addReminder, reminderCadencePhrase } = await import('../../companion/reminders.js');
      const r = await addReminder({
        label: leadLabel,
        time: fireTime,
        ...(date ? { date } : {}),
        ...(message ? { message } : {}),
      });
      const cadence = reminderCadencePhrase(r);
      return {
        success: true,
        output: `Reminder set: "${r.label}" at ${r.time} ${cadence} (id ${r.id}).`,
        data: { id: r.id, label: r.label, time: r.time, date: r.date ?? null, oneShot: Boolean(r.date) },
      };
    } catch (err) {
      return { success: false, error: `remind failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'What to be reminded of, e.g. "prendre le train"' },
          time: { type: 'string', description: 'Local time of day HH:MM (24h), e.g. "10:38"' },
          date: {
            type: 'string',
            description: 'One-shot date YYYY-MM-DD — fires once then retires. OMIT for a daily recurring reminder.',
          },
          leadMinutes: {
            type: 'number',
            description: 'Fire this many minutes BEFORE `time` (for "remind me N before the event"). `time` is the EVENT time; the reminder fires at time − leadMinutes.',
          },
          message: { type: 'string', description: 'Optional custom spoken/sent text' },
        },
        required: ['label', 'time'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const i = (input ?? {}) as Record<string, unknown>;
    if (typeof i.label !== 'string' || !i.label.trim()) return { valid: false, errors: ['`label` is required'] };
    if (typeof i.time !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(i.time.trim())) {
      return { valid: false, errors: ['`time` must be HH:MM'] };
    }
    if (i.date !== undefined && (typeof i.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(i.date.trim()))) {
      return { valid: false, errors: ['`date` must be YYYY-MM-DD'] };
    }
    if (i.leadMinutes !== undefined && (typeof i.leadMinutes !== 'number' || i.leadMinutes < 0)) {
      return { valid: false, errors: ['`leadMinutes` must be a non-negative number'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: [
        'remind', 'reminder', 'rappel', 'rappelle-moi', 'rappelle moi', 'remind me',
        'alarm', 'alarme', 'notify me', 'préviens-moi', 'previens moi', 'schedule', 'todo', 'tâche',
      ],
      priority: 6,
      modifiesFiles: true,
      makesNetworkRequests: false,
      requiresConfirmation: false,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

/** Create the reminder tool adapters. */
export function createRemindTools(): ITool[] {
  return [new RemindTool()];
}
