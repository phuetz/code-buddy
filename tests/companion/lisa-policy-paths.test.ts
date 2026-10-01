import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolHandler } from '../../src/agent/tool-handler.js';
import { makeAgentReply, type AgentRunner } from '../../src/sensory/agent-reply.js';
import { sendTelegramAlert, sendTelegramVoice } from '../../src/sensory/alert.js';
import { executeSensoryAction } from '../../src/sensory/sensory-action-executor.js';
import { runProactiveTick } from '../../src/companion/proactive-engine.js';
import { runReminderTick } from '../../src/companion/reminder-runner.js';
import {
  addReminder,
  loadReminders,
  resetAcks,
  whenRemindersPersisted,
} from '../../src/companion/reminders.js';
import {
  readLisaJournal,
  setLisaRule,
  updateLisaRules,
  lisaJournalPath,
  lisaDirectory,
  withLisaContext,
} from '../../src/companion/lisa-policy.js';
import { resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { resetOperatingModeManager } from '../../src/agent/operating-modes.js';
import { resetWorkspaceIsolation } from '../../src/workspace/workspace-isolation.js';
import { FormalToolRegistry } from '../../src/tools/registry/index.js';
import { getToolHooksManager } from '../../src/tools/hooks/index.js';
import { executeCompanionTool } from '../../src/companion/companion-toolset.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import type { ITool } from '../../src/tools/registry/types.js';
import { TelegramChannel } from '../../src/channels/telegram/index.js';
import { createReminderVoiceCoordinator } from '../../src/companion/reminder-voice-auth.js';

describe('Lisa — vrais chemins des moteurs, avec transports injectés', () => {
  let root: string;
  beforeEach(() => {
    mkdirSync('_qa/lisa-regles/home', { recursive: true });
    root = mkdtempSync('_qa/lisa-regles/home/paths-');
    vi.stubEnv('CODEBUDDY_HOME', join(root, '.codebuddy'));
    vi.stubEnv('CODEBUDDY_LISA_REGLES', 'true');
    vi.stubEnv('CODEBUDDY_REMINDERS_FILE', join(root, 'reminders.json'));
    vi.stubEnv('CODEBUDDY_SENSORY_ALERT_TOKEN', 'qa-token');
    vi.stubEnv('CODEBUDDY_SENSORY_ALERT_CHAT', 'qa-chat');
    vi.stubEnv('CODEBUDDY_COMPANION_AWAY', 'false');
    vi.stubEnv('CODEBUDDY_COMPANION_PERSONA', '');
    vi.stubEnv('CODEBUDDY_TIMEZONE', 'Europe/Paris');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network disabled in Lisa QA')));
    resetPermissionModeManager();
    resetOperatingModeManager();
    resetWorkspaceIsolation();
    resetAcks();
  });
  afterEach(async () => {
    resetAcks();
    await whenRemindersPersisted();
    ConfirmationService.getInstance().setInteractiveBridge(null);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });
  const actionMode = () => updateLisaRules((r) => ({ ...r, regime: 'action' }));
  function handler(hooks = vi.fn(async () => [])) {
    return new ToolHandler({
      checkpointManager: {
        checkpointBeforeCreate: vi.fn(),
        checkpointBeforeEdit: vi.fn(),
      } as never,
      hooksManager: { executeHooks: hooks } as never,
      marketplace: { executeTool: vi.fn() } as never,
      repairCoordinator: { isRepairEnabled: () => false } as never,
    });
  }
  const call = (name: string, args: Record<string, unknown>) => ({
    id: 'qa-call',
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
  });

  it.each([false, true])(
    'phrase destructive : refus avant hooks et spawn, streaming=%s, malgré bypass',
    async (streaming) => {
      actionMode();
      const victim = join(root, 'canari.txt');
      writeFileSync(victim, 'intact');
      const hooks = vi.fn(async () => []);
      const tools = handler(hooks);
      const runner: AgentRunner = async () => {
        const invocation = call('bash', { command: `rm -f '${victim}'` });
        let result;
        if (streaming) {
          const iterator = tools.executeToolStreaming(invocation);
          let step = await iterator.next();
          while (!step.done) step = await iterator.next();
          result = step.value;
        } else result = await tools.executeTool(invocation);
        return result.success ? 'Commande exécutée.' : 'Commande refusée.';
      };
      runner.stream = async function* () {
        yield await runner('');
      };
      const reply = makeAgentReply({
        cwd: root,
        permissionMode: 'bypassPermissions',
        agentRunner: runner,
      });
      if (streaming) {
        let text = '';
        for await (const delta of reply.stream!('Supprime le fichier.')) text += delta;
        expect(text).toBe('Commande refusée.');
      } else expect(await reply('Supprime le fichier.')).toBe('Commande refusée.');
      expect(readFileSync(victim, 'utf8')).toBe('intact');
      expect(hooks).not.toHaveBeenCalled();
      expect(readLisaJournal()).toContainEqual(
        expect.objectContaining({
          trigger: 'voice-command',
          action: 'commande-shell',
          resultat: 'refuse',
        })
      );
      expect(readLisaJournal().at(-1)).toMatchObject({
        operation: 'commande-vocale',
        decision: 'refuse',
        resultat: 'refuse',
      });
      expect(readFileSync(lisaJournalPath(), 'utf8')).not.toContain(victim);
    }
  );
  it('un outil de consultation n’invoque aucun hook exécutable et reste journalisé', async () => {
    const hooks = vi.fn(async () => []);
    const customHook = vi.fn(async (ctx) => ctx);
    getToolHooksManager().registerBeforeHook('lisa-qa-hook', customHook);
    try {
      const result = await withLisaContext('voice-command', () =>
        handler(hooks).executeStrictSelfInspectionTool(
          call('self_describe', { focus: 'architecture', depth: 'summary' }),
          { exposedToolNames: ['self_describe'], provider: 'test-provider' }
        )
      );
      expect(result.success).toBe(true);
      expect(hooks).not.toHaveBeenCalled();
      expect(customHook).not.toHaveBeenCalled();
      expect(readLisaJournal().at(-1)).toMatchObject({ operation: 'outil', resultat: 'reussi' });
    } finally {
      getToolHooksManager().unregisterHook('before_tool_call', 'lisa-qa-hook');
    }
  });
  it('initiative en lecture : zéro transport, zéro refiner, délai et budget intacts', async () => {
    vi.stubEnv('CODEBUDDY_COMPANION_PROACTIVE', 'true');
    const telegramVoice = vi.fn(async () => true);
    const refine = vi.fn(async () => 'Secret privé');
    const conductor = { claim: vi.fn(() => true) };
    const statePath = join(root, 'proactive.json');
    expect(
      await runProactiveTick({
        now: () => Date.parse('2026-09-30T07:00:00Z'),
        present: () => false,
        recentHearing: async () => [],
        statePath,
        relationshipStatePath: join(root, 'relationship.json'),
        telegramVoice,
        refine,
        conductor,
      })
    ).toBeNull();
    expect(telegramVoice).not.toHaveBeenCalled();
    expect(refine).not.toHaveBeenCalled();
    expect(conductor.claim).not.toHaveBeenCalled();
    expect(existsSync(statePath)).toBe(false);
    expect(readLisaJournal().at(-1)).toMatchObject({
      operation: 'initiative',
      resultat: 'propose',
    });
  });
  it('initiative autorisée en action : envoi réel par le transport fourni et résultat journalisé', async () => {
    actionMode();
    vi.stubEnv('CODEBUDDY_COMPANION_PROACTIVE', 'true');
    const telegramVoice = vi.fn(async () => true);
    const line = await runProactiveTick({
      now: () => Date.parse('2026-09-30T07:00:00Z'),
      present: () => false,
      recentHearing: async () => [],
      statePath: join(root, 'proactive.json'),
      relationshipStatePath: join(root, 'relationship.json'),
      telegramVoice,
      conductor: { claim: () => true },
    });
    expect(line).toBeTruthy();
    expect(telegramVoice).toHaveBeenCalledTimes(1);
    expect(readLisaJournal().at(-1)).toMatchObject({ operation: 'initiative', resultat: 'reussi' });
  });
  it('rappel en lecture : proposition sans envoi, sans retrait et sans ack', async () => {
    actionMode();
    await addReminder({ label: 'rappel privé', time: '09:00', date: '2026-09-30' });
    updateLisaRules((r) => ({ ...r, regime: 'lecture' }));
    const say = vi.fn(async () => undefined);
    const notify = vi.fn(async () => true);
    await runReminderTick(new Date('2026-09-30T09:00:30'), { say, notify });
    expect(say).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect((await loadReminders())[0]).toMatchObject({ enabled: true });
    expect((await loadReminders())[0]?.lastFiredAt).toBeUndefined();
    expect(readLisaJournal().at(-1)?.resultat).toBe('propose');
    expect(readFileSync(lisaJournalPath(), 'utf8')).not.toContain('rappel privé');
  });
  it('rappel autorisé en action : événement, voix et Telegram tracés, échec du transport visible', async () => {
    actionMode();
    await addReminder({ label: 'rappel privé', time: '09:00' });
    const say = vi.fn(async () => undefined);
    const notify = vi.fn(async () => false);
    await runReminderTick(new Date('2026-09-30T09:00:30'), { say, notify });
    expect(say).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const entries = readLisaJournal();
    expect(entries).toContainEqual(
      expect.objectContaining({ operation: 'parole', resultat: 'reussi' })
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ operation: 'telegram', resultat: 'echec' })
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ operation: 'rappel', resultat: 'reussi' })
    );
  });
  it('alertes en lecture : ni photo lue, ni synthèse, ni fetch, y compris appel direct', async () => {
    const fetch = vi.fn();
    const readFile = vi.fn();
    const synthesize = vi.fn();
    expect(await sendTelegramAlert('secret', 'photo.jpg', { fetch, readFile })).toBe(false);
    expect(await sendTelegramVoice('secret', { synthesize })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
    expect(readLisaJournal().filter((e) => e.resultat === 'propose')).toHaveLength(2);
  });
  it('alerte autorisée en action : refus Telegram propagé, corps sensible absent du journal', async () => {
    actionMode();
    const fetch = vi.fn(async () => ({ ok: false }));
    expect(await sendTelegramAlert('secret très privé', undefined, { fetch })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readLisaJournal().at(-1)?.resultat).toBe('echec');
    expect(readFileSync(lisaJournalPath(), 'utf8')).not.toContain('secret très privé');
  });
  it('canal Telegram et photos : pas de fetch ni de lecture de fichier en lecture', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const channel = new TelegramChannel({ type: 'telegram', enabled: true, token: 'qa-token' });
      expect((await channel.send({ channelId: 'qa-chat', content: 'secret' })).success).toBe(false);
      await channel.sendImageFile('qa-chat', join(root, 'image-absente.jpg'), 'secret');
      await channel.sendTyping('qa-chat');
      expect(fetch).not.toHaveBeenCalled();
      expect(readLisaJournal().filter((e) => e.resultat === 'propose')).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('canal Telegram en action : destinataire privé autorisé, autre destinataire refusé', async () => {
    actionMode();
    setLisaRule('autre', 'interdit');
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    }));
    vi.stubGlobal('fetch', fetch);
    try {
      const channel = new TelegramChannel({ type: 'telegram', enabled: true, token: 'qa-token' });
      expect((await channel.send({ channelId: 'qa-chat', content: 'secret' })).success).toBe(true);
      expect((await channel.send({ channelId: '-100', content: 'secret' })).success).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(readFileSync(lisaJournalPath(), 'utf8')).not.toContain('secret');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('parole directe et réponse vocale progressive : aucune génération en lecture', async () => {
    const { sayNow, makeVoiceReply } = await import('../../src/sensory/voice-loop.js');
    const synth = vi.fn(async () => 'wav');
    const play = vi.fn(async () => true);
    const replyFn = vi.fn(async () => 'Réponse.');
    const streamSpeak = vi.fn();
    expect(await sayNow('secret', { synth, play })).toBe(false);
    await makeVoiceReply({ replyFn, synth, play, streamSpeak })('secret');
    expect(synth).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(replyFn).not.toHaveBeenCalled();
    expect(streamSpeak).not.toHaveBeenCalled();
    expect(
      readLisaJournal().filter((e) => e.operation === 'parole' && e.resultat === 'propose')
    ).toHaveLength(2);
  });
  it('parole autorisée : résultat de lecture audio exact et aucun texte journalisé', async () => {
    actionMode();
    setLisaRule('parole', 'autorise');
    const { sayNow } = await import('../../src/sensory/voice-loop.js');
    const play = vi.fn(async () => true);
    expect(
      await sayNow('secret vocal', {
        synth: async () => join(root, 'wav'),
        play,
        phoneDelivery: 'never',
      })
    ).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(readLisaJournal().at(-1)).toMatchObject({ operation: 'parole', resultat: 'reussi' });
    expect(readFileSync(lisaJournalPath(), 'utf8')).not.toContain('secret vocal');
  });
  it('parole à demander : attend le pont humain avant synthèse et lecture', async () => {
    actionMode();
    let resolve!: (confirmed: boolean) => void;
    const confirmation = new Promise<{ confirmed: boolean }>((r) => {
      resolve = (confirmed) => r({ confirmed });
    });
    ConfirmationService.getInstance().setInteractiveBridge(() => confirmation);
    const { sayNow } = await import('../../src/sensory/voice-loop.js');
    const synth = vi.fn(async () => join(root, 'wav'));
    const play = vi.fn(async () => true);
    const task = sayNow('secret vocal', { synth, play, phoneDelivery: 'never' });
    await new Promise<void>((r) => setImmediate(r));
    expect(synth).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    resolve(true);
    expect(await task).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(readLisaJournal()).toContainEqual(
      expect.objectContaining({ operation: 'parole', resultat: 'accord', decision: 'demande' })
    );
  });
  it.each(['lecture', 'interdit'])(
    'confirmation propriétaire d’un rappel : %s conserve le refus Lisa',
    async (mode) => {
      const gate = createReminderVoiceCoordinator({ code: () => 'a1b2c3d4e5f6' });
      const notifyOwner = vi.fn(async () => true);
      await gate.handleVoice('Lisa, rappelle-moi le rendez-vous à 9h', {
        identity: { role: 'present', confidence: 'medium', channel: 'voice', reason: 'room' },
        robotName: 'Lisa',
        speak: async () => undefined,
        notifyOwner,
      });
      if (mode === 'interdit') {
        actionMode();
        setLisaRule('rappel', 'interdit');
      }
      const result = await gate.confirm('confirme rappel a1b2c3d4e5f6', {
        role: 'owner',
        confidence: 'high',
        channel: 'telegram',
        userId: '1',
        chatId: '1',
        reason: 'telegram_sender_id_allowed',
      });
      expect(result.success).toBe(false);
      expect(await loadReminders()).toEqual([]);
      expect(readLisaJournal().at(-1)?.resultat).toBe(mode === 'lecture' ? 'propose' : 'refuse');
    }
  );
  it('règle sensorielle shell refusée avant lancement', async () => {
    actionMode();
    const victim = join(root, 'canari.txt');
    writeFileSync(victim, 'intact');
    expect(
      (
        await executeSensoryAction(
          { type: 'shell', command: `rm -f '${victim}'` },
          { kind: 'hearing' }
        )
      ).ok
    ).toBe(false);
    expect(readFileSync(victim, 'utf8')).toBe('intact');
    expect(readLisaJournal().at(-1)).toMatchObject({
      operation: 'regle-sensorielle',
      regle: 'interdit',
    });
  });
  it('outil compagnon : colonne interdit appliquée avant registre et confirmation', async () => {
    actionMode();
    setLisaRule('autre', 'interdit');
    const execute = vi.fn(async () => ({ success: true, output: 'local' }));
    const tool: ITool = {
      name: 'weather',
      description: 'QA',
      getSchema: () => ({ name: 'weather', description: 'QA', parameters: { type: 'object' } }),
      execute,
    };
    const registry = new FormalToolRegistry();
    registry.register(tool);
    try {
      const result = await executeCompanionTool(
        'weather',
        {},
        {
          identity: {
            role: 'owner',
            confidence: 'high',
            channel: 'telegram',
            reason: 'telegram_sender_id_allowed',
          },
          registry,
        }
      );
      expect(result.success).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(readLisaJournal().at(-1)?.resultat).toBe('refuse');
    } finally {
      registry.unregister('weather');
    }
  });
  it('sans opt-in, même alerte et même rappel qu’avant, aucun dossier Lisa', async () => {
    vi.stubEnv('CODEBUDDY_LISA_REGLES', '');
    const fetch = vi.fn(async () => ({ ok: true }));
    expect(await sendTelegramAlert('message habituel', undefined, { fetch })).toBe(true);
    await addReminder({ label: 'rappel', time: '09:00' });
    const say = vi.fn(async () => undefined);
    const notify = vi.fn(async () => true);
    await runReminderTick(new Date('2026-09-30T09:00:30'), { say, notify });
    expect(say).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(existsSync(lisaDirectory())).toBe(false);
  });
});
