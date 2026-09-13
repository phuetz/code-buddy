/** Diagnostic observations, not assertions that these defects are desirable. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-reprise-audit-'));
const oldHome = process.env.HOME;
process.env.HOME = root;
globalThis.fetch = async () => { throw new Error('Network disabled for audit'); };
const { PendingProposalStore } = await import('../../src/agent/self-improvement/proposal-store.ts');
const { SkillImprovementEngine } = await import('../../src/agent/self-improvement/skill-engine.ts');
const { LiveSkillMutator } = await import('../../src/agent/self-improvement/skill-mutator.ts');
const { EvolutionaryArchive } = await import('../../src/agent/self-improvement/evolutionary-archive.ts');
const { getSkillRegistry } = await import('../../src/skills/registry.ts');
const { runProc } = await import('../../src/agent/self-improvement/evolution/variant-fitness.ts');
const out = {};
try {
  const store = new PendingProposalStore({ workDir: root });
  const proposal = { id: 'fixture', targetScenarioId: 'audit/a', spec: { name: 'authored-audit-reprise', description: 'Synthetic review guidance', content: '# Review\nUse this workflow to review a synthetic document carefully.' } };
  store.saveSkill({ scenarioId: 'audit/a', acceptedAt: new Date(0).toISOString(), proposal, gate: { accepted: true } });
  out.proposalCollision = { samePath: store.pathFor('skill', 'audit/a') === store.pathFor('skill', 'audit:a'), loadedScenario: store.loadSkill('audit:a')?.scenarioId };
  assert.equal(out.proposalCollision.loadedScenario, 'audit/a');

  const skillRoot = path.join(root, 'skills');
  const registry = getSkillRegistry({ workspacePath: skillRoot, managedPath: '', bundledPath: '', watchEnabled: false });
  const mutator = new LiveSkillMutator(skillRoot);
  const archive = new EvolutionaryArchive({ workDir: root });
  // A directory occupying the destination reliably simulates an unwritable journal.
  await fs.mkdir(archive.path, { recursive: true });
  const engine = new SkillImprovementEngine({ workDir: root, autonomy: 'auto-apply', mutator, archive,
    scenarios: [{ id: 'review', query: 'review', description: 'Synthetic', expectIncludes: ['review'] }],
    proposer: { propose: async () => ({ ...proposal, targetScenarioId: 'review' }) },
    evaluateBehavior: async () => ({ accepted: true, wins: 1, losses: 0, tested: 1, cases: [{ id: 'fixture', before: false, after: true }] }),
  });
  let rejected = false;
  try { await engine.runCycle(); } catch { rejected = true; }
  out.installWithoutJournal = { rejected, installed: mutator.has(proposal.spec.name), loaded: !!registry.get(proposal.spec.name), archived: archive.list().length, retryScenario: (await engine.runCycle()).selectedScenarioId };
  assert.deepEqual(out.installWithoutJournal, { rejected: true, installed: true, loaded: true, archived: 0, retryScenario: null });

  // Grandchild is finite (1.5 seconds), writes only inside our temporary directory.
  const marker = path.join(root, 'descendant-finished');
  const descendant = `setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'done');},1500)`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
  const start = Date.now();
  const result = await runProc(process.execPath, ['-e', parent], { checkoutDir: root, timeoutMs: 100 });
  out.timeout = { timedOut: result.timedOut, elapsedMs: Date.now() - start, descendantFinished: await fs.access(marker).then(() => true, () => false) };
  assert.equal(out.timeout.timedOut, true);
  assert.equal(out.timeout.descendantFinished, true);
  assert.ok(out.timeout.elapsedMs > 1000);
  console.log(JSON.stringify(out, null, 2));
} finally {
  getSkillRegistry().shutdown();
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  await fs.rm(root, { recursive: true, force: true });
}
