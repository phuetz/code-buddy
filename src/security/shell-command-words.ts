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

const SHELL_INTERPRETERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'ash', 'csh', 'tcsh', 'mksh', 'pdksh', 'rbash', 'busybox',
  'pwsh', 'powershell', 'osascript',
  // `source f` / `. f` exécutent f comme du shell, exactement comme `bash f` : même traitement,
  // quelle que soit la cible (suffixe .sh compris, nom dynamique compris).
  'source', '.',
]);

/** Mots-clés après lesquels un mot de commande commence encore. */
const COMMAND_RESERVED = new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'do', 'done', 'esac', 'coproc']);

interface WrapperSpec {
  /** Options (forme exacte) qui consomment le mot suivant. */
  optArg: readonly string[];
  /** Mots positionnels avant la commande (durée de timeout, masque de taskset…). */
  positional: number;
  /** Accepte des affectations `VAR=valeur` avant la commande. */
  assign?: boolean;
}

const WRAPPERS: Record<string, WrapperSpec> = {
  sudo: { optArg: ['-u', '-g', '-h', '-p', '-C', '-T', '-r', '-t', '-U', '-D', '--user', '--group', '--host', '--prompt'], positional: 0, assign: true },
  doas: { optArg: ['-u', '-C'], positional: 0 },
  env: { optArg: ['-u', '-C', '--unset', '--chdir'], positional: 0, assign: true },
  nice: { optArg: ['-n', '--adjustment'], positional: 0 },
  ionice: { optArg: ['-c', '-n', '-p', '-P', '-t'], positional: 0 },
  nohup: { optArg: [], positional: 0 },
  setsid: { optArg: [], positional: 0 },
  stdbuf: { optArg: ['-i', '-o', '-e'], positional: 0 },
  time: { optArg: ['-f', '-o', '--format', '--output'], positional: 0 },
  timeout: { optArg: ['-s', '-k', '--signal', '--kill-after'], positional: 1 },
  exec: { optArg: ['-a'], positional: 0 },
  builtin: { optArg: [], positional: 0 },
  command: { optArg: [], positional: 0 },
  xargs: { optArg: ['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a', '-J', '-R', '-S', '--max-args', '--max-procs', '--delimiter', '--arg-file', '--replace'], positional: 0 },
  watch: { optArg: ['-n', '--interval'], positional: 0 },
  taskset: { optArg: [], positional: 1 },
  chroot: { optArg: ['--userspec', '--groups'], positional: 1 },
  flock: { optArg: ['-w', '-E', '--timeout'], positional: 1 },
  unbuffer: { optArg: [], positional: 0 },
  strace: { optArg: ['-e', '-o', '-p', '-s', '-u', '-E'], positional: 0 },
  ltrace: { optArg: ['-e', '-o', '-p', '-s', '-u'], positional: 0 },
  valgrind: { optArg: [], positional: 0 },
  nsenter: { optArg: ['-t', '-S', '-G', '--target'], positional: 0 },
  unshare: { optArg: [], positional: 0 },
  setpriv: { optArg: ['--reuid', '--regid', '--groups', '--inh-caps', '--bounding-set'], positional: 0 },
  runuser: { optArg: ['-u', '-g', '-G'], positional: 0 },
  'systemd-run': { optArg: ['-p', '-u', '--property', '--unit', '--slice'], positional: 0 },
  numactl: { optArg: ['--cpunodebind', '--membind', '--physcpubind', '-C', '-m', '-N'], positional: 0 },
  fakeroot: { optArg: [], positional: 0 },
  faketime: { optArg: [], positional: 1 },
  proxychains: { optArg: ['-f'], positional: 0 },
  proxychains4: { optArg: ['-f'], positional: 0 },
  torsocks: { optArg: [], positional: 0 },
  rlwrap: { optArg: ['-a', '-C', '-f', '-H', '-s'], positional: 0 },
  firejail: { optArg: [], positional: 0 },
  bwrap: { optArg: [], positional: 0 },
  eatmydata: { optArg: [], positional: 0 },
  caffeinate: { optArg: ['-t', '-w'], positional: 0 },
  'dbus-run-session': { optArg: [], positional: 0 },
  cpulimit: { optArg: ['-l', '-p', '-e'], positional: 0 },
};

/** `find … -exec CMD` : le mot qui suit est une commande. */
/** Imbrication maximale de `$(…)`, sous-shells et eval ; au-delà, texte refusé. */
const MAX_DEPTH = 100;

const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);

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
  skip: boolean;
}

interface CommandWordResult {
  wrapper?: WrapperState;
  code?: 'eval' | 'trap';
  isFind?: boolean;
}

class ShellCommandParser {
  private pos = 0;
  private depth = 0;
  private work = 0;
  private readonly lineStarts: number[] = [0];
  private pendingHeredocs: Heredoc[] = [];
  readonly findings: ShellWordFinding[] = [];

