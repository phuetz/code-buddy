/**
 * Analyse structurelle des mots de commande d'un script shell.
 *
 * Pourquoi : lister des orthographes interdites (`bash`, `''bash`, `$'\x62ash'`,
 * `ba${a}sh`, `$cmd`…) ne peut pas gagner, Bash en a une infinité. On inverse
 * donc la question et on est FERMÉ PAR DÉFAUT : on découpe le script en
 * commandes simples et, pour chaque MOT EN POSITION DE COMMANDE,
 *
 *  - s'il n'est pas un littéral simple (aucune expansion, quote, antislash,
 *    glob ni substitution) → finding « mot de commande non littéral » ;
 *  - s'il est un littéral, son nom de base est comparé à la liste des
 *    interpréteurs ;
 *  - si le texte ne se laisse pas découper sûrement → finding « illisible ».
 *
 * Les ARGUMENTS non littéraux restent permis (`echo "$HOME"`, `ls -la "$d"`) :
 * seul le mot de commande compte. Module pur, sans E/S.
 */

export type ShellWordFindingKind = 'non-literal-command-word' | 'interpreter-command-word' | 'unparseable-shell';

export interface ShellWordFinding {
  kind: ShellWordFindingKind;
  /** Ligne (1-indexée, décalée de `baseLine - 1`) du mot ou de l'échec. */
  line: number;
  /** Mot brut tel qu'écrit, ou raison de l'échec. */
  word: string;
}

/** Littéral simple : rien que Bash ne puisse développer autrement que lui-même. */
const LITERAL_WORD = /^(?:~\/)?[A-Za-z0-9_./+:@%,-]+$/;
const LITERAL_BUILTINS = new Set(['[', '[[', ':']);

/** Noms de shells et d'interpréteurs qui exécutent leur argument comme du code. */
const SHELL_NAMES = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'ash', 'csh', 'tcsh', 'mksh', 'pdksh', 'rbash', 'busybox',
  'pwsh', 'powershell', 'osascript',
]);
const SHELL_INTERPRETERS = new Set([
  ...SHELL_NAMES,
  // `source f` / `. f` exécutent f comme du shell, exactement comme `bash f` : même traitement,
  // quelle que soit la cible (suffixe .sh compris, nom dynamique compris).
  'source', '.',
]);

/**
 * Interpréteurs de langage : un mot de commande de ce nom est suspect quand il
 * reçoit du code (`-c`, `-e`, `-`, stdin) ou un fichier ; `-m module`,
 * `--version`, `--help` restent permis.
 */
interface RuntimeSpec {
  /** Extension de ses propres scripts : le fichier est alors lu par le pare-feu comme un script de ce langage. */
  own?: RegExp;
  code: RegExp;
  safe: RegExp;
  optArg: readonly string[];
}
const RUNTIMES: ReadonlyArray<readonly [RegExp, RuntimeSpec]> = [
  [/^(?:python|pypy)[\d.]*$/, { own: /\.pyw?$/i, code: /^-[A-Za-z]*c$/, safe: /^(?:-[A-Za-z]*m|--version|-V+|-h|--help|-\?)$/, optArg: ['-W', '-X', '-Q'] }],
  [/^(?:node|nodejs)$/, { own: /\.(?:[cm]?js)$/i, code: /^(?:-e|--eval|-p|--print|-pe|-i|--interactive)$/, safe: /^(?:--version|-v|-h|--help|-c|--check)$/, optArg: ['-r', '--require', '--loader', '--import', '--experimental-loader', '--env-file'] }],
  [/^perl[\d.]*$/, { own: /\.p[lm]$/i, code: /^-[A-Za-z]*[eE]/, safe: /^(?:-v|-V|-h|--version|-c)$/, optArg: ['-I'] }],
  [/^ruby[\d.]*$/, { own: /\.rb$/i, code: /^(?:-[A-Za-z]*e|--eval)$/, safe: /^(?:-v|--version|-h|--help|-c)$/, optArg: ['-r', '-I'] }],
  [/^php[\d.]*$/, { own: /\.php$/i, code: /^-[rRBEF]$/, safe: /^(?:-v|--version|-h|--help|-l|-m|-i)$/, optArg: ['-d', '-c'] }],
  [/^(?:lua|luajit)[\d.]*$/, { own: /\.lua$/i, code: /^-e$/, safe: /^(?:-v|--version)$/, optArg: ['-l'] }],
  [/^crontab$/, { code: /^-$/, safe: /^(?:-[lrh]|--help)$/, optArg: ['-u'] }],
  [/^(?:tclsh|wish|expect|Rscript|julia|groovy|at|batch)[\d.]*$/, { code: /^(?:-c|-e|-E|--eval|--command)$/, safe: /^(?:-v|--version|-h|--help)$/, optArg: [] }],
];

/** Commandes dont l'argument ne désigne qu'un nom (jamais un programme à lancer). */
const EXEMPT_ARG_COMMANDS = new Set([
  'echo', 'printf', 'which', 'type', 'whereis', 'ls', 'stat', 'file', 'grep', 'egrep', 'fgrep', 'rg', 'man', 'test', '[',
  'apt', 'apt-get', 'aptitude', 'apk', 'yum', 'dnf', 'brew', 'pip', 'pip3', 'npm', 'dpkg', 'rpm', 'readlink', 'realpath',
  'basename', 'dirname', 'wc', 'diff', 'cmp', 'sha256sum', 'sha1sum', 'md5sum', 'find',
]);

/** Commandes dont les arguments `NOM=valeur` sont des affectations, pas des arguments de programme. */
const ASSIGNING_BUILTINS = new Set(['export', 'declare', 'local', 'readonly', 'typeset']);

/** Primitives de copie et de lien : un nom de fichier construit par substitution y est suspect. */
const COPY_PRIMITIVES = new Set(['cp', 'mv', 'ln', 'install', 'hash', 'rsync', 'dd']);

/** Options qui reçoivent du CODE shell : le mot suivant est analysé comme une liste de commandes. */
const CODE_OPTS: Record<string, readonly string[]> = {
  script: ['-c', '--command'], su: ['-c', '--command'], runuser: ['-c', '--command'], flock: ['-c', '--command'],
  sg: ['-c'], env: ['-S', '--split-string'], docker: ['--entrypoint'], podman: ['--entrypoint'], nerdctl: ['--entrypoint'],
};

/** `find … -exec CMD`, `gdb --args CMD` : le mot qui suit une de ces options est une commande. */
const TRIGGERS: Record<string, ReadonlySet<string>> = {
  find: new Set(['-exec', '-execdir', '-ok', '-okdir']),
  gdb: new Set(['--args', '-args']),
  lldb: new Set(['--']),
};

/** `print … > fichier` dans un programme awk : le programme écrit où il veut (hors flux standard). */
const AWK_REDIRECT = /\bprintf?\b[^;}()\n]*>>?\s*(?!"?\/dev\/(?:stderr|stdout|null)"?)\S/;
const GIT_EXEC_KEYS = /^(?:core\.(?:sshcommand|pager|editor|fsmonitor|askpass|hookspath)|sequence\.editor|credential\.helper|diff\.external|gpg\.(?:\w+\.)?program|filter\..*\.(?:clean|smudge|process)|uploadpack\.packobjectshook)$/i;
const GIT_EXEC_CONFIG = /^(?:alias\.[^=]*=!|core\.(?:sshcommand|pager|editor|fsmonitor|askpass|hookspath)=|sequence\.editor=|credential\.helper=!|diff\.external=|gpg\.(?:\w+\.)?program=|filter\.[^=]*\.(?:clean|smudge|process)=|uploadpack\.packobjectshook=)/i;

