#!/usr/bin/env node
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

const EXIT_USAGE = 2;
const EXIT_VERIFY = 3;
const EXIT_INTERNAL = 4;
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const ledgerDir = resolve(
  process.env.CODEBUDDY_DELEGATIONS_DIR || join(homedir(), '.codebuddy', 'delegations')
);
const ledgerPath = join(ledgerDir, 'ledger.jsonl');
const keysDir = join(ledgerDir, 'keys');

class LedgerError extends Error {
  constructor(error, message, exitCode, details = {}) {
    super(message);
    this.error = error;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function printJson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function fail(error) {
  if (jsonMode) {
    printJson(process.stderr, {
      ok: false,
      error: error.error,
      message: error.message,
      ...error.details,
      exit_code: error.exitCode,
    });
  } else {
    process.stderr.write(`${error.message}\n`);
  }
  process.exit(error.exitCode);
}

function usage(message = 'Usage invalide.') {
  throw new LedgerError(
    'bad_input',
    `${message} Usage: lane-ledger.sh verify|list [--json] | append delegation|approval <options>.`,
    EXIT_USAGE
  );
}

function parseOptions(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === '--json') {
      continue;
    }
    if (!argument?.startsWith('--')) {
      usage(`Option inconnue : ${argument ?? ''}.`);
    }
    const value = values[index + 1];
    if (value === undefined || value.startsWith('--')) {
      usage(`Valeur absente pour ${argument}.`);
    }
    options[argument.slice(2).replaceAll('-', '_')] = value;
    index += 1;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) {
    usage(`Champ requis absent : --${name.replaceAll('_', '-')}.`);
  }
  return value;
}

function integer(options, name) {
  const raw = required(options, name);
  if (!/^-?\d+$/.test(raw)) {
    usage(`Entier invalide pour --${name.replaceAll('_', '-')}.`);
  }
  return Number(raw);
}

function sha(options, name, nullable = false) {
  const value = options[name];
  if (nullable && value === undefined) {
    return null;
  }
  const hash = required(options, name);
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    usage(`SHA-256 invalide pour --${name.replaceAll('_', '-')}.`);
  }
  return hash;
}

function gitHead(options, name) {
  const value = required(options, name);
  if (!/^[a-f0-9]{40,64}$/.test(value)) {
    usage(`HEAD invalide pour --${name.replaceAll('_', '-')}.`);
  }
  return value;
}

function safeSigner(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    usage('Le moteur/signataire contient des caractères interdits.');
  }
  return value;
}

function canonicalRepository(value) {
  try {
    return realpathSync(value);
  } catch {
    usage(`Dépôt introuvable : ${value}.`);
  }
}

function readLedgerLines() {
  if (!existsSync(ledgerPath)) {
    return [];
  }
  const content = readFileSync(ledgerPath, 'utf8');
  if (content.length === 0) {
    return [];
  }
  if (!content.endsWith('\n')) {
    throw new LedgerError(
      'chain_broken',
      `Chaîne cassée à la ligne ${content.split('\n').length} : ligne incomplète.`,
      EXIT_VERIFY,
      { line: content.split('\n').length }
    );
  }
  return content.slice(0, -1).split('\n');
}

function chainError(line, reason) {
  throw new LedgerError(
    'chain_broken',
    `Chaîne cassée à la ligne ${line} : ${reason}.`,
    EXIT_VERIFY,
    { line }
  );
}

function parseEntries(lines) {
  return lines.map((line, index) => {
    try {
      const entry = JSON.parse(line);
      if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
        chainError(index + 1, 'entrée JSON invalide');
      }
      return entry;
    } catch (error) {
      if (error instanceof LedgerError) {
        throw error;
      }
      chainError(index + 1, 'JSON invalide');
    }
  });
}

