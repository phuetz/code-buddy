/**
 * A config file that is present on the messaging-reset path but cannot be
 * analysed must cancel the reset, even when another file sets a mode.
 * The home directory is a throwaway created inside the test. Product modules
 * are imported only after that, so the loader's captured path matches it.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-reset-cfg-'));
  dirs.push(dir);
  return dir;
}

interface ConfigCase {
  id: string;
  secret: string;
  user?: string;
  project?: string;
  projectIsDirectory?: boolean;
  /**
   * Project file content when the configuration is first loaded, before the
   * turn. It is replaced by `project` before the reset runs.
   */
  projectAtLoad?: string;
  /** Project file mode when the configuration is first loaded (POSIX only). */
  projectModeAtLoad?: number;
  /**
   * Runs after the configuration is loaded and before the turn: moves the
   * process to another project, edits, creates or removes a config file.
   */
  afterLoad?: (files: DriftFiles) => void;
  /** Value of CODEBUDDY_SESSION_RESET_ARCHIVE_DIR instead of the temp dir. */
  archiveEnv?: string;
  /** True when the reset must not erase the secret. */
  keep: boolean;
}

interface DriftFiles {
  userFile: string;
  projectFile: string;
  /** A second project with its own config file, made the current directory. */
  moveToProject: (content?: string) => void;
}

const IDLE = '[session_reset]\nmode = "idle"\nidle_minutes = 1\n';
const TRUNCATED = '[session_reset\nmode = "none"\n';
const NONE = '[session_reset]\nmode = "none"\n';

async function exercise(spec: ConfigCase): Promise<{ projectDir: string }> {
  const fakeHome = tempDir();
  const projectDir = tempDir();
  const sessionsDir = tempDir();
  const archiveDir = tempDir();
  const previous = {
    home: process.env.HOME,
    profile: process.env.USERPROFILE,
    sessions: process.env.CODEBUDDY_SESSIONS_DIR,
    archive: process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR,
    history: process.env.CODEBUDDY_CHANNEL_HISTORY,
    cwd: process.cwd(),
  };
  const restore = (
    key:
      | 'HOME'
      | 'USERPROFILE'
      | 'CODEBUDDY_SESSIONS_DIR'
      | 'CODEBUDDY_SESSION_RESET_ARCHIVE_DIR'
      | 'CODEBUDDY_CHANNEL_HISTORY',
    value: string | undefined,
  ): void => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  let changedDir = false;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
  process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = spec.archiveEnv ?? archiveDir;
  process.env.CODEBUDDY_CHANNEL_HISTORY = 'false';
  try {
    process.chdir(projectDir);
    changedDir = true;
    mkdirSync(path.join(fakeHome, '.codebuddy'), { recursive: true });
    mkdirSync(path.join(projectDir, '.codebuddy'), { recursive: true });
    if (spec.user !== undefined) {
      writeFileSync(path.join(fakeHome, '.codebuddy', 'config.toml'), spec.user);
    }
    if (spec.projectIsDirectory) {
      mkdirSync(path.join(projectDir, '.codebuddy', 'config.toml'));
    } else if (spec.project !== undefined) {
      writeFileSync(path.join(projectDir, '.codebuddy', 'config.toml'), spec.projectAtLoad ?? spec.project);
    }
    const projectFile = path.join(projectDir, '.codebuddy', 'config.toml');
    if (spec.projectModeAtLoad !== undefined) chmodSync(projectFile, spec.projectModeAtLoad);

    vi.resetModules();
    const toml = await import('../../src/config/toml-config.js');
    const store = await import('../../src/persistence/session-store.js');
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    const handlers = await import('../../src/commands/handlers/channel-handlers.js');
    toml.resetConfigManager();
    store.resetSessionStore();
    handlers.__resetChannelAIHandlerForTests();
    if (spec.projectAtLoad !== undefined || spec.projectModeAtLoad !== undefined || spec.afterLoad) {
      // The process read its configuration earlier, then the file was repaired.
      toml.getConfigManager().getConfig();
      if (spec.projectModeAtLoad !== undefined) chmodSync(projectFile, 0o644);
      if (spec.project !== undefined) writeFileSync(projectFile, spec.project);
      spec.afterLoad?.({
        userFile: path.join(fakeHome, '.codebuddy', 'config.toml'),
        projectFile,
        moveToProject: (content) => {
          const other = tempDir();
          mkdirSync(path.join(other, '.codebuddy'), { recursive: true });
          if (content !== undefined) writeFileSync(path.join(other, '.codebuddy', 'config.toml'), content);
          process.chdir(other);
        },
      });
    }

    const sessionKey = `reset-config-${spec.id}`;
    const file = path.join(sessionsDir, `${sessionKey}.json`);
    const idle = new Date(Date.now() - 3_600_000).toISOString();
    writeFileSync(file, JSON.stringify({
      id: sessionKey,
      name: 'r',
      workingDirectory: sessionsDir,
      model: 'r',
      messages: [{ type: 'user', content: spec.secret, timestamp: idle }],
      createdAt: idle,
      lastAccessedAt: idle,
    }));
    handlers.__seedLocalCompanionHistoryForTests(sessionKey, 'AGENT_OLD', Date.now() - 3_600_000);
    await handlers.__resetInboundMessagingSessionForTests(sessionKey);

    let raw = '';
    try {
      raw = readFileSync(file, 'utf8');
    } catch (error) {
      raw = `READ_FAILED:${error instanceof Error ? error.name : 'read'}`;
    }
    const archived = messaging.readMessagingMemoryArchive(archiveDir, sessionKey, 'session-store');
    const diagnostic = {
      id: spec.id,
      kept: raw.includes(spec.secret),
      archived: archived.includes(spec.secret),
    };
    console.log('CONFIG_RESET', JSON.stringify(diagnostic));
    if (spec.keep) {
      expect(raw, `${spec.id} secret conserve`).toContain(spec.secret);
      expect(archived, `${spec.id} archive du secret`).not.toContain(spec.secret);
    } else {
      expect(raw, `${spec.id} secret efface`).not.toContain(spec.secret);
      expect(archived, `${spec.id} archive presente`).toContain(spec.secret);
    }
    return { projectDir };
  } finally {
    if (changedDir) process.chdir(previous.cwd);
    restore('HOME', previous.home);
    restore('USERPROFILE', previous.profile);
    restore('CODEBUDDY_SESSIONS_DIR', previous.sessions);
    restore('CODEBUDDY_SESSION_RESET_ARCHIVE_DIR', previous.archive);
    restore('CODEBUDDY_CHANNEL_HISTORY', previous.history);
    vi.resetModules();
  }
}