  constructor(private readonly s: string, private readonly baseLine: number) {
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
    const st: { wrapper: WrapperState | null; code: 'eval' | 'trap' | null; isFind: boolean; findExec: boolean } =
      { wrapper: null, code: null, isFind: false, findExec: false };
    let dbracket = false;
    let headArgs = false; // après for/select/case : les mots sont des arguments
    let caseHead = false;
    const cases: CaseFrame[] = [];
    const reset = (): void => {
      st.wrapper = null; st.code = null; st.isFind = false; st.findExec = false; redirectTarget = false;
    };
    const arm = (r: CommandWordResult): void => {
      st.wrapper = r.wrapper ?? null;
      st.code = r.code ?? null;
      st.isFind = r.isFind ?? false;
    };

    for (;;) {
      this.skipBlanks();
      if (this.pos >= s.length) {
        if (nested) this.fail(this.pos, 'substitution ou sous-shell non fermé');
        if (dbracket) this.fail(this.pos, 'crochets [[ non fermés');
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
            delimiter: unquoteWord(rawDelim) ?? rawDelim,
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
        if (nested) { this.pos++; return; }
        this.fail(this.pos, 'parenthèse fermante sans ouvrante');
      }

      // Un mot.
      const start = this.pos;
      const raw = this.readWord(false);
      if (raw === '') this.fail(start, 'caractère inattendu');

      if (/^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=$/.test(raw) && s[this.pos] === '(' && !inPattern) {
        // Tableau `nom=( … )`, en tête ou après readonly/declare/local/export.
        this.pos++;
        this.parseList(true, true);
        redirectTarget = false;
        continue;
      }

      if (redirectTarget) { redirectTarget = false; continue; }

      if (inPattern) {
        if (raw === 'esac') { cases.pop(); expectCommand = false; }
        continue;
      }

      if (headArgs) {
        if (caseHead && raw === 'in') {
          caseHead = false;
          headArgs = false;
          cases.push({ pattern: true });
        }
        continue;
      }

      if (!expectCommand) {
        // Arguments d'une commande déjà identifiée.
        if (st.code) {
          this.analyzeCodeWord(raw, start, st.code);
          st.code = null;
          continue;
        }
        if (st.isFind && FIND_EXEC.has(raw)) { st.findExec = true; st.wrapper = null; continue; }
        if (st.findExec) {
          st.findExec = false;
          arm(this.commandWord(raw, start));
          st.isFind = true;
          continue;
        }
        const w = st.wrapper;
        if (w) {
          if (raw.startsWith('-')) {
            if (raw === '--') { w.skip = false; continue; }
            if (w.spec.optArg.includes(raw)) { w.skip = true; continue; }
            if (w.name === 'command' && (raw === '-v' || raw === '-V')) { st.wrapper = null; continue; }
            continue;
          }
          if (w.skip) { w.skip = false; continue; }
          if (w.spec.assign && /^[A-Za-z_]\w*=/.test(raw)) continue;
          if (w.positional > 0) { w.positional--; continue; }
          arm(this.commandWord(raw, start));
        }
        continue;
      }

      // Position de commande : affectations en tête.
      if (/^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/.test(raw)) continue;
      if (raw === 'esac' && cases.length > 0) { cases.pop(); expectCommand = false; continue; }
      if (COMMAND_RESERVED.has(raw)) continue;
      if (raw === 'for' || raw === 'select') { headArgs = true; expectCommand = false; continue; }
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

  /** Mot de commande : vérification, puis arme les enveloppes (sudo, env…), eval/trap et find. */
  private commandWord(raw: string, at: number): CommandWordResult {
    this.checkCommandWord(raw, at);
    if (!LITERAL_WORD.test(raw)) return {};
    const slash = raw.lastIndexOf('/');
    const base = slash >= 0 ? raw.slice(slash + 1) : raw;
    if (base === 'eval') return { code: 'eval' };
    if (base === 'trap') return { code: 'trap' };
    if (base === 'find') return { isFind: true };
    const spec = WRAPPERS[base];
    return spec ? { wrapper: { name: base, spec, positional: spec.positional, skip: false } } : {};
  }

  /** Argument d'`eval`/`trap` : du code. On l'analyse comme une liste de commandes. */
  private analyzeCodeWord(raw: string, at: number, kind: 'eval' | 'trap'): void {
    if (kind === 'trap' && /^-/.test(raw)) return;
    const content = unquoteWord(raw, true);
    if (content === null) {
      this.flag('non-literal-command-word', at, raw);
      return;
    }
    const inner = new ShellCommandParser(content, this.lineOf(at));
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
        const sub = new ShellCommandParser(inner, this.lineOf(start));
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

/**
 * Retire les quotes d'un mot pour en lire le contenu. `forCode` : renvoie
 * `null` si le mot n'est pas un texte entièrement connu (substitution, variable
 * nue sans quotes) ; sinon le texte brut (les `$var` internes sont conservés,
 * ils seront jugés par l'analyse du code).
 */
function unquoteWord(raw: string, forCode = false): string | null {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i]!;
    if (c === '\\' && i + 1 < raw.length) { out += raw[i + 1]!; i += 2; continue; }
    if (c === "'") {
      const end = raw.indexOf("'", i + 1);
      if (end === -1) return forCode ? null : raw;
      out += raw.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let chunk = '';
      while (j < raw.length && raw[j] !== '"') {
        if (raw[j] === '\\' && /["\\$`]/.test(raw[j + 1] ?? '')) { chunk += raw[j + 1]!; j += 2; continue; }
        chunk += raw[j]!;
        j++;
      }
      out += chunk;
      i = j + 1;
      continue;
    }
    if (c === '$' && raw[i + 1] === "'") {
      // ANSI-C : le contenu n'est pas décodé ici ; pour du code, on refuse (fermé).
      if (forCode) return null;
      const end = raw.indexOf("'", i + 2);
      out += end === -1 ? raw.slice(i) : raw.slice(i + 2, end);
      i = end === -1 ? raw.length : end + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Analyse un texte shell (script entier ou bloc de code) et renvoie les
 * findings structurels. Aucune exception : un texte illisible produit un
 * finding `unparseable-shell` (échec fermé).
 */
export function analyzeShellCommandWords(source: string, baseLine = 1): ShellWordFinding[] {
  const parser = new ShellCommandParser(source.replace(/\r\n/g, '\n'), baseLine);
  parser.run();
  return parser.findings;
}
