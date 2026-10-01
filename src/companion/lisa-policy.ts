/** Opt-in companion action policy. The existing engines still own scheduling and delivery. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getCodeBuddyHome } from '../utils/codebuddy-home.js';
import { writeJsonAtomicSync } from '../utils/atomic-write.js';
import { auditLogger } from '../security/audit-logger.js';
import { logger } from '../utils/logger.js';
import { getTurnOrigin } from '../security/turn-origin.js';
import { resolveToolEffect } from '../tools/tool-effect.js';
import { TOOL_ALIASES } from '../tools/registry/tool-alias-map.js';
import { TOOL_METADATA } from '../tools/metadata.js';

export const LISA_ACTIONS = [
  'observer',
  'rappel',
  'message-utilisateur',
  'parole',
  'commande-shell',
  'ecrire-fichier',
  'publier',
  'payer',
  'autre',
] as const;
export type LisaAction = (typeof LISA_ACTIONS)[number];
export type LisaColumn = 'autorise' | 'demander' | 'interdit';
export type LisaRegime = 'lecture' | 'action';
export type LisaTrigger =
  | 'morning'
  | 'evening'
  | 'inactivity'
  | 'milestone'
  | 'followUp'
  | 'encouragement'
  | 'away'
  | 'presence'
  | 'arrival'
  | 'reminder'
  | 'sensory-rule'
  | 'voice-command'
  | 'companion-tool'
  | 'telegram'
  | 'voice';
export interface LisaRules {
  version: 1;
  regime: LisaRegime;
  autorise: LisaAction[];
  demander: LisaAction[];
  interdit: LisaAction[];
}
export interface LisaIntent {
  action: LisaAction;
  trigger: LisaTrigger;
  /** Fixed operation labels only. No transcripts, arguments, paths or message bodies. */
  operation:
    | 'initiative'
    | 'telegram'
    | 'parole'
    | 'rappel'
    | 'outil'
    | 'commande-vocale'
    | 'regle-sensorielle';
  tool?: string;
}
export interface LisaJournalEntry extends LisaIntent {
  id: string;
  quand: string;
  regime: LisaRegime;
  regle: LisaColumn;
  decision: 'autorise' | 'demande' | 'refuse';
  resultat: 'commence' | 'propose' | 'refuse' | 'reussi' | 'echec' | 'accord' | 'annule';
}

const context = new AsyncLocalStorage<{
  trigger: LisaTrigger;
  grants: ReadonlySet<LisaAction>;
  rulesSnapshot?: string;
  turnOutcome?: { refused: boolean; failed: boolean; proposed: boolean };
}>();
export function lisaPolicyEnabled(): boolean {
  return process.env.CODEBUDDY_LISA_REGLES === 'true';
}
export function inLisaTurn(): boolean {
  return lisaPolicyEnabled() && (context.getStore() !== undefined || getTurnOrigin() === 'voice');
}
export function lisaTrigger(fallback: LisaTrigger): LisaTrigger {
  return context.getStore()?.trigger ?? (getTurnOrigin() === 'voice' ? 'voice-command' : fallback);
}
export function withLisaContext<T>(trigger: LisaTrigger, fn: () => T): T {
  if (!lisaPolicyEnabled()) return fn();
  return context.run(
    { ...context.getStore(), trigger, grants: context.getStore()?.grants ?? new Set() },
    fn
  );
}
export function defaultLisaRules(): LisaRules {
  return {
    version: 1,
    regime: 'lecture',
    autorise: ['observer', 'rappel', 'message-utilisateur'],
    demander: ['parole', 'autre'],
    interdit: ['commande-shell', 'ecrire-fichier', 'publier', 'payer'],
  };
}
export function lisaDirectory(): string {
  return join(getCodeBuddyHome(), 'companion', 'lisa');
}
export function lisaRulesPath(): string {
  return join(lisaDirectory(), 'regles.json');
}
export function lisaJournalPath(): string {
  return join(lisaDirectory(), 'journal.jsonl');
}