/** Programmes qui exécutent du code reçu en argument : règles par commande. Renvoie une raison ou null. */
const ARG_RULES: Record<string, (raw: string, value: string, prev: string) => boolean> = {
  make: (raw) => raw === '-f' || raw === '--file' || raw === '--makefile' || /^-f./.test(raw) || /^--(?:file|makefile)=/.test(raw),
  gmake: (raw) => raw === '-f' || raw === '--file' || /^-f./.test(raw) || /^--(?:file|makefile)=/.test(raw),
  sed: (r, v) => /^-[A-Za-z]*f$|^--file(?:=|$)/.test(r) ||  /(?:^|[;{}\s])e(?:\s|;|$|\})|\/[gIiMmp0-9]*e[gIiMmp0-9]*(?:;|\s|$|\})/.test(v),
  gsed: (r, v) => /^-[A-Za-z]*f$|^--file(?:=|$)/.test(r) ||  /(?:^|[;{}\s])e(?:\s|;|$|\})|\/[gIiMmp0-9]*e[gIiMmp0-9]*(?:;|\s|$|\})/.test(v),
  awk: (r, v) => /^-[A-Za-z]*f$|^--file(?:=|$)/.test(r) || AWK_REDIRECT.test(v) || /\bsystem\s*\(|\|\s*getline|\|&|\bprintf?\b[^;}]*\|\s*["$A-Za-z]/.test(v),
  gawk: (r, v) => /^-[A-Za-z]*f$|^--file(?:=|$)/.test(r) || AWK_REDIRECT.test(v) || /\bsystem\s*\(|\|\s*getline|\|&|\bprintf?\b[^;}]*\|\s*["$A-Za-z]/.test(v),
  mawk: (r, v) => /^-[A-Za-z]*f$|^--file(?:=|$)/.test(r) || AWK_REDIRECT.test(v) || /\bsystem\s*\(|\|\s*getline|\bprintf?\b[^;}]*\|\s*["$A-Za-z]/.test(v),
  git: (raw, v, prev) => (/^alias\./i.test(prev) && v.startsWith('!')) || GIT_EXEC_KEYS.test(prev) || (prev === '-c' && GIT_EXEC_CONFIG.test(v)) || /^--(?:upload-pack|receive-pack|exec)(?:=|$)/.test(raw) || (/^-c.+/.test(raw) && GIT_EXEC_CONFIG.test(v.slice(2))),
  ssh: (_r, v) => /(?:ProxyCommand|LocalCommand)\s*[= ]/i.test(v),
  scp: (_r, v) => /(?:ProxyCommand|LocalCommand)\s*[= ]/i.test(v),
  sftp: (_r, v) => /(?:ProxyCommand|LocalCommand)\s*[= ]/i.test(v),
  rsync: (raw) => raw === '-e' || /^-e./.test(raw) || /^--rsh(?:=|$)/.test(raw),
  tar: (raw) => /^--(?:to-command|checkpoint-action|use-compress-program|rsh-command)(?:=|$)/.test(raw) || /^-I./.test(raw),
  nc: (raw) => /^(?:-e|-c|--exec|--sh-exec)$/.test(raw),
  ncat: (raw) => /^(?:-e|-c|--exec|--sh-exec)$/.test(raw),
  netcat: (raw) => /^(?:-e|-c|--exec|--sh-exec)$/.test(raw),
  socat: (_r, v) => /(?:EXEC|SYSTEM):/i.test(v),
  vim: (_r, v) => /(?:^|:)!|system\(|\bterminal\b/.test(v),
  vi: (_r, v) => /(?:^|:)!|system\(|\bterminal\b/.test(v),
  nvim: (_r, v) => /(?:^|:)!|system\(|\bterminal\b/.test(v),
  ex: (_r, v) => /(?:^|:)!|system\(/.test(v),
  hash: (raw) => raw === '-p',
  capsh: (raw) => raw === '--' || /^--(?:shell|exec)/.test(raw),
};

/** Mots-clés après lesquels un mot de commande commence encore. */
const COMMAND_RESERVED = new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'do', 'done', 'esac']);

interface WrapperSpec {
  /** Options (forme exacte) qui consomment le mot suivant. */
  optArg: readonly string[];
  /** Options qui consomment les DEUX mots suivants. */
  optArg2?: readonly string[];
  /** Options connues qui ne consomment rien. Toute autre option exacte est d'arité inconnue. */
  noArg?: readonly string[];
  /** Mots positionnels avant la commande (durée de timeout, masque de taskset…). */
  positional: number;
  /** Accepte des affectations `VAR=valeur` avant la commande. */
  assign?: boolean;
}

const WRAPPERS: Record<string, WrapperSpec> = {
  sudo: { noArg: ['-n', '-E', '-H', '-S', '-k', '-K', '-b', '-s', '-i', '-A', '-B', '-P', '--non-interactive', '--preserve-env', '--login', '--shell', '--stdin', '--background', '--reset-timestamp', '--set-home', '--askpass'], optArg: ['-u', '-g', '-h', '-p', '-C', '-T', '-r', '-t', '-U', '-D', '--user', '--group', '--host', '--prompt'], positional: 0, assign: true },
  doas: { optArg: ['-u', '-C'], positional: 0 },
  env: { noArg: ['-i', '-0', '-v', '--ignore-environment', '--null', '--debug'], optArg: ['-u', '-C', '--unset', '--chdir'], positional: 0, assign: true },
  nice: { noArg: [], optArg: ['-n', '--adjustment'], positional: 0 },
  nohup: { optArg: [], positional: 0 },
  setsid: { optArg: [], positional: 0 },
  stdbuf: { optArg: ['-i', '-o', '-e', '--input', '--output', '--error'], positional: 0 },
  time: { noArg: ['-p', '-v', '-a', '--portability', '--verbose', '--append'], optArg: ['-f', '-o', '--format', '--output'], positional: 0 },
  timeout: { noArg: ['--foreground', '--preserve-status', '-v', '--verbose'], optArg: ['-s', '-k', '--signal', '--kill-after'], positional: 1 },
  exec: { noArg: ['-c', '-l'], optArg: ['-a'], positional: 0 },
  builtin: { optArg: [], positional: 0 },
  command: { noArg: ['-p'], optArg: [], positional: 0 },
  xargs: { noArg: ['-0', '-r', '-t', '-p', '-x', '-o', '--null', '--no-run-if-empty', '--verbose', '--interactive', '--exit', '--open-tty'], optArg: ['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a', '-J', '-R', '-S', '--max-args', '--max-procs', '--delimiter', '--arg-file', '--replace', '--max-chars', '--max-lines', '--process-slot-var', '--eof', '--max-procs'], positional: 0 },
  watch: { noArg: ['-b', '-c', '-d', '-e', '-g', '-p', '-t', '-x', '--beep', '--color', '--differences', '--errexit', '--chgexit', '--precise', '--no-title', '--exec'], optArg: ['-n', '--interval'], positional: 0 },
  taskset: { optArg: [], positional: 1 },
  chroot: { optArg: ['--userspec', '--groups'], positional: 1 },
  flock: { noArg: ['-n', '-x', '-s', '-u', '-o', '--nonblock', '--exclusive', '--shared', '--unlock', '--close'], optArg: ['-w', '-E', '--timeout'], positional: 1 },
  unbuffer: { optArg: [], positional: 0 },
  strace: { noArg: ['-f', '-ff', '-c', '-C', '-t', '-tt', '-ttt', '-T', '-v', '-x', '-xx', '-y', '-yy', '-q', '-qq', '-r', '-i', '-d', '-D', '-F'], optArg: ['-e', '-o', '-p', '-s', '-u', '-E'], positional: 0 },
  ltrace: { optArg: ['-e', '-o', '-p', '-s', '-u'], positional: 0 },
  valgrind: { optArg: [], positional: 0 },
  nsenter: { optArg: ['-t', '--target', '-S', '--setuid', '-G', '--setgid'], positional: 0 },
  unshare: { optArg: ['-w', '--wd', '-R', '--root', '-S', '--setuid', '-G', '--setgid', '--map-user', '--map-group', '--map-users', '--map-groups', '--setgroups', '--propagation', '--monotonic', '--boottime'], positional: 0 },
  setpriv: { noArg: ['--init-groups', '--clear-groups', '--keep-groups', '--no-new-privs', '--dump', '--list-caps'], optArg: ['--pdeathsig', '--ruid', '--euid', '--rgid', '--egid', '--reuid', '--regid', '--groups', '--inh-caps', '--bounding-set', '--ambient-caps', '--securebits', '--selinux-label', '--apparmor-profile'], positional: 0 },
  runuser: { optArg: ['-u', '--user', '-g', '--group', '-G', '--supp-group'], positional: 0 },
  'systemd-run': { optArg: ['-p', '-u', '--property', '--unit', '--slice'], positional: 0 },
  numactl: { optArg: ['--cpunodebind', '--membind', '--physcpubind', '--interleave', '--preferred', '-C', '-m', '-N', '-i', '-p'], noArg: ['-l', '--localalloc', '-H', '-s', '--show', '--hardware'], positional: 0 },
  fakeroot: { optArg: [], positional: 0 },
  faketime: { optArg: [], positional: 1 },
  proxychains: { optArg: ['-f'], positional: 0 },
  proxychains4: { optArg: ['-f'], positional: 0 },
  torsocks: { optArg: [], positional: 0 },
  rlwrap: { optArg: ['-a', '-C', '-f', '-H', '-s'], positional: 0 },
  firejail: { optArg: [], positional: 0 },
  bwrap: {
    noArg: ['--unshare-all', '--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-net', '--unshare-uts', '--unshare-cgroup', '--share-net', '--die-with-parent', '--new-session', '--as-pid-1', '--clearenv', '--help', '--version', '--disable-userns', '--assert-userns-disabled'],
    optArg: ['--argv0', '--chdir', '--dev', '--proc', '--tmpfs', '--mqueue', '--uid', '--gid', '--hostname', '--unsetenv', '--dir', '--remount-ro', '--perms', '--size', '--cap-add', '--cap-drop', '--seccomp', '--sync-fd', '--info-fd', '--block-fd', '--userns-block-fd', '--lock-file', '--exec-label', '--file-label', '--userns', '--userns2', '--pidns', '--args'],
    optArg2: ['--bind', '--bind-try', '--ro-bind', '--ro-bind-try', '--dev-bind', '--dev-bind-try', '--symlink', '--setenv', '--file', '--bind-data', '--ro-bind-data', '--chmod'],
    positional: 0,
  },
  eatmydata: { optArg: [], positional: 0 },
  caffeinate: { optArg: ['-t', '-w'], positional: 0 },
  'dbus-run-session': { optArg: [], positional: 0 },
  cpulimit: { optArg: ['-l', '-p', '-e'], positional: 0 },
  parallel: { optArg: ['-j', '-n', '-N', '-L', '-S', '-a', '-I', '--jobs', '--arg-file', '--sshlogin'], positional: 0 },
  gosu: { optArg: [], positional: 1 },
  'su-exec': { optArg: [], positional: 1 },
  tini: { optArg: [], positional: 0 },
  'dumb-init': { optArg: [], positional: 0 },
  pkexec: { optArg: ['--user'], positional: 0 },
  sshpass: { optArg: ['-p', '-f', '-d', '-P'], positional: 0 },
  'ssh-agent': { optArg: ['-t', '-a', '-E', '-P'], positional: 0 },
  'xvfb-run': { optArg: ['-e', '-f', '-n', '-p', '-s', '--error-file', '--auth-file', '--server-num', '--server-args'], positional: 0 },
  chrt: { optArg: ['-p'], positional: 1 },
  prlimit: { noArg: [], optArg: [], positional: 0 },
  setarch: { noArg: ['-R', '-3', '-B', '-F', '-I', '-L', '-S', '-T', '-U', '-X', '-Z'], optArg: [], positional: 1 },
  chcon: { noArg: [], optArg: [], positional: 0 },
  runcon: { noArg: [], optArg: [], positional: 1 },
  ionice: { noArg: ['-t', '--ignore'], optArg: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata', '--pid', '--pgid', '--uid'], positional: 0 },
};

/** Imbrication maximale de `$(…)`, sous-shells et eval ; au-delà, texte refusé. */
const MAX_DEPTH = 100;

export function isLiteralCommandWord(word: string): boolean {
  return LITERAL_WORD.test(word) || LITERAL_BUILTINS.has(word);
}

/** Nom d'interpréteur si le littéral (nom de base, sans `.exe`) en est un. */
export function interpreterNameOf(literal: string): string | null {
  const slash = literal.lastIndexOf('/');
  const base = (slash >= 0 ? literal.slice(slash + 1) : literal).replace(/\.exe$/i, '').toLowerCase();
  return SHELL_INTERPRETERS.has(base) ? base : null;
}

class Unparseable extends Error {
  constructor(public readonly at: number, reason: string) {
    super(reason);
  }
}

interface Heredoc {
  delimiter: string;
  stripTabs: boolean;
  quoted: boolean;
}

interface CaseFrame {
  pattern: boolean;
}

interface WrapperState {
  name: string;
  spec: WrapperSpec;
  positional: number;
  skip: number;
}

interface RuntimeState {
  spec: RuntimeSpec;
  decided: boolean;
  skip: number;
  at: number;
  word: string;
}

interface CommandWordResult {
  wrapper?: WrapperState;
  code?: 'eval' | 'trap';
  triggers?: ReadonlySet<string>;
  base?: string;
  exempt?: boolean;
  runtime?: RuntimeState;
}

interface CmdState {
  wrapper: WrapperState | null;
  code: 'eval' | 'trap' | null;
  codeNext: boolean;
  triggers: ReadonlySet<string> | null;
  trigger: boolean;
  base: string;
  exempt: boolean;
  runtime: RuntimeState | null;
  prev: string;
  coproc: boolean;
  /** Après une option d'arité inconnue : les deux prochains mots non-option peuvent être la commande. */
  uncertain: number;
}

class ShellCommandParser {
  private pos = 0;
  private depth = 0;
  private work = 0;
  private readonly lineStarts: number[] = [0];
  private pendingHeredocs: Heredoc[] = [];
  readonly findings: ShellWordFinding[] = [];

  /**
   * Valeurs littérales jamais affectées à chaque variable (union, jamais retirées :
   * fermé). `c=bash` puis `"$c"` désigne bash où que `$c` apparaisse.
   */
  private readonly vars: Map<string, Set<string>>;
  private collect: string[] | null = null;

  constructor(private readonly s: string, private readonly baseLine: number, private readonly runtimes = true, vars?: Map<string, Set<string>>) {
    this.vars = vars ?? new Map();
    for (let i = 0; i < s.length; i++) if (s[i] === '\n') this.lineStarts.push(i + 1);
  }

  run(): void {
    try {
      this.parseList(false);
      if (this.pos < this.s.length) throw new Unparseable(this.pos, 'parenthèse fermante sans ouvrante');
    } catch (error) {
      // Tout ce qui n'est pas une lecture réussie échoue fermé, y compris un débordement de pile.
      const at = error instanceof Unparseable ? error.at : this.pos;
      const reason = error instanceof Unparseable ? error.message : 'analyse interrompue';
      this.findings.push({ kind: 'unparseable-shell', line: this.lineOf(at), word: reason });
    }
  }

  private lineOf(at: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= at) lo = mid; else hi = mid - 1;
    }
    return this.baseLine + lo;
  }

  private fail(at: number, reason: string): never {
    throw new Unparseable(at, reason);
  }

  private flag(kind: ShellWordFindingKind, at: number, word: string): void {
    this.findings.push({ kind, line: this.lineOf(at), word: word.length > 80 ? `${word.slice(0, 77)}...` : word });
  }

  /** Vérifie un mot dont on sait qu'il sera EXÉCUTÉ. */
  private checkCommandWord(raw: string, at: number): void {
    if (!isLiteralCommandWord(raw)) {
      this.flag('non-literal-command-word', at, raw);
      return;
    }
    if (interpreterNameOf(raw)) this.flag('interpreter-command-word', at, raw);
  }

  private skipBlanks(): void {
    for (;;) {
      const c = this.s[this.pos];
      if (c === ' ' || c === '\t' || c === '\r') this.pos++;
      else if (c === '\\' && this.s[this.pos + 1] === '\n') this.pos += 2;
      else if (c === '\\' && this.s[this.pos + 1] === '\r' && this.s[this.pos + 2] === '\n') this.pos += 3;
      else return;
    }
  }

  /**
   * Analyse une liste de commandes jusqu'à `)` (si `nested`) ou la fin.
   * En `nested`, consomme la `)` fermante. `argsOnly` : contenu d'un tableau
   * `a=( … )`, des mots sans commandes.
   */
  private parseList(nested: boolean, argsOnly = false): void {
    if (++this.depth > MAX_DEPTH) this.fail(this.pos, 'imbrication trop profonde');
    try {
      this.parseListBody(nested, argsOnly);
    } finally {
      this.depth--;
    }
  }

  private parseListBody(nested: boolean, argsOnly: boolean): void {
    const s = this.s;
    let expectCommand = !argsOnly;
    let redirectTarget = false;
    const st: CmdState = {
      wrapper: null, code: null, codeNext: false, triggers: null, trigger: false, base: '', exempt: false,
      runtime: null, prev: '', coproc: false, uncertain: 0,
    };
    let dbracket = false;
    let headArgs = false; // après for/select/case : les mots sont des arguments
    let caseHead = false;
    let forStage = 0;
    let forVar: string | null = null;
    const cases: CaseFrame[] = [];
    const reset = (): void => {
      this.endCommand(st);
      st.wrapper = null; st.code = null; st.codeNext = false; st.triggers = null; st.trigger = false;
      st.base = ''; st.exempt = false; st.runtime = null; st.prev = ''; st.coproc = false; st.uncertain = 0; redirectTarget = false;
    };
    const arm = (r: CommandWordResult): void => {
      st.wrapper = r.wrapper ?? null;
      st.code = r.code ?? null;
      st.triggers = r.triggers ?? null;
      st.trigger = false;
      st.base = r.base ?? '';
      st.exempt = r.exempt ?? false;
      st.runtime = r.runtime ?? null;
      st.codeNext = false;
      st.prev = '';
    };

    for (;;) {
      this.skipBlanks();
      if (this.pos >= s.length) {
        if (nested) this.fail(this.pos, 'substitution ou sous-shell non fermé');
        if (dbracket) this.fail(this.pos, 'crochets [[ non fermés');
        this.endCommand(st);
        return;
      }
      const c = s[this.pos]!;
      const inPattern = cases.length > 0 && cases[cases.length - 1]!.pattern;

      if (c === '\n') {
        this.pos++;
        this.consumeHeredocBodies();
        if (!dbracket) {
          expectCommand = !argsOnly && !inPattern && !caseHead;
          if (!caseHead) headArgs = false;
          reset();
        }
        continue;
      }
      if (c === '#') {
        while (this.pos < s.length && s[this.pos] !== '\n') this.pos++;
        continue;
      }

      if (dbracket) {
        const start = this.pos;
        const raw = this.readWord(true);
        if (raw === '') this.fail(start, 'mot illisible dans [[ ]]');
        if (/^\]\]\)/.test(raw)) {
          // `$([[ x ]])` : la `)` n'appartient pas au mot.
          this.pos -= raw.length - 2;
          dbracket = false;
          expectCommand = false;
        } else if (raw === ']]') { dbracket = false; expectCommand = false; }
        continue;
      }

      // Redirections (descripteur numérique éventuel) puis substitutions de processus.
      const redirect = /^(?:\d+)?(?:<<<|<<-|<<|<&-?|>&-?|<>|>\||>>|&>>|&>|<(?!\()|>(?!\())/.exec(s.slice(this.pos, this.pos + 8));
      if (redirect) {
        const op = redirect[0].replace(/^\d+/, '');
        this.pos += redirect[0].length;
        if (op === '<<' || op === '<<-') {
          this.skipBlanks();
          const start = this.pos;
          const rawDelim = this.readWord(false);
          if (rawDelim === '') this.fail(start, 'délimiteur de heredoc absent');
          this.pendingHeredocs.push({
            delimiter: staticWordValue(rawDelim, false).value ?? rawDelim,
            stripTabs: op === '<<-',
            quoted: /['"\\]/.test(rawDelim),
          });
        } else {
          redirectTarget = true;
        }
        continue;
      }
      if ((c === '<' || c === '>') && s[this.pos + 1] === '(') {
        this.pos += 2;
        this.parseList(true);
        continue;
      }

      // Opérateurs de liste.
      if (c === ';' || c === '&' || c === '|') {
        let op: string = c;
        const n = s[this.pos + 1];
        if (c === ';' && n === ';') op = s[this.pos + 2] === '&' ? ';;&' : ';;';
        else if (c === ';' && n === '&') op = ';&';
        else if (c === '&' && n === '&') op = '&&';
        else if (c === '|' && (n === '|' || n === '&')) op = c + n;
        this.pos += op.length;
        if (op === ';;' || op === ';&' || op === ';;&') {
          if (cases.length === 0) this.fail(this.pos, 'terminateur de case hors case');
          cases[cases.length - 1]!.pattern = true;
          expectCommand = false;
        } else if (inPattern && op === '|') {
          expectCommand = false;
        } else {
          expectCommand = !argsOnly;
          headArgs = false;
        }
        reset();
        continue;
      }
      if (c === '(') {
        if (/^\(\s*\)/.test(s.slice(this.pos, this.pos + 40))) {
          // name() { … } ou function name () { … }
          this.pos = s.indexOf(')', this.pos) + 1;
          expectCommand = !argsOnly;
          continue;
        }
        if (inPattern) { this.pos++; continue; }
        if (argsOnly) { this.pos++; this.parseList(true, true); continue; }
        if (!expectCommand && !headArgs) this.fail(this.pos, "parenthèse inattendue en position d'argument");
        if (s[this.pos + 1] === '(') {
          const end = this.arithmeticEnd(this.pos + 2);
          if (end !== -1) {
            this.scanExpansions(this.pos + 2, end - 2);
            this.pos = end;
            expectCommand = false;
            continue;
          }
        }
        this.pos++;
        this.parseList(true);
        expectCommand = false;
        continue;
      }
      if (c === ')') {
        if (inPattern) {
          cases[cases.length - 1]!.pattern = false;
          this.pos++;
          expectCommand = !argsOnly;
          continue;
        }
        if (nested) { this.pos++; this.endCommand(st); return; }
        this.fail(this.pos, 'parenthèse fermante sans ouvrante');
      }

      // Un mot.
      const start = this.pos;
      const raw = this.readWord(false);
      if (raw === '') this.fail(start, 'caractère inattendu');

      if (/^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=$/.test(raw) && s[this.pos] === '(' && !inPattern) {
        // Tableau `nom=( … )`, en tête ou après readonly/declare/local/export.
        this.pos++;
        const saved = this.collect;
        this.collect = [];
        this.parseList(true, true);
        for (const w of this.collect) this.recordAssignment(raw.slice(0, -1), w);
        this.collect = saved;
        redirectTarget = false;
        continue;
      }

      if (redirectTarget) {
        redirectTarget = false;
        // `tee x < /bin/bash`, `cat /bin/bash > x` : un shell lu ou écrit par redirection.
        if (!st.exempt && this.valuesOf(raw).some(v => looksLikeShellName(v.value ?? raw, v.dynamic))) this.flag('interpreter-command-word', start, raw);
        continue;
      }

      if (inPattern) {
        if (raw === 'esac') { cases.pop(); expectCommand = false; }
        continue;
      }

      if (headArgs) {
        if (!caseHead) {
          if (forStage === 1) { forVar = raw; forStage = 2; continue; }
          if (forStage === 2 && raw === 'in') { forStage = 3; continue; }
          if (forStage === 3 && forVar) { this.recordAssignment(forVar, raw); continue; }
        }
        if (caseHead && raw === 'in') {
          caseHead = false;
          headArgs = false;
          cases.push({ pattern: true });
        }
        continue;
      }

      if (argsOnly && this.collect) this.collect.push(raw);
      if (!expectCommand) {
        // Arguments d'une commande déjà identifiée.
        if (st.codeNext) {
          st.codeNext = false;
          this.analyzeCodeWord(raw, start);
          continue;
        }
        if (st.code) {
          const kind = st.code;
          st.code = null;
          if (!(kind === 'trap' && raw.startsWith('-'))) this.analyzeCodeWord(raw, start);
          else st.code = kind;
          continue;
        }
        if (st.base === 'alias') {
          const eq = raw.indexOf('=');
          if (eq > 0) this.analyzeCodeWord(raw.slice(eq + 1), start);
          continue;
        }
        const opts = CODE_OPTS[st.base];
        if (opts) {
          // `-c`, mais aussi une grappe d'options dont la dernière est `-c` (`script -qec CMD`).
          if (opts.includes(raw) || opts.some(o => /^-[A-Za-z]$/.test(o) && new RegExp(`^-[A-Za-z]+${o[1]}$`).test(raw))) { st.codeNext = true; continue; }
          const inline = /^--(?:command|split-string|entrypoint)=(.*)$/s.exec(raw);
          if (inline) { this.analyzeCodeWord(inline[1]!, start); continue; }
        }
        if (ASSIGNING_BUILTINS.has(st.base)) {
          const asg = /^([A-Za-z_]\w*(?:\[[^\]]*\])?\+?)=([\s\S]*)$/.exec(raw);
          if (asg) {
            this.recordAssignment(asg[1]!, asg[2]!);
            if (raw.endsWith('=') && s[this.pos] === '(') {
              this.pos++;
              const saved = this.collect;
              this.collect = [];
              this.parseList(true, true);
              for (const w of this.collect) this.recordAssignment(asg[1]!, w);
              this.collect = saved;
            }
            continue;
          }
        }
        this.checkArgument(raw, start, st);
        if (st.runtime && !st.runtime.decided) {
          const rt = st.runtime;
          const value = staticWordValue(raw, false).value ?? raw;
          if (rt.skip > 0) { rt.skip--; continue; }
          if (rt.spec.safe.test(value)) rt.decided = true;
          else if (rt.spec.code.test(value) || value === '-') { this.flag('interpreter-command-word', start, `${rt.word} ${raw}`); rt.decided = true; }
          else if (value.startsWith('-')) { if (rt.spec.optArg.includes(value)) rt.skip = 1; }
          else {
            // Un fichier du langage lui-même est scanné comme tel ; toute autre cible (donnée, nom dynamique) ne l'est pas.
            if (!(rt.spec.own && rt.spec.own.test(value))) this.flag('interpreter-command-word', start, `${rt.word} ${raw}`);
            rt.decided = true;
          }
          continue;
        }
        if (st.runtime) continue;
        if (st.triggers && st.triggers.has(raw)) { st.trigger = true; st.wrapper = null; continue; }
        if (st.trigger) {
          st.trigger = false;
          const triggers = st.triggers;
          arm(this.commandWord(raw, start));
          st.triggers = st.triggers ?? triggers;
          continue;
        }
        if (!st.wrapper && st.uncertain > 0 && !raw.startsWith('-')) { st.uncertain--; this.checkCommandWord(raw, start); }
        const w = st.wrapper;
        if (w) {
          if (w.skip > 0) { w.skip--; continue; }
          if (raw.startsWith('-')) {
            if (raw === '--') continue;
            if (w.spec.optArg.includes(raw)) { w.skip = 1; continue; }
            if (w.spec.optArg2?.includes(raw)) { w.skip = 2; continue; }
            // `-n1`, `-P4` : valeur attachée d'une option courte connue.
            if (!raw.startsWith('--') && raw.length > 2 && (w.spec.optArg.includes(raw.slice(0, 2)) || w.spec.noArg?.includes(raw.slice(0, 2)))) continue;
            // Option exacte, ni connue ni sans argument : elle peut consommer le mot suivant.
            if (/^--?[A-Za-z][\w-]*$/.test(raw) && !w.spec.noArg?.includes(raw) && w.name !== 'command') st.uncertain = 2;
            if (w.name === 'command' && (raw === '-v' || raw === '-V')) { st.wrapper = null; st.exempt = true; continue; }
            continue;
          }
          if (w.spec.assign && /^[A-Za-z_]\w*=/.test(raw)) continue;
          if (w.positional > 0) { w.positional--; continue; }
          if (st.uncertain > 0) { st.uncertain--; this.checkCommandWord(raw, start); }
          arm(this.commandWord(raw, start));
        }
        continue;
      }

      // Position de commande : affectations en tête.
      {
        const asg = /^([A-Za-z_]\w*(?:\[[^\]]*\])?\+?)=([\s\S]*)$/.exec(raw);
        if (asg) { this.recordAssignment(asg[1]!, asg[2]!); continue; }
      }
      if (st.coproc) {
        st.coproc = false;
        // `coproc NOM { … }` / `coproc NOM ( … )` : NOM n'est pas la commande, le corps l'est.
        if (/^[A-Za-z_]\w*$/.test(raw) && /^\s*[{(]/.test(s.slice(this.pos, this.pos + 80))) continue;
      }
      if (raw === 'coproc') { st.coproc = true; continue; }
      if (raw === 'esac' && cases.length > 0) { cases.pop(); expectCommand = false; continue; }
      if (COMMAND_RESERVED.has(raw)) continue;
      if (raw === 'for' || raw === 'select') { headArgs = true; expectCommand = false; forStage = 1; forVar = null; continue; }
      if (raw === 'case') { headArgs = true; caseHead = true; expectCommand = false; continue; }
      if (raw === 'function') {
        // `function nom` : le nom n'est pas une commande.
        this.skipBlanks();
        const nameStart = this.pos;
        this.readWord(false);
        if (this.pos === nameStart) this.fail(nameStart, 'nom de fonction absent');
        continue;
      }
      if (raw === '[[') { dbracket = true; expectCommand = false; continue; }

      expectCommand = false;
      arm(this.commandWord(raw, start));
    }
  }

  /** Mot de commande : vérification, puis arme les enveloppes (sudo, env…), eval/trap, find/gdb et les runtimes. */
  private commandWord(raw: string, at: number): CommandWordResult {
    this.checkCommandWord(raw, at);
    if (!LITERAL_WORD.test(raw)) return {};
    const slash = raw.lastIndexOf('/');
    const base = (slash >= 0 ? raw.slice(slash + 1) : raw).replace(/\.exe$/i, '');
    const exempt = EXEMPT_ARG_COMMANDS.has(base);
    if (base === 'eval') return { code: 'eval', base };
    if (base === 'trap') return { code: 'trap', base };
    const triggers = TRIGGERS[base];
    if (triggers) return { triggers, base, exempt };
    const spec = WRAPPERS[base];
    if (spec) return { wrapper: { name: base, spec, positional: spec.positional, skip: 0 }, base };
    for (const [pattern, runtime] of this.runtimes ? RUNTIMES : []) {
      if (pattern.test(base)) return { base, runtime: { spec: runtime, decided: false, skip: 0, at, word: raw } };
    }
    return { base, exempt };
  }

  /** Mémorise `NOM=valeur` (valeur statique, expansions connues résolues). */
  private recordAssignment(name: string, rawValue: string): void {
    const clean = name.replace(/\[[^\]]*\]$/, '').replace(/\+$/, '');
    const values = this.valuesOf(rawValue);
    if (values.every(v => v.dynamic)) return;
    const set = this.vars.get(clean) ?? new Set<string>();
    for (const v of values) if (v.value !== null) set.add(v.value);
    this.vars.set(clean, set);
  }

  /** Valeurs statiques possibles d'un mot : quotes décodées, variables connues substituées (produit borné). */
  private valuesOf(raw: string): Array<{ value: string | null; dynamic: boolean }> {
    const referenced = new Set<string>();
    staticWordValue(raw, false, (n) => { if (this.vars.has(n)) referenced.add(n); return undefined; });
    if (referenced.size === 0) return [staticWordValue(raw, false)];
    let combos: Array<Map<string, string>> = [new Map()];
    for (const name of referenced) {
      const next: Array<Map<string, string>> = [];
      for (const combo of combos) for (const v of this.vars.get(name)!) { if (next.length < 32) next.push(new Map(combo).set(name, v)); }
      combos = next;
    }
    return combos.map(c => staticWordValue(raw, false, (n) => c.get(n)));
  }

  /** Fin d'une commande simple : un interpréteur de langage qui n'a reçu ni option sûre ni argument lit son code sur stdin. */
  private endCommand(st: CmdState): void {
    if (st.runtime && !st.runtime.decided) {
      this.flag('interpreter-command-word', st.runtime.at, `${st.runtime.word} (code lu sur stdin)`);
      st.runtime.decided = true;
    }
  }

  /** Argument d'une commande : nom de shell écrit sous n'importe quelle forme, règles par commande. */
  private checkArgument(raw: string, at: number, st: CmdState): void {
    const candidates = this.valuesOf(raw);
    const sv = candidates[0]!;
    const value = sv.value ?? raw;
    const prev = st.prev;
    st.prev = value;
    if (st.exempt) return;
    // Toutes les valeurs possibles (variables littérales connues), et la partie après `=` (`dd if=/bin/bash`).
    for (const cand of candidates) {
      const text = cand.value ?? raw;
      const eq = text.indexOf('=');
      const parts = eq > 0 ? [text, text.slice(eq + 1)] : [text];
      if (parts.some(part => looksLikeShellName(part, cand.dynamic) || braceAlternatives(part).some(alt => looksLikeShellName(alt, cand.dynamic)))) {
        this.flag('interpreter-command-word', at, raw);
        return;
      }
    }
    const marked = COPY_PRIMITIVES.has(st.base) ? staticWordValue(raw, 'mark').value : null;
    const markedBase = marked === null ? '' : marked.slice(marked.lastIndexOf('/') + 1);
    // Nom construit par substitution dont les lettres écrites sont une sous-suite d'un nom de shell (`$(printf s)h`).
    const builtByCommand = markedBase.includes('\uE000') && [...SHELL_NAMES].some(n => isSubsequence(markedBase.replace(/\uE000/g, '').toLowerCase(), n));
    if (builtByCommand) {
      this.flag('interpreter-command-word', at, raw);
      return;
    }
    const rule = ARG_RULES[st.base];
    if (rule && rule(raw, value, prev)) this.flag('interpreter-command-word', at, `${st.base} ${raw}`);
  }

  /** Argument qui est du CODE (eval, trap, alias, -c d'un lanceur) : analysé comme une liste de commandes. */
  private analyzeCodeWord(raw: string, at: number): void {
    const { value } = staticWordValue(raw, true);
    if (value === null) {
      this.flag('non-literal-command-word', at, raw);
      return;
    }
    const inner = new ShellCommandParser(value, this.lineOf(at), this.runtimes, this.vars);
    inner.run();
    this.findings.push(...inner.findings);
  }

  /** Lit un mot brut (quotes et substitutions comprises). `loose` : seulement les blancs séparent. */
  private readWord(loose: boolean): string {
    const s = this.s;
    const start = this.pos;
    let raw = '';
    while (this.pos < s.length) {
      const c = s[this.pos]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
      if (c === ';' && loose) break;
      if (!loose && (c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || c === '<' || c === '>')) break;
      if (c === '\\') {
        if (s[this.pos + 1] === '\n') { this.pos += 2; continue; }
        if (s[this.pos + 1] === '\r' && s[this.pos + 2] === '\n') { this.pos += 3; continue; }
        raw += s.slice(this.pos, this.pos + 2);
        this.pos += 2;
        continue;
      }
      if (c === "'") {
        const end = s.indexOf("'", this.pos + 1);
        if (end === -1) this.fail(this.pos, 'apostrophe non fermée');
        raw += s.slice(this.pos, end + 1);
        this.pos = end + 1;
        continue;
      }
      if (c === '"') { raw += this.readDouble(); continue; }
      if (c === '`') { raw += this.readBackticks(); continue; }
      if (c === '$') {
        const n = s[this.pos + 1];
        if (n === "'") { raw += this.readAnsiC(); continue; }
        if (n === '"') { raw += '$'; this.pos++; raw += this.readDouble(); continue; }
        if (n === '(') { raw += this.readDollarParen(); continue; }
        if (n === '{') { raw += this.readBraceParam(); continue; }
        raw += '$';
        this.pos++;
        continue;
      }
      raw += c;
      this.pos++;
    }
    if (this.pos === start && raw === '') return '';
    return raw;
  }

  private readAnsiC(): string {
    const s = this.s;
    const start = this.pos;
    this.pos += 2;
    while (this.pos < s.length) {
      const c = s[this.pos]!;
      if (c === '\\') { this.pos += 2; continue; }
      if (c === "'") { this.pos++; return s.slice(start, this.pos); }
      this.pos++;
    }
    return this.fail(start, 'chaîne $\'…\' non fermée');
  }

  private readDouble(): string {
    const s = this.s;
    const start = this.pos;
    this.pos++;
    this.scanExpansionsUntil('"');
    if (s[this.pos] !== '"') this.fail(start, 'guillemet non fermé');
    this.pos++;
    return s.slice(start, this.pos);
  }

  /** Parcourt jusqu'à `until` (non consommé), en exécutant les substitutions rencontrées. */
  private scanExpansionsUntil(until: string | null, end = this.s.length): void {
    const s = this.s;
    while (this.pos < end) {
      const c = s[this.pos]!;
      if (until !== null && c === until) return;
      if (c === '\\') { this.pos += 2; continue; }
      if (c === '`') { this.readBackticks(); continue; }
      if (c === '$') {
        const n = s[this.pos + 1];
        if (n === '(') { this.readDollarParen(); continue; }
        if (n === '{') { this.readBraceParam(); continue; }
        this.pos++;
        continue;
      }
      this.pos++;
    }
  }

  /** Analyse les substitutions d'un intervalle sans en faire des mots (arithmétique, corps de heredoc). */
  private scanExpansions(from: number, to: number): void {
    const saved = this.pos;
    this.pos = from;
    this.scanExpansionsUntil(null, to);
    this.pos = saved;
  }

  private readBackticks(): string {
    const s = this.s;
    const start = this.pos;
    this.pos++;
    let inner = '';
    while (this.pos < s.length) {
      const c = s[this.pos]!;
      if (c === '\\' && (s[this.pos + 1] === '`' || s[this.pos + 1] === '\\' || s[this.pos + 1] === '$')) {
        inner += s[this.pos + 1]!;
        this.pos += 2;
        continue;
      }
      if (c === '`') {
        this.pos++;
        const sub = new ShellCommandParser(inner, this.lineOf(start), this.runtimes, this.vars);
        sub.run();
        this.findings.push(...sub.findings);
        return s.slice(start, this.pos);
      }
      inner += c;
      this.pos++;
    }
    return this.fail(start, 'accent grave non fermé');
  }

  /** Fin (exclusive) d'une arithmétique `((…))` dont le contenu commence à `from`, ou -1 (alors : sous-shells imbriqués). */
  private arithmeticEnd(from: number): number {
    const s = this.s;
    let depth = 2;
    for (let i = from; i < s.length; i++) {
      // Borne le travail total : `$((` répété sans fermeture ne doit pas être quadratique.
      if (++this.work > 4 * s.length + 100_000) this.fail(from, 'analyse trop coûteuse');
      const c = s[i]!;
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 1) return s[i + 1] === ')' ? i + 2 : -1;
      }
    }
    return -1;
  }

  private readDollarParen(): string {
    const s = this.s;
    const start = this.pos;
    if (s[this.pos + 2] === '(') {
      const end = this.arithmeticEnd(this.pos + 3);
      if (end !== -1) {
        this.scanExpansions(this.pos + 3, end - 2);
        this.pos = end;
        return s.slice(start, end);
      }
    }
    this.pos += 2;
    this.parseList(true);
    return s.slice(start, this.pos);
  }

  private readBraceParam(): string {
    const s = this.s;
    const start = this.pos;
    this.pos += 2;
    while (this.pos < s.length) {
      const c = s[this.pos]!;
      if (c === '}') { this.pos++; return s.slice(start, this.pos); }
      if (c === '\\') { this.pos += 2; continue; }
      if (c === "'") {
        const end = s.indexOf("'", this.pos + 1);
        if (end === -1) this.fail(this.pos, 'apostrophe non fermée');
        this.pos = end + 1;
        continue;
      }
      if (c === '"') { this.readDouble(); continue; }
      if (c === '`') { this.readBackticks(); continue; }
      if (c === '$') {
        const n = s[this.pos + 1];
        if (n === '(') { this.readDollarParen(); continue; }
        if (n === '{') { this.readBraceParam(); continue; }
      }
      this.pos++;
    }
    return this.fail(start, 'expansion ${…} non fermée');
  }

  /** Après un saut de ligne : saute les corps de heredoc en attente (en lisant les substitutions de ceux qui s'expansent). */
  private consumeHeredocBodies(): void {
    const s = this.s;
    const pending = this.pendingHeredocs;
    this.pendingHeredocs = [];
    for (const doc of pending) {
      const bodyStart = this.pos;
      let lineStart = this.pos;
      let bodyEnd = s.length;
      let next = s.length;
      while (lineStart < s.length) {
        let eol = s.indexOf('\n', lineStart);
        if (eol === -1) eol = s.length;
        let text = s.slice(lineStart, eol);
        if (text.endsWith('\r')) text = text.slice(0, -1);
        if ((doc.stripTabs ? text.replace(/^\t+/, '') : text) === doc.delimiter) {
          bodyEnd = lineStart;
          next = Math.min(eol + 1, s.length);
          break;
        }
        lineStart = eol + 1;
      }
      if (!doc.quoted) this.scanExpansions(bodyStart, bodyEnd);
      this.pos = next;
    }
  }
}