function verifyLines(lines) {
  const entries = parseEntries(lines);
  let previousHash = null;
  for (let index = 0; index < entries.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    const entry = entries[index];
    if (JSON.stringify(entry) !== line) {
      chainError(lineNumber, 'ligne non canonique');
    }
    if (entry.prev_hash !== previousHash) {
      chainError(lineNumber, 'prev_hash invalide');
    }
    const { entry_hash: entryHash, signature, ...body } = entry;
    if (typeof entryHash !== 'string' || digest(JSON.stringify(body)) !== entryHash) {
      chainError(lineNumber, 'entry_hash invalide');
    }
    if (typeof entry.signer !== 'string' || !/^[A-Za-z0-9._-]+$/.test(entry.signer)) {
      chainError(lineNumber, 'signataire invalide');
    }
    const publicKeyPath = join(keysDir, `${entry.signer}.pub`);
    const privateKeyPath = join(keysDir, `${entry.signer}.key`);
    if (!existsSync(publicKeyPath) || !existsSync(privateKeyPath)) {
      chainError(lineNumber, 'paire de clés absente');
    }
    if (
      (statSync(publicKeyPath).mode & 0o777) !== 0o600 ||
      (statSync(privateKeyPath).mode & 0o777) !== 0o600
    ) {
      chainError(lineNumber, 'permissions de clé différentes de 0600');
    }
    let publicKey;
    try {
      publicKey = createPublicKey(readFileSync(publicKeyPath));
      const derivedPublicKey = createPublicKey(createPrivateKey(readFileSync(privateKeyPath)));
      if (
        !publicKey
          .export({ type: 'spki', format: 'der' })
          .equals(derivedPublicKey.export({ type: 'spki', format: 'der' }))
      ) {
        chainError(lineNumber, 'paire de clés incohérente');
      }
    } catch (error) {
      if (error instanceof LedgerError) throw error;
      chainError(lineNumber, 'clé Ed25519 invalide');
    }
    const publicDer = publicKey.export({ type: 'spki', format: 'der' });
    if (entry.key_id !== digest(publicDer)) {
      chainError(lineNumber, 'identifiant de clé invalide');
    }
    if (typeof signature !== 'string') {
      chainError(lineNumber, 'signature absente');
    }
    const signatureBytes = Buffer.from(signature, 'base64');
    if (
      signatureBytes.toString('base64') !== signature ||
      !verify(null, Buffer.from(entryHash, 'utf8'), publicKey, signatureBytes)
    ) {
      chainError(lineNumber, 'signature invalide');
    }
    previousHash = digest(line);
  }
  return entries;
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireLock() {
  mkdirSync(ledgerDir, { recursive: true, mode: 0o700 });
  chmodSync(ledgerDir, 0o700);
  const lockDir = join(ledgerDir, '.ledger.lock');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      writeFileSync(join(lockDir, 'pid'), `${process.pid}\n`, { mode: 0o600 });
      return () => {
        try {
          unlinkSync(join(lockDir, 'pid'));
          rmdirSync(lockDir);
        } catch {
          // The append result is already durable; a stale lock is recoverable manually.
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      wait(50);
    }
  }
  throw new LedgerError('ledger_locked', 'Journal verrouillé depuis plus de 5 secondes.', EXIT_INTERNAL);
}

function ensureIdentity(signer) {
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  chmodSync(keysDir, 0o700);
  const privatePath = join(keysDir, `${signer}.key`);
  const publicPath = join(keysDir, `${signer}.pub`);
  if (!existsSync(privatePath)) {
    const pair = generateKeyPairSync('ed25519');
    writeFileSync(
      privatePath,
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { flag: 'wx', mode: 0o600 }
    );
  }
  chmodSync(privatePath, 0o600);
  const privateKey = createPrivateKey(readFileSync(privatePath));
  const publicKey = createPublicKey(privateKey);
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const temporaryPublicPath = `${publicPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPublicPath, publicPem, { mode: 0o600 });
  renameSync(temporaryPublicPath, publicPath);
  chmodSync(publicPath, 0o600);
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  return { privateKey, keyId: digest(publicDer) };
}

function delegationBody(options) {
  const report = options.report ?? null;
  const reportSha256 = sha(options, 'report_sha256', true);
  if ((report === null) !== (reportSha256 === null)) {
    usage('--report et --report-sha256 doivent être fournis ensemble.');
  }
  const engine = safeSigner(required(options, 'engine'));
  const repository = canonicalRepository(required(options, 'repository'));
  if (report !== null) {
    let reportPath;
    try {
      reportPath = realpathSync(join(repository, report));
    } catch {
      usage(`Rapport introuvable : ${report}.`);
    }
    if (
      !reportPath.startsWith(`${repository}${sep}`) ||
      !/^(RAPPORT-|REPARATION-|REVUE-)/.test(basename(reportPath))
    ) {
      usage('Le rapport doit rester dans le clone et porter un préfixe autorisé.');
    }
    if (digest(readFileSync(reportPath)) !== reportSha256) {
      usage('Le SHA-256 fourni ne correspond pas au rapport livré.');
    }
  }
  return {
    timestamp: new Date().toISOString(),
    type: 'delegation',
    lane: required(options, 'lane'),
    repository,
    branch: required(options, 'branch'),
    head_before: gitHead(options, 'head_before'),
    head_after: gitHead(options, 'head_after'),
    engine,
    exit_code: integer(options, 'exit_code'),
    report,
    report_sha256: reportSha256,
    mission_sha256: sha(options, 'mission_sha256'),
    signer: engine,
  };
}

function approvalBody(options) {
  const result = required(options, 'tests_result');
  if (!['passed', 'failed'].includes(result)) {
    usage('--tests-result doit valoir passed ou failed.');
  }
  return {
    timestamp: new Date().toISOString(),
    type: 'approval',
    approved_by: required(options, 'approved_by'),
    repository: canonicalRepository(required(options, 'repository')),
    target_repository: canonicalRepository(required(options, 'target_repository')),
    branch: required(options, 'branch'),
    head: gitHead(options, 'head'),
    tests_command: required(options, 'tests_command'),
    tests_result: result,
    tests_exit_code: integer(options, 'tests_exit_code'),
    signer: 'approval',
  };
}

function appendEntry(type, options) {
  const release = acquireLock();
  try {
    const lines = readLedgerLines();
    verifyLines(lines);
    const body = type === 'delegation' ? delegationBody(options) : approvalBody(options);
    const identity = ensureIdentity(body.signer);
    const chainedBody = {
      ...body,
      key_id: identity.keyId,
      prev_hash: lines.length > 0 ? digest(lines.at(-1)) : null,
    };
    const entryHash = digest(JSON.stringify(chainedBody));
    const signature = sign(null, Buffer.from(entryHash, 'utf8'), identity.privateKey).toString(
      'base64'
    );
    const entry = { ...chainedBody, entry_hash: entryHash, signature };
    appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    chmodSync(ledgerPath, 0o600);
    if (jsonMode) {
      printJson(process.stdout, { ok: true, line: lines.length + 1, entry_hash: entryHash });
    } else {
      process.stdout.write(`Entrée ${lines.length + 1} ajoutée au journal.\n`);
    }
  } finally {
    release();
  }
}

function verifyCommand() {
  const entries = verifyLines(readLedgerLines());
  if (jsonMode) {
    printJson(process.stdout, { ok: true, count: entries.length });
  } else {
    process.stdout.write(`Chaîne intacte (${entries.length} entrées).\n`);
  }
}

function listCommand() {
  const entries = parseEntries(readLedgerLines());
  if (jsonMode) {
    printJson(process.stdout, { ok: true, count: entries.length, entries });
    return;
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    process.stdout.write(
      `${index + 1}\t${entry.timestamp ?? '?'}\t${entry.type ?? '?'}\t${entry.branch ?? '?'}\n`
    );
  }
}

function findDelegation(options) {
  const entries = verifyLines(readLedgerLines());
  const repository = canonicalRepository(required(options, 'repository'));
  const branch = required(options, 'branch');
  const head = gitHead(options, 'head');
  const entry = entries
    .toReversed()
    .find(
      (candidate) =>
        candidate.type === 'delegation' &&
        candidate.repository === repository &&
        candidate.branch === branch &&
        candidate.head_after === head &&
        candidate.exit_code === 0 &&
        typeof candidate.report_sha256 === 'string'
    );
  if (!entry) {
    throw new LedgerError(
      'ledger_entry_missing',
      `Aucune lane réussie et vérifiée pour ${branch} à ${head}.`,
      EXIT_VERIFY
    );
  }
  printJson(process.stdout, { ok: true, entry });
}

function main() {
  const command = args[0];
  if (command === 'verify') {
    if (args.some((value, index) => index > 0 && value !== '--json')) usage();
    verifyCommand();
    return;
  }
  if (command === 'list') {
    if (args.some((value, index) => index > 0 && value !== '--json')) usage();
    listCommand();
    return;
  }
  if (command === 'find-delegation') {
    findDelegation(parseOptions(args.slice(1)));
    return;
  }
  if (command === 'append') {
    const type = args[1];
    if (!['delegation', 'approval'].includes(type)) {
      usage('Type d’entrée inconnu.');
    }
    appendEntry(type, parseOptions(args.slice(2)));
    return;
  }
  usage('Commande inconnue.');
}

try {
  main();
} catch (error) {
  if (error instanceof LedgerError) {
    fail(error);
  }
  fail(
    new LedgerError(
      'internal_error',
      error instanceof Error ? error.message : 'Erreur interne du journal.',
      EXIT_INTERNAL
    )
  );
}
