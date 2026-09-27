/** Fresh owner confirmation for reminder commands heard by the room microphone. */
import { randomBytes } from 'node:crypto';
import type { CompanionIdentity } from './companion-identity.js';
import * as rem from './reminders.js';

const CONFIRM_TTL_MS = 120_000;
const CONFIRM_RE = /^confirme rappel ([a-f0-9]{12})$/i;

type Action =
  | { kind: 'create'; input: rem.AddReminderInput }
  | { kind: 'ack' | 'snooze' | 'undo' | 'remove' | 'disable'; id: string; label: string; text?: string; firedAt?: number };

interface Pending { action: Action; expiresAt: number }

export interface ReminderVoiceDeps {
  identity: CompanionIdentity;
  robotName: string;
  speak: (text: string) => Promise<void>;
  notifyOwner: (text: string) => Promise<boolean>;
}

function addressedBody(text: string, robotName: string): string | null {
  const name = robotName.trim();
  if (!name) return null;
  const escaped = name.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
  const prefix = new RegExp('^(?:(?:hey|salut|bonjour)\\s+)?' + escaped + '(?:[\\s,!:]+)(.+)$', 'iu');
  const body = text.trim().match(prefix)?.[1]?.trim();
  // A third-person mention at the start of a sentence is not a vocative address.
  if (!body || !/^(?:rappelle|pense|note|c['’ ]est|j['’ ]ai|je |dans |plus tard|repousse|annule|annuler|efface|oublie|supprime|retire|desactive|désactive|coupe|suspends|arrete|arrête|non |erreur|pas ça|pas ca|done|taken|snooze|quels|qu['’ ]est|mon agenda|mon planning|mes rappels)\b/iu.test(body)) {
    return null;
  }
  return body;
}

function isAuthenticatedOwner(identity: CompanionIdentity): boolean {
  if (identity.role !== 'owner' || identity.confidence !== 'high') return false;
  if (identity.channel === 'pwa') return true;
  if (identity.channel !== 'telegram' || !identity.userId) return false;
  // The ordinary Telegram resolver also trusts an allowlisted chat. In a group chat that
  // identifies the destination, not the sender; a member must not confirm for the owner.
  return identity.userId === identity.chatId
    || identity.reason === 'telegram_sender_id_allowed'
    || identity.reason === 'telegram_username_allowed';
}

async function classify(text: string, now: number): Promise<Action | 'private-read' | null> {
  const undo = rem.peekUndo(text, now);
  if (undo) return { kind: 'undo', ...undo, text };
  if (rem.isSnoozeCommand(text, now)) {
    const target = rem.pendingAcks(now)[0];
    if (target) return { kind: 'snooze', id: target.id, label: target.label, text, firedAt: target.firedAt };
  }
  const ackId = rem.matchAck(text, now);
  if (ackId) {
    const target = rem.pendingAcks(now).find((item) => item.id === ackId);
    if (target) return { kind: 'ack', id: target.id, label: target.label, text, firedAt: target.firedAt };
  }
  const command = rem.parseReminderCommand(text);
  if (command?.kind === 'list' || command?.kind === 'agenda') return 'private-read';
  if (command?.kind === 'remove' || command?.kind === 'disable') {
    const items = await rem.listReminders();
    const target = rem.matchReminderByLabel(
      items.filter((item) => item.enabled || command.kind === 'remove'),
      command.target,
    );
    return target ? { kind: command.kind, id: target.id, label: target.label } : 'private-read';
  }
  const input = rem.parseVoiceReminder(text, new Date(now));
  return input ? { kind: 'create', input } : null;
}

function summary(action: Action): string {
  if (action.kind === 'create') {
    return 'Créer le rappel « ' + action.input.label + ' » à ' + action.input.time
      + (action.input.date ? ' le ' + action.input.date : ' tous les jours');
  }
  const verbs = { ack: 'Acquitter', snooze: 'Reporter', undo: 'Annuler',
    remove: 'Supprimer', disable: 'Désactiver' };
  return verbs[action.kind] + ' le rappel « ' + action.label + ' »';
}

async function execute(action: Action, now: number): Promise<string | null> {
  if (action.kind === 'create') {
    const created = await rem.addReminder(action.input);
    rem.noteCreatedForUndo(created, now);
    return 'C’est noté : ' + created.label + ', ' + rem.reminderCadencePhrase(created)
      + ' à ' + created.time + '.';
  }
  if (action.kind === 'ack') {
    if (!rem.pendingAcks(now).some((item) => item.id === action.id && item.firedAt === action.firedAt)) return null;
    const done = await rem.markDone(action.id, 'telegram', new Date(now));
    return done ? rem.reminderReadback(done.label) : null;
  }
  if (action.kind === 'snooze') {
    const current = rem.pendingAcks(now)[0];
    if (current?.id !== action.id || current.firedAt !== action.firedAt) return null;
    const snoozed = await rem.snoozePending(action.text ?? '', now);
    return snoozed?.id === action.id
      ? 'D’accord, je te le rappelle dans ' + Math.round(snoozed.delayMs / 60_000) + ' minutes.'
      : null;
  }
  if (action.kind === 'undo') {
    if (rem.peekUndo(action.text ?? '', now)?.id !== action.id) return null;
    const undone = rem.undoPending(action.text ?? '', now);
    return undone?.id === action.id && await rem.removeReminder(action.id)
      ? 'OK, j’annule le rappel : ' + action.label + '.' : null;
  }
  const current = (await rem.listReminders()).find((item) => item.id === action.id);
  if (!current || current.label !== action.label) return null;
  if (action.kind === 'remove') {
    return await rem.removeReminder(action.id)
      ? 'J’ai supprimé le rappel : ' + action.label + '.' : null;
  }
  return await rem.setReminderEnabled(action.id, false)
    ? 'J’ai désactivé le rappel : ' + action.label + '.' : null;
}

export function createReminderVoiceCoordinator(options: {
  now?: () => number;
  code?: () => string;
} = {}) {
  const now = options.now ?? Date.now;
  const code = options.code ?? (() => randomBytes(6).toString('hex'));
  const pending = new Map<string, Pending>();

  return {
    async handleVoice(text: string, deps: ReminderVoiceDeps): Promise<boolean> {
      const body = addressedBody(text, deps.robotName);
      const action = await classify(body ?? text, now());
      if (!action) return false;
      // An engagement window or a greeting is not an address for an action.
      if (!body) return true;
      if (action === 'private-read') {
        await deps.speak('Consulte tes rappels depuis ton canal privé authentifié.');
        return true;
      }
      // The microphone supplies at most "present", never owner identity.
      pending.clear();
      const token = code();
      if (!/^[a-f0-9]{12}$/i.test(token)) throw new Error('invalid reminder confirmation code');
      pending.set(token.toLowerCase(), { action, expiresAt: now() + CONFIRM_TTL_MS });
      const prompt = summary(action) + ' ? Réponds « confirme rappel ' + token
        + ' » depuis Telegram ou la PWA.';
      const sent = await deps.notifyOwner(prompt);
      await deps.speak(sent
        ? 'Je t’ai demandé confirmation sur ton canal privé avant de toucher au rappel.'
        : prompt);
      return true;
    },
    async confirm(text: string, identity: CompanionIdentity): Promise<{
      handled: boolean; success: boolean; text?: string;
    }> {
      const match = text.trim().match(CONFIRM_RE);
      if (!match) return { handled: false, success: false };
      if (!isAuthenticatedOwner(identity)) {
        return { handled: true, success: false, text: 'Confirmation refusée : identité propriétaire requise.' };
      }
      const key = match[1]!.toLowerCase();
      const request = pending.get(key);
      if (!request || now() >= request.expiresAt) {
        pending.delete(key);
        return { handled: true, success: false, text: 'Cette confirmation a expiré ou a déjà été utilisée.' };
      }
      pending.delete(key); // one-shot, before asynchronous store writes
      try {
        const result = await execute(request.action, now());
        return result
          ? { handled: true, success: true, text: result }
          : { handled: true, success: false, text: 'Le rappel a changé ou sa fenêtre a expiré. Redemande à Lisa.' };
      } catch {
        return { handled: true, success: false, text: 'Je n’ai pas pu modifier ce rappel.' };
      }
    },
  };
}

/** Shared by local speech and authenticated companion channels within one process. */
export const reminderVoiceCoordinator = createReminderVoiceCoordinator();