/** Développement d'accolades `a{b,c}d` (un niveau, imbrication par récursion, borné). */
function braceAlternatives(value: string, budget = { n: 64 }): string[] {
  const m = /\{([^{}]*,[^{}]*)\}/.exec(value);
  if (!m || budget.n <= 0) return [];
  const out: string[] = [];
  for (const alt of m[1]!.split(',')) {
    const next = value.slice(0, m.index) + alt + value.slice(m.index + m[0].length);
    budget.n--;
    out.push(next, ...braceAlternatives(next, budget));
  }
  return out;
}

function isSubsequence(small: string, big: string): boolean {
  let i = 0;
  for (const ch of big) if (i < small.length && small[i] === ch) i++;
  return i === small.length;
}

/**
 * Le mot, une fois ses quotes décodées, désigne-t-il un shell ? Trois cas :
 * un chemin littéral dont le nom de base est un shell ; un motif de glob dont
 * le nom de base peut le désigner (`/bin/ba?h`, `/???/sh`) ; un nom dont des
 * morceaux sont des expansions (`b$(printf a)sh`) et dont les lettres restantes
 * sont une sous-suite d'un nom de shell.
 */
function looksLikeShellName(value: string, dynamic: boolean): boolean {
  const slash = value.lastIndexOf('/');
  const base = (slash >= 0 ? value.slice(slash + 1) : value).replace(/\.exe$/i, '').toLowerCase();
  if (!/[\s=]/.test(value) && SHELL_NAMES.has(base)) return true;
  if (/[*?[]/.test(base) && base.replace(/[*?[\]]/g, '').length >= 2) {
    try {
      const re = new RegExp('^' + base.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      if ([...SHELL_NAMES].some(n => re.test(n))) return true;
    } catch {
      return true;
    }
  }
  return dynamic && base.length >= 2 && [...SHELL_NAMES].some(n => isSubsequence(base, n));
}

/** Décode le contenu d'une chaîne ANSI-C `$'…'` (sans les quotes). */
function decodeAnsiC(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== '\\' || i + 1 >= body.length) { out += c; continue; }
    const n = body[++i]!;
    const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
    if (n in simple) { out += simple[n]!; continue; }
    if (n === 'x') {
      const m = /^[0-9a-fA-F]{1,2}/.exec(body.slice(i + 1));
      if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length; } else out += '\\x';
      continue;
    }
    if (n === 'u' || n === 'U') {
      const m = new RegExp(`^[0-9a-fA-F]{1,${n === 'u' ? 4 : 8}}`).exec(body.slice(i + 1));
      if (m) { out += String.fromCodePoint(Math.min(parseInt(m[0], 16), 0x10ffff)); i += m[0].length; } else out += '\\' + n;
      continue;
    }
    if (/[0-7]/.test(n)) {
      const m = /^[0-7]{1,3}/.exec(body.slice(i));
      out += String.fromCharCode(parseInt(m![0], 8) & 0xff);
      i += m![0].length - 1;
      continue;
    }
    if (n === 'c' && i + 1 < body.length) { out += String.fromCharCode(body[++i]!.charCodeAt(0) & 0x1f); continue; }
    out += '\\' + n;
  }
  return out;
}

