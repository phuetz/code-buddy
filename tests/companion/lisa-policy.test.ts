import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  defaultLisaRules,
  handleLisaApproval,
  lisaDirectory,
  lisaJournalPath,
  lisaRulesPath,
  lisaToolIntent,
  readLisaJournal,
  readLisaRules,
  runLisaAction,
  setLisaRule,
  updateLisaRules,
  withLisaContext,
} from '../../src/companion/lisa-policy.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import {
  getRemoteApprovalService,
  resetRemoteApprovalService,
} from '../../src/security/remote-approval.js';
import {
  getPermissionModeManager,
  resetPermissionModeManager,
} from '../../src/security/permission-modes.js';
import { Command } from 'commander';
import { registerLisaCommands } from '../../src/commands/cli/lisa-commands.js';

describe('Lisa — règles et journal sans contenu privé', () => {
  let root: string;
  beforeEach(() => {
    mkdirSync('_qa/lisa-regles/home', { recursive: true });
    root = mkdtempSync('_qa/lisa-regles/home/policy-');
    vi.stubEnv('CODEBUDDY_HOME', join(root, '.codebuddy'));
    vi.stubEnv('CODEBUDDY_LISA_REGLES', 'true');
    resetPermissionModeManager();
    resetRemoteApprovalService();
  });
  afterEach(() => {
    ConfirmationService.getInstance().setInteractiveBridge(null);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
  const intent = {
    action: 'message-patrice',
    trigger: 'morning',
    operation: 'initiative',
  } as const;
  const actionMode = () => updateLisaRules((r) => ({ ...r, regime: 'action' }));

  it.each(['', 'false', 'TRUE', '1'])(
    'sans la valeur exacte true (%s), aucune lecture ni journal ni confirmation',
    async (flag) => {
      vi.stubEnv('CODEBUDDY_LISA_REGLES', flag);
      const value = { success: true, output: 'secret non journalisé' };
      const execute = vi.fn(async () => value);
      const ask = vi.fn();
      expect(await runLisaAction(intent, execute, null, ask)).toBe(value);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(ask).not.toHaveBeenCalled();
      expect(existsSync(lisaDirectory())).toBe(false);
    }
  );
  it('lecture par défaut : une note proposée, aucun effet même si la règle autorise', async () => {
    const execute = vi.fn();
    expect(readLisaRules()).toEqual(defaultLisaRules());
    expect(await runLisaAction(intent, execute, false)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(readLisaJournal()).toEqual([
      expect.objectContaining({
        trigger: 'morning',
        decision: 'autorise',
        resultat: 'propose',
        regime: 'lecture',
      }),
    ]);
  });
  it('lecture : outils de consultation exécutés et tracés', async () => {
    expect(
      await runLisaAction(
        lisaToolIntent('view_file', 'voice-command'),
        async () => ({ success: true }),
        null
      )
    ).toEqual({ success: true });
    expect(readLisaJournal().map((e) => e.resultat)).toEqual(['commence', 'reussi']);
  });
  it('action + autorisé : début et résultat corrélés, sans contenu du retour', async () => {
    actionMode();
    const sensitive = 'token=super-secret image=data:image/jpeg;base64,AAA';
    expect(await runLisaAction(intent, async () => sensitive, null)).toBe(sensitive);
    const entries = readLisaJournal();
    expect(entries.map((e) => e.resultat)).toEqual(['commence', 'reussi']);
    expect(new Set(entries.map((e) => e.id)).size).toBe(1);
    expect(readFileSync(lisaJournalPath(), 'utf8')).not.toContain(sensitive);
    if (process.platform !== 'win32') expect(statSync(lisaJournalPath()).mode & 0o777).toBe(0o600);
  });
  it.each([true, false])(
    'demander : aucun appel avant la réponse explicite %s',
    async (approved) => {
      actionMode();
      setLisaRule('message-patrice', 'demander');
      let resolve!: (value: boolean) => void;
      const answer = new Promise<boolean>((r) => {
        resolve = r;
      });
      const execute = vi.fn(async () => true);
      const task = runLisaAction(intent, execute, false, () => answer);
      expect(execute).not.toHaveBeenCalled();
      resolve(approved);
      expect(await task).toBe(approved);
      expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0);
      expect(readLisaJournal().at(-1)?.resultat).toBe(approved ? 'reussi' : 'refuse');
    }
  );
  it('demander force la confirmation malgré bypassPermissions, AUTO_CONFIRM et flags', async () => {
    actionMode();
    setLisaRule('message-patrice', 'demander');
    vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
    getPermissionModeManager().setMode('bypassPermissions');
    const service = ConfirmationService.getInstance();
    service.setSessionFlag('allOperations', true);
    const bridge = vi.fn(async () => ({ confirmed: false }));
    service.setInteractiveBridge(bridge);
    const execute = vi.fn(async () => true);
    expect(await runLisaAction(intent, execute, false)).toBe(false);
    expect(bridge).toHaveBeenCalledWith(expect.objectContaining({ forcePrompt: true }));
    expect(execute).not.toHaveBeenCalled();
    service.setSessionFlag('allOperations', false);
  });
  it.each(['lecture', 'action'] as const)(
    'interdit gagne en régime %s, sans possibilité de confirmer',
    async (regime) => {
      updateLisaRules((r) => ({ ...r, regime }));
      const execute = vi.fn();
      const ask = vi.fn(async () => true);
      expect(
        await runLisaAction(lisaToolIntent('bash', 'voice-command'), execute, false, ask)
      ).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
      expect(readLisaJournal().at(-1)).toMatchObject({
        action: 'commande-shell',
        regle: 'interdit',
        resultat: 'refuse',
      });
    }
  );
  it('changement de règle pendant une confirmation annule la requête', async () => {
    actionMode();
    setLisaRule('message-patrice', 'demander');
    const execute = vi.fn();
    await runLisaAction(intent, execute, false, async () => {
      setLisaRule('message-patrice', 'interdit');
      return true;
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it('une configuration invalide et un journal indisponible empêchent les effets', async () => {
    readLisaRules();
    const execute = vi.fn();
    writeFileSync(lisaRulesPath(), '{invalid');
    await runLisaAction(intent, execute, false);
    expect(readLisaJournal().at(-1)?.decision).toBe('refuse');
    writeFileSync(lisaRulesPath(), JSON.stringify({ ...defaultLisaRules(), regime: 'action' }));
    rmSync(lisaJournalPath());
    mkdirSync(lisaJournalPath());
    await runLisaAction(intent, execute, false);
    expect(execute).not.toHaveBeenCalled();
  });
  it('retour false et exception sont des échecs, sans texte privé dans le journal', async () => {
    actionMode();
    await runLisaAction(intent, async () => false, false);
    await runLisaAction(
      intent,
      async () => {
        throw new Error('secret=123');
      },
      false
    );
    expect(readLisaJournal().filter((e) => e.resultat === 'echec')).toHaveLength(2);
    expect(readFileSync(lisaJournalPath(), 'utf8')).not.toContain('secret');
    expect(readLisaJournal('2999-01-01')).toEqual([]);
    expect(() => readLisaJournal('hier')).toThrow('--since');
  });
  it('les noms externes et alias restent bornés, les outils inconnus demandent', () => {
    expect(lisaToolIntent('shell_exec', 'voice-command').action).toBe('commande-shell');
    expect(lisaToolIntent('file_write', 'voice-command').action).toBe('ecrire-fichier');
    expect(lisaToolIntent('browser_click', 'voice-command').action).toBe('publier');
    expect(lisaToolIntent('mcp__secret-token', 'voice-command')).toMatchObject({
      action: 'autre',
      tool: 'outil-inconnu',
    });
  });
  it('un outil imbriqué reçoit sa propre confirmation, même dans la même catégorie', async () => {
    actionMode();
    setLisaRule('commande-shell', 'demander');
    const ask = vi.fn(async () => true);
    await runLisaAction(
      lisaToolIntent('code_exec', 'voice-command'),
      () => runLisaAction(lisaToolIntent('bash', 'voice-command'), async () => true, false, ask),
      false,
      ask
    );
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it('le contexte Lisa ne fuit pas dans une action concurrente', async () => {
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const task = withLisaContext('voice-command', async () => {
      await wait;
      return true;
    });
    expect(await import('../../src/companion/lisa-policy.js').then((m) => m.inLisaTurn())).toBe(
      false
    );
    release();
    await task;
  });
  it.each(['oui', 'confirme lisa'])(
    'réutilise une demande Telegram pour %s, propriétaire et usage unique',
    async (text) => {
      const svc = getRemoteApprovalService();
      svc.registerChannel('telegram', async () => undefined);
      const task = svc.requestApproval({
        toolName: 'lisa:outil',
        summary: 'Autre action',
        timeoutMs: 1000,
      });
      await new Promise<void>((r) => setImmediate(r));
      const id = svc.getPending()[0]!.id;
      const answer = text === 'oui' ? text : `${text} ${id}`;
      expect(await handleLisaApproval(answer, false)).toContain('propriétaire');
      expect(svc.getPending()).toHaveLength(1);
      expect(await handleLisaApproval(answer, true)).toBe('Accord Lisa reçu.');
      expect(await task).toBe(true);
      expect(await handleLisaApproval(answer, true)).toBeNull();
    }
  );
  it('CLI : trois colonnes, déplacement exclusif, régime et filtre du journal', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const run = async (...args: string[]) => {
      const cmd = new Command().exitOverride();
      registerLisaCommands(cmd);
      await cmd.parseAsync(['node', 'buddy', 'lisa', ...args]);
    };
    await run('regles', 'autoriser', 'parole');
    await run('regles', 'demander', 'parole');
    await run('regles', 'interdire', 'parole');
    await run('regime', 'action');
    await run('regles', 'list');
    expect(readLisaRules().interdit).toContain('parole');
    expect(readLisaRules().autorise).not.toContain('parole');
    expect(output.mock.calls.map((c) => c[0]).join('')).toContain('AUTORISÉ | DEMANDER | INTERDIT');
    await runLisaAction(intent, async () => true, false);
    await run('journal', '--since', '2000-01-01', '--json');
    expect(output.mock.calls.map((c) => c[0]).join('')).toContain('"resultat":"reussi"');
  });
});
