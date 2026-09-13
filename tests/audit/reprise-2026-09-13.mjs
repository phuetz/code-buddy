// Vérification réelle des quatre correctifs de persistance (HOME et fichiers isolés).
// Exécuter dans un worktree dédié ; aucun fournisseur ni service réel.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const qa = await fs.mkdtemp(path.join(root, '_qa/audit/run-'));
for (const dir of ['home', 'process', 'session']) await fs.mkdir(path.join(qa, dir));
process.env.HOME = path.join(qa, 'home');
process.env.USERPROFILE = process.env.HOME;
process.env.NODE_ENV = 'test';
process.env.CODEBUDDY_SESSIONS_DIR = path.join(qa, 'sessions');
process.env.CODEBUDDY_HEADLESS = 'true';
delete process.env.CODEBUDDY_PROJECT_RUNTIME_READONLY;
globalThis.fetch = async () => { throw new Error('Network forbidden in audit'); };
process.chdir(path.join(qa, 'process'));
const { SessionStore } = await import('../../src/persistence/session-store.ts');
const { SessionFacade } = await import('../../src/agent/facades/session-facade.ts');
const { SessionEncryption } = await import('../../src/security/session-encryption.ts');
const { PersistentMemoryManager } = await import('../../src/memory/persistent-memory.ts');
const { RememberTool } = await import('../../src/tools/registry/memory-tools.ts');
const { FactsMemoryService } = await import('../../src/memory/facts-memory.ts');
const report = {};
const store = new SessionStore({ useSQLite: false });
const session = await store.createSession('audit');
const history = [{ type: 'tool_result', content: 'résumé court', timestamp: new Date(),
  toolCall: { id: 'original-123', type: 'function', function: { name: 'bash', arguments: '{"command":"npm test"}' } },
  toolResult: { success: false, output: 'preuve complète', error: 'test failure' } }];
await store.updateCurrentSession(history);
const loaded = await new SessionStore({ useSQLite: false }).loadSession(session.id);
const restored = store.convertMessagesToChatEntries(loaded.messages)[0];
assert.equal(restored.toolCall.function.arguments, history[0].toolCall.function.arguments);
assert.equal(restored.toolResult.output, 'preuve complète');
assert.equal(restored.content, 'résumé court');
report.session = { arguments: restored.toolCall.function.arguments, outputLost: false, contentPreserved: true };
process.env.SESSION_ENCRYPTION = 'true';
const facade = new SessionFacade({ sessionStore: store, checkpointManager: {} });
await facade.saveCurrentSession([{ type: 'user', content: 'bonjour audit', timestamp: new Date() }]);
const encrypted = await facade.loadSession(session.id);
assert.equal(encrypted.messages[0].content, 'bonjour audit');
report.encryption = { restoredType: encrypted.messages[0].type, returnsEncryptedMarker: false };
const originalEncrypt = SessionEncryption.prototype.encryptObject;
SessionEncryption.prototype.encryptObject = () => { throw new Error('injected encryption failure'); };
try { await assert.rejects(facade.saveCurrentSession([{ type: 'user', content: 'private-audit-marker', timestamp: new Date() }]), /injected encryption failure/); }
finally { SessionEncryption.prototype.encryptObject = originalEncrypt; }
const plaintext = await fs.readFile(path.join(process.env.CODEBUDDY_SESSIONS_DIR, session.id + '.json'), 'utf8');
assert.doesNotMatch(plaintext, /private-audit-marker/);
report.encryption.failureWritesPlaintext = false;
delete process.env.SESSION_ENCRYPTION;
const result = await new RememberTool().execute({ key: 'audit-path', value: 'dossier de session', scope: 'project' }, { cwd: path.join(qa, 'session') });
assert.equal(result.success, true);
assert.match(await fs.readFile(path.join(qa, 'session/.codebuddy/CODEBUDDY_MEMORY.md'), 'utf8'), /audit-path/);
assert.equal(await fs.stat(path.join(qa, 'process/.codebuddy/CODEBUDDY_MEMORY.md')).then(() => true, () => false), false);
report.memoryCwd = { success: true, writtenToProcess: false, writtenToSession: true };
const config = { projectMemoryPath: path.join(qa, 'shared.md'), userMemoryPath: path.join(qa, 'user.md'), autoCapture: false };
const a = new PersistentMemoryManager(config), b = new PersistentMemoryManager(config);
await a.initialize(); await b.initialize();
await a.remember('note-a', 'valeur alpha', { scope: 'project', tags: ['pinned'], category: 'preferences' });
await b.remember('note-b', 'valeur beta', { scope: 'project' });
const disk = await fs.readFile(config.projectMemoryPath, 'utf8');
assert.match(disk, /note-a/); assert.match(disk, /note-b/);
report.concurrentMemory = { bothRetained: true };
// Injecter uniquement le client LLM ; la réconciliation et la persistance restent réelles.
const previousGetClient = FactsMemoryService.prototype.getClient;
FactsMemoryService.prototype.getClient = async () => ({ chat: async () => ({ choices: [{ message: { content: JSON.stringify([
  { action: 'DELETE', targetIndex: 0 },
  { action: 'ADD', fact: { category: 'Projet', text: 'note-c: valeur gamma' } },
]) } }] }) });
try { await a.remember('note-c', 'valeur gamma', { scope: 'project' }); }
finally { FactsMemoryService.prototype.getClient = previousGetClient; }
const afterDelete = await fs.readFile(config.projectMemoryPath, 'utf8');
assert.match(afterDelete, /note-a/);
assert.match(afterDelete, /note-b/);
assert.equal(await fs.stat(config.projectMemoryPath.replace(/\.md$/, '.archive.md')).then(() => true, () => false), false);
report.reconciliation = { pinnedPreferenceDeleted: false, archiveCreated: false, unrelatedWriterPreserved: true };
console.log(JSON.stringify(report, null, 2));
await fs.writeFile(path.join(qa, 'results.json'), JSON.stringify(report, null, 2));