/** Fin (exclusive) de l'expansion `$(…)`, `${…}` ou `` `…` `` qui commence en `i` ; approximation sans quotes imbriquées. */
function expansionEnd(raw: string, i: number): number {
  if (raw[i] === '`') {
    for (let j = i + 1; j < raw.length; j++) {
      if (raw[j] === '\\') j++;
      else if (raw[j] === '`') return j + 1;
    }
    return raw.length;
  }
  const open = raw[i + 1] === '(' ? '(' : '{';
  const close = open === '(' ? ')' : '}';
  let depth = 0;
  for (let j = i + 1; j < raw.length; j++) {
    if (raw[j] === '\\') { j++; continue; }
    if (raw[j] === open) depth++;
    else if (raw[j] === close && --depth === 0) return j + 1;
  }
  return raw.length;
}

/**
 * Valeur statique d'un mot : quotes, antislashs et `$'…'` décodés.
 * `keep` : les expansions (`$x`, `${…}`, `$(…)`) sont conservées telles quelles
 * (pour analyser du code) ; sinon elles sont supprimées (pour reconnaître un
 * nom écrit avec des morceaux vides : `ba${e}sh` → `bash`).
 * `value` vaut `null` si une quote n'est pas fermée.
 */
function staticWordValue(raw: string, mode: boolean | 'mark', lookup?: (name: string) => string | undefined): { value: string | null; dynamic: boolean } {
  const keep = mode === true;
  let out = '';
  let dynamic = false;
  let i = 0;
  const expansion = (): void => {
    // `$nom` / `${nom}` d'une variable dont la valeur littérale est connue.
    const bare = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/.exec(raw.slice(i));
    if (bare && lookup && !keep) {
      const known = lookup(bare[1] ?? bare[2]!);
      if (known !== undefined) { out += known; i += bare[0].length; return; }
    }
    dynamic = true;
    if (mode === 'mark' && (raw[i] === '`' || (raw[i] === '$' && raw[i + 1] === '('))) out += '\uE000';
    if (raw[i] === '$' && raw[i + 1] !== '(' && raw[i + 1] !== '{') {
      const m = /^\$(?:[A-Za-z_]\w*|[0-9@*#?$!-])/.exec(raw.slice(i));
      const text = m ? m[0] : '$';
      if (keep) out += text;
      i += text.length;
      return;
    }
    const end = expansionEnd(raw, i);
    if (keep) out += raw.slice(i, end);
    else {
      // `${x:-b}` : on retient la valeur par défaut (cas le plus défavorable pour qui lit un nom).
      const def = /^\$\{[A-Za-z_]\w*:?[-+=]([^}$`"'\\]*)\}$/.exec(raw.slice(i, end));
      if (def) out += def[1]!;
    }
    i = end;
  };
  while (i < raw.length) {
    const c = raw[i]!;
    if (c === '\\') {
      if (i + 1 < raw.length && raw[i + 1] !== '\n') out += raw[i + 1]!;
      i += 2;
    } else if (c === "'") {
      const end = raw.indexOf("'", i + 1);
      if (end === -1) return { value: null, dynamic };
      out += raw.slice(i + 1, end);
      i = end + 1;
    } else if (c === '$' && raw[i + 1] === "'") {
      let j = i + 2;
      while (j < raw.length && raw[j] !== "'") j += raw[j] === '\\' ? 2 : 1;
      if (j >= raw.length) return { value: null, dynamic };
      out += decodeAnsiC(raw.slice(i + 2, j));
      i = j + 1;
    } else if (c === '"' || (c === '$' && raw[i + 1] === '"')) {
      i += c === '"' ? 1 : 2;
      for (;;) {
        if (i >= raw.length) return { value: null, dynamic };
        const d = raw[i]!;
        if (d === '"') { i++; break; }
        if (d === '\\' && /["\\$`]/.test(raw[i + 1] ?? '')) { out += raw[i + 1]!; i += 2; }
        else if (d === '`' || (d === '$' && (raw[i + 1] === '(' || raw[i + 1] === '{' || /[A-Za-z_0-9@*#?$!-]/.test(raw[i + 1] ?? '')))) expansion();
        else { out += d; i++; }
      }
    } else if (c === '`' || (c === '$' && (raw[i + 1] === '(' || raw[i + 1] === '{' || /[A-Za-z_0-9@*#?$!-]/.test(raw[i + 1] ?? '')))) {
      expansion();
    } else {
      out += c;
      i++;
    }
  }
  return { value: out, dynamic };
}

/**
 * Analyse un texte shell (script entier ou bloc de code) et renvoie les
 * findings structurels. Aucune exception : un texte illisible produit un
 * finding `unparseable-shell` (échec fermé).
 */
export function analyzeShellCommandWords(source: string, baseLine = 1, options: { runtimes?: boolean } = {}): ShellWordFinding[] {
  const parser = new ShellCommandParser(source.replace(/\r\n/g, '\n'), baseLine, options.runtimes !== false);
  parser.run();
  return parser.findings;
}

const MAKE_TOOLS: Record<string, string> = {
  CC: 'cc', CXX: 'c++', CPP: 'cpp', LD: 'ld', AR: 'ar', RM: 'rm', MAKE: 'make', INSTALL: 'install', CP: 'cp', MKDIR: 'mkdir',
  MV: 'mv', LN: 'ln', SED: 'sed', PYTHON: 'python3', PYTHON3: 'python3', NODE: 'node', NPM: 'npm', GO: 'go', CARGO: 'cargo',
};

/**
 * Les recettes d'un Makefile sont des commandes shell : on les extrait (mêmes
 * numéros de ligne, le reste est vidé) en traduisant la syntaxe make
 * (`$(shell …)`, `$(CC)`, `$$HOME`) vers du shell, pour les juger comme un script.
 */
export function makefileRecipeText(content: string): string {
  const out: string[] = [];
  let continued = false;
  for (const line of content.split('\n')) {
    const recipe = line.startsWith('\t');
    if (!recipe && !continued) { out.push(''); continued = false; continue; }
    let text = (recipe && !continued ? line.slice(1) : line).replace(/^\s*[@+-]+\s*/, '');
    continued = /\\\r?$/.test(line);
    text = text
      .replace(/\$\$/g, '\u0001')
      .replace(/\$[({]([A-Za-z_][\w.-]*)[)}]/g, (_m, name: string) => MAKE_TOOLS[name] ?? `\u0003${name.replace(/\W/g, '_')}`)
      .replace(/\$\(shell\s+([^()]*)\)/g, '\u0002($1)')
      .replace(/\$\([^)]*\)/g, '\u0003MAKEFN')
      .replace(/\$[@<^+?*%|]/g, '\u0003AUTO')
      .replace(/\u0001/g, '$')
      .replace(/\u0002/g, '$')
      .replace(/\u0003/g, '$');
    out.push(text);
  }
  return out.join('\n');
}