function ensureDirectory(): void {
  const parent = join(getCodeBuddyHome(), 'companion');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) {
    throw new Error('Répertoire compagnon invalide');
  }
  mkdirSync(lisaDirectory(), { recursive: true, mode: 0o700 });
  if (!lstatSync(lisaDirectory()).isDirectory() || lstatSync(lisaDirectory()).isSymbolicLink()) {
    throw new Error('Répertoire Lisa invalide');
  }
}
function requireEnabled(): void {
  if (!lisaPolicyEnabled()) throw new Error('Activer CODEBUDDY_LISA_REGLES=true');
}
function validateRules(value: unknown): LisaRules {
  if (!value || typeof value !== 'object') throw new Error('Règles Lisa invalides');
  const r = value as LisaRules;
  const columns = [r.autorise, r.demander, r.interdit];
  if (
    r.version !== 1 ||
    !['lecture', 'action'].includes(r.regime) ||
    columns.some((c) => !Array.isArray(c) || c.some((a) => !LISA_ACTIONS.includes(a))) ||
    new Set(columns.flat()).size !== columns.flat().length
  ) {
    throw new Error('Règles Lisa invalides ou contradictoires');
  }
  return r;
}
/** Missing actions fall back to demander; invalid/unreadable config fails closed. */
export function readLisaRules(): LisaRules {
  requireEnabled();
  ensureDirectory();
  const file = lisaRulesPath();
  if (!existsSync(file)) {
    try {
      writeFileSync(file, JSON.stringify(defaultLisaRules(), null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  if (!lstatSync(file).isFile() || lstatSync(file).nlink !== 1)
    throw new Error('Fichier de règles invalide');
  return validateRules(JSON.parse(readFileSync(file, 'utf8')));
}
export function updateLisaRules(change: (rules: LisaRules) => LisaRules): LisaRules {
  requireEnabled();
  ensureDirectory();
  const lock = join(lisaDirectory(), 'regles.lock');
  // No background task or wait: concurrent administrative writes fail explicitly.
  mkdirSync(lock, { mode: 0o700 });
  try {
    const next = validateRules(change(readLisaRules()));
    writeJsonAtomicSync(lisaRulesPath(), next, { mode: 0o600 });
    return next;
  } finally {
    rmdirSync(lock);
  }
}
export function setLisaRule(action: LisaAction, column: LisaColumn): LisaRules {
  if (!LISA_ACTIONS.includes(action)) throw new Error('Action Lisa inconnue');
  return updateLisaRules((r) => {
    for (const c of ['autorise', 'demander', 'interdit'] as const)
      r[c] = r[c].filter((a) => a !== action);
    r[column].push(action);
    return r;
  });
}
function append(entry: LisaJournalEntry): void {
  ensureDirectory();
  // An append is one synchronous write, before effects; do not log user content.
  const fd = openSync(
    lisaJournalPath(),
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600
  );
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1) throw new Error('Journal Lisa invalide');
    writeFileSync(fd, JSON.stringify(entry) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  auditLogger.log({
    action: 'tool_execution',
    source: 'lisa-policy',
    decision:
      entry.decision === 'refuse' ? 'block' : entry.decision === 'demande' ? 'confirm' : 'allow',
    target: entry.action,
    details: `${entry.trigger}: ${entry.resultat}`,
  });
}
export function readLisaJournal(since?: string): LisaJournalEntry[] {
  requireEnabled();
  const boundary = since === undefined ? -Infinity : Date.parse(since);
  if (Number.isNaN(boundary)) throw new Error('--since attend une date ISO');
  const file = lisaJournalPath();
  if (!existsSync(file)) return [];
  if (!lstatSync(file).isFile()) throw new Error('Journal Lisa invalide');
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LisaJournalEntry)
    .filter((entry) => Date.parse(entry.quand) >= boundary);
}
/** Revalidate after downstream confirmation waits, immediately before dispatch. */
export function lisaActionStillCurrent(): boolean {
  if (!inLisaTurn()) return true;
  const snapshot = context.getStore()?.rulesSnapshot;
  if (!snapshot) return false;
  try {
    return JSON.stringify(readLisaRules()) === snapshot;
  } catch {
    return false;
  }
}

export const LISA_REFUSAL =
  'Action Lisa refusée ou proposée sans exécution ; voir buddy lisa journal.';

/** Classify the actual tool, not heard words. Unknown tools never become safe reads. */
export function lisaToolIntent(name: string, trigger: LisaTrigger): LisaIntent {
  name = TOOL_ALIASES[name] ?? name;
  let action: LisaAction;
  const effect = resolveToolEffect(name);
  if (effect === 'read') action = 'observer';
  else if (
    /^(bash|code_exec|run_script|exec|execute|terminal|process|app_server|docker|kubernetes|git|ssh)$/.test(
      name
    )
  )
    action = 'commande-shell';
  else if (/^(remind|reminder)$/.test(name)) action = 'rappel';
  else if (/publish|deploy|post_social|send_email|browser|computer|desktop|webhook/.test(name))
    action = 'publier';
  else if (/pay|purchase|checkout/.test(name)) action = 'payer';
  else {
    action = effect === 'reversible' ? 'ecrire-fichier' : 'autre';
  }
  return {
    action,
    trigger,
    operation: 'outil',
    // External tool names can themselves contain secrets. Only catalog names are persisted.
    tool: TOOL_METADATA.some((t) => t.name === name) ? name : 'outil-inconnu',
  };
}
/** Only the configured private owner destination inherits the default message permission. */
export function lisaTelegramAction(
  chat: string | undefined,
  allowedUsers: readonly string[] = []
): LisaAction {
  const ownerChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT?.trim();
  return chat && !chat.startsWith('-') && (chat === ownerChat || allowedUsers.includes(chat))
    ? 'message-utilisateur'
    : 'autre';
}

function succeeded(value: unknown): boolean {
  if (value === false || value === null) return false;
  if (value && typeof value === 'object') {
    if ('success' in value) return value.success === true;
    if ('ok' in value) return value.ok === true;
  }
  return true;
}
/** Each call logs start + terminal outcome; demander always requests fresh human consent. */
export async function runLisaAction<T>(
  intent: LisaIntent,
  execute: () => Promise<T>,
  refused: T,
  confirm?: () => Promise<boolean>
): Promise<T> {
  if (!lisaPolicyEnabled()) return execute();
  const id = randomUUID();
  let rules: LisaRules;
  try {
    rules = readLisaRules();
  } catch {
    try {
      append({
        ...intent,
        id,
        quand: new Date().toISOString(),
        regime: 'lecture',
        regle: 'interdit',
        decision: 'refuse',
        resultat: 'refuse',
      });
    } catch {
      logger.warn('[lisa-policy] configuration et/ou journal indisponibles ; action refusée');
    }
    return refused;
  }
  const regle: LisaColumn = rules.interdit.includes(intent.action)
    ? 'interdit'
    : rules.autorise.includes(intent.action)
      ? 'autorise'
      : 'demander';
  let decision: LisaJournalEntry['decision'] =
    regle === 'interdit' ? 'refuse' : regle === 'demander' ? 'demande' : 'autorise';
  const inheritedOutcome = context.getStore()?.turnOutcome;
  const turnOutcome =
    intent.operation === 'commande-vocale'
      ? { refused: false, failed: false, proposed: false }
      : inheritedOutcome;
  const record = (resultat: LisaJournalEntry['resultat']): void => {
    if (inheritedOutcome && intent.operation !== 'commande-vocale') {
      if (resultat === 'refuse') inheritedOutcome.refused = true;
      if (resultat === 'echec') inheritedOutcome.failed = true;
      if (resultat === 'propose') inheritedOutcome.proposed = true;
    }
    append({
      ...intent,
      id,
      quand: new Date().toISOString(),
      regime: rules.regime,
      regle,
      decision,
      resultat,
    });
  };
  try {
    if (regle === 'interdit') {
      record('refuse');
      return refused;
    }
    if (rules.regime === 'lecture' && intent.action !== 'observer') {
      record('propose');
      return refused;
    }
    const inherited =
      intent.operation !== 'outil' &&
      intent.operation !== 'initiative' &&
      context.getStore()?.grants.has(intent.action) === true;
    if (regle === 'demander' && !inherited) {
      record('commence');
      const approved = await (
        confirm ??
        (async () => {
          const { ConfirmationService } = await import('../utils/confirmation-service.js');
          const service = ConfirmationService.getInstance();
          const { getRemoteApprovalService } = await import('../security/remote-approval.js');
          const remote = getRemoteApprovalService();
          if (
            !remote.hasChannels() &&
            rules.autorise.includes('message-utilisateur') &&
            lisaTelegramAction(process.env.CODEBUDDY_SENSORY_ALERT_CHAT) === 'message-utilisateur' &&
            process.env.CODEBUDDY_SENSORY_ALERT_CHAT &&
            (process.env.CODEBUDDY_SENSORY_ALERT_TOKEN || process.env.TELEGRAM_BOT_TOKEN)
          ) {
            remote.registerChannel('lisa-telegram', async (text) => {
              const { sendTelegramAlert } = await import('../sensory/alert.js');
              if (!(await sendTelegramAlert(text)))
                throw new Error('Lisa approval prompt not delivered');
            });
          }
          if (remote.hasChannels()) service.setRemoteApprovalService(remote);
          const promptGrants = new Set(context.getStore()?.grants ?? []);
          promptGrants.add('message-utilisateur');
          promptGrants.add('autre'); // Authenticated approval-channel notification only; tools cannot inherit it.
          return (
            await context.run({ trigger: intent.trigger, grants: promptGrants }, () =>
              service.requestConfirmation(
                {
                  operation: `lisa:${intent.operation}`,
                  filename: intent.tool ?? intent.action,
                  forcePrompt: true,
                  content: `Lisa demande votre accord pour : ${intent.action} (${intent.trigger}).`,
                },
                'tool'
              )
            )
          ).confirmed;
        })
      )();
      // Recheck after a human delay: changing mode/rules revokes the pending action.
      const current = readLisaRules();
      if (
        !approved ||
        current.regime !== rules.regime ||
        JSON.stringify(current) !== JSON.stringify(rules)
      ) {
        decision = 'refuse';
        record('refuse');
        return refused;
      }
      record('accord');
    }
    record('commence');
    const grants = new Set(context.getStore()?.grants ?? []);
    grants.add(intent.action);
    const value = await context.run(
      { trigger: intent.trigger, grants, rulesSnapshot: JSON.stringify(rules), turnOutcome },
      execute
    );
    if (intent.operation === 'commande-vocale' && turnOutcome?.refused) {
      decision = 'refuse';
      record('refuse');
    } else if (intent.operation === 'commande-vocale' && turnOutcome?.failed) record('echec');
    else if (intent.operation === 'commande-vocale' && turnOutcome?.proposed) record('propose');
    else record(succeeded(value) ? 'reussi' : 'echec');
    return value;
  } catch {
    // Never include provider/tool errors: they can contain secrets and raw content.
    try {
      record('echec');
    } catch {
      logger.warn('[lisa-policy] journal indisponible ; action interrompue');
    }
    return refused;
  }
}

/** Authenticated private Telegram text OR voice-note transcription. A bare yes is
 * accepted only for one live Lisa request; ambient microphone speech cannot approve. */
export async function handleLisaApproval(text: string, owner: boolean): Promise<string | null> {
  if (!lisaPolicyEnabled()) return null;
  const match = text
    .trim()
    .match(/^(oui|non)(?: (approval-[a-f0-9]{10}))?$|^confirme lisa (approval-[a-f0-9]{10})$/i);
  if (!match) return null;
  const { getRemoteApprovalService } = await import('../security/remote-approval.js');
  const service = getRemoteApprovalService();
  const pending = service.getPending().filter((r) => r.expiresAt.getTime() > Date.now());
  const requestedId = match[2] ?? match[3];
  const request = requestedId
    ? pending.find((r) => r.id === requestedId && r.toolName.startsWith('lisa:'))
    : pending.length === 1 && pending[0]?.toolName.startsWith('lisa:')
      ? pending[0]
      : undefined;
  if (!request) return null;
  if (!owner) return 'Confirmation Lisa refusée : propriétaire requis.';
  const approved = match[1]?.toLowerCase() !== 'non';
  service.handleResponse(request.id, approved);
  return approved ? 'Accord Lisa reçu.' : 'Action Lisa refusée.';
}