describe('configuration presente mais inanalysable', () => {
  it('un toml de projet tronque annule la remise a zero meme si l utilisateur vaut idle', async () => {
    await exercise({
      id: 'projet-tronque',
      secret: 'PROJET_TOML_INANALYSABLE',
      user: IDLE,
      project: TRUNCATED,
      keep: true,
    });
  });

  it('un toml utilisateur tronque annule la remise a zero meme si le projet vaut idle', async () => {
    await exercise({
      id: 'utilisateur-tronque',
      secret: 'UTILISATEUR_TOML_INANALYSABLE',
      user: TRUNCATED,
      project: IDLE,
      keep: true,
    });
  });

  it('un config.toml de projet qui est un dossier annule la remise a zero', async () => {
    await exercise({
      id: 'projet-dossier',
      secret: 'PROJET_CONFIG_DOSSIER',
      user: IDLE,
      projectIsDirectory: true,
      keep: true,
    });
  });

  it('un toml de projet inanalysable au chargement puis repare annule la remise a zero', async () => {
    await exercise({
      id: 'projet-repare',
      secret: 'PROJET_REPARE_APRES_CHARGEMENT',
      user: IDLE,
      projectAtLoad: TRUNCATED,
      project: NONE,
      keep: true,
    });
  });

  it.runIf(process.platform !== 'win32')(
    'un toml de projet illisible au chargement puis relisible annule la remise a zero',
    async () => {
      await exercise({
        id: 'projet-relisible',
        secret: 'PROJET_RELISIBLE_APRES_CHARGEMENT',
        user: IDLE,
        project: NONE,
        projectModeAtLoad: 0o000,
        keep: true,
      });
    },
  );

  it('un toml de projet sain au chargement puis tronque annule la remise a zero', async () => {
    await exercise({
      id: 'projet-abime',
      secret: 'PROJET_ABIME_APRES_CHARGEMENT',
      user: IDLE,
      projectAtLoad: IDLE,
      project: TRUNCATED,
      keep: true,
    });
  });

  it('un toml utilisateur idle et un projet absent laisse la remise a zero se faire', async () => {
    await exercise({
      id: 'idle-autorise',
      secret: 'IDLE_AUTORISE_SECRET',
      user: IDLE,
      keep: false,
    });
  });
});

/**
 * Class: the policy applied must be the one the files describe when the
 * reset runs. The cached policy may have been built in another directory or
 * from another content; any difference cancels, an identical policy does not.
 */
describe('politique chargee differente de celle des fichiers au moment de la remise a zero', () => {
  it('changement de repertoire vers un projet qui vaut none annule la remise a zero', async () => {
    await exercise({
      id: 'cwd-vers-none',
      secret: 'CWD_VERS_NONE',
      project: IDLE,
      afterLoad: (files) => files.moveToProject(NONE),
      keep: true,
    });
  });

  it('changement de repertoire vers un projet sans configuration annule la remise a zero', async () => {
    await exercise({
      id: 'cwd-vers-absent',
      secret: 'CWD_VERS_ABSENT',
      project: IDLE,
      afterLoad: (files) => files.moveToProject(),
      keep: true,
    });
  });

  it('changement de repertoire depuis un projet none vers un projet idle ne remet pas a zero', async () => {
    await exercise({
      id: 'cwd-depuis-none',
      secret: 'CWD_DEPUIS_NONE',
      project: NONE,
      afterLoad: (files) => files.moveToProject(IDLE),
      keep: true,
    });
  });

  it('changement de repertoire vers un projet de meme politique laisse la remise a zero se faire', async () => {
    await exercise({
      id: 'cwd-meme-politique',
      secret: 'CWD_MEME_POLITIQUE',
      project: IDLE,
      afterLoad: (files) => files.moveToProject(`# autre projet\n${IDLE}`),
      keep: false,
    });
  });

  it('un projet passe de idle a none apres chargement annule la remise a zero', async () => {
    await exercise({
      id: 'projet-edite-none',
      secret: 'PROJET_EDITE_NONE',
      project: IDLE,
      afterLoad: (files) => writeFileSync(files.projectFile, NONE),
      keep: true,
    });
  });

  it('un projet qui allonge idle_minutes apres chargement annule la remise a zero', async () => {
    // Même mode, autre paramètre : la politique relue au moment de l'effacement garde la session.
    await exercise({
      id: 'projet-edite-delai',
      secret: 'PROJET_EDITE_DELAI',
      project: IDLE,
      afterLoad: (files) => writeFileSync(files.projectFile, '[session_reset]\nmode = "idle"\nidle_minutes = 100000\n'),
      keep: true,
    });
  });

  it('un projet none cree apres chargement annule la remise a zero', async () => {
    await exercise({
      id: 'projet-cree-none',
      secret: 'PROJET_CREE_NONE',
      user: IDLE,
      afterLoad: (files) => writeFileSync(files.projectFile, NONE),
      keep: true,
    });
  });

  it('un projet idle supprime apres chargement annule la remise a zero', async () => {
    await exercise({
      id: 'projet-supprime',
      secret: 'PROJET_SUPPRIME',
      user: NONE,
      project: IDLE,
      afterLoad: (files) => rmSync(files.projectFile),
      keep: true,
    });
  });

  it('un utilisateur passe de idle a none apres chargement annule la remise a zero', async () => {
    await exercise({
      id: 'utilisateur-edite-none',
      secret: 'UTILISATEUR_EDITE_NONE',
      user: IDLE,
      afterLoad: (files) => writeFileSync(files.userFile, NONE),
      keep: true,
    });
  });

  it('une modification hors session_reset laisse la remise a zero se faire', async () => {
    await exercise({
      id: 'edition-hors-section',
      secret: 'EDITION_HORS_SECTION',
      project: IDLE,
      afterLoad: (files) => writeFileSync(files.projectFile, `${IDLE}\n[ui]\ntheme = "sombre"\n`),
      keep: false,
    });
  });

  it('un dossier d archive relatif annule la remise a zero sans rien ecrire dans le projet', async () => {
    const relative = path.join('archive-relative', 'sous-dossier');
    const { projectDir } = await exercise({
      id: 'archive-relative',
      secret: 'ARCHIVE_RELATIVE',
      user: IDLE,
      archiveEnv: relative,
      keep: true,
    });
    expect(existsSync(path.join(projectDir, 'archive-relative')), 'archive ecrite dans le projet').toBe(false);
  });
});

describe('configuration ecrite par le produit', () => {
  it('le toml que le produit serialise n est jamais classe inanalysable', async () => {
    vi.resetModules();
    const toml = await import('../../src/config/toml-config.js');
    const written = toml.serializeTOML({
      ...toml.DEFAULT_CONFIG,
      session_reset: { mode: 'idle', idle_minutes: 30, at_hour: 4 },
    });
    expect(toml.messagingResetConfigSyntaxError(written), 'toml du produit refuse').toBeNull();
  });
});
