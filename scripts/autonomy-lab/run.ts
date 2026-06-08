/**
 * Autonomy lab runner — drives the REAL Code Buddy agent through the REAL fleet
 * autonomous loop on a real test set, in an isolated sandbox, on free local
 * Ollama models.
 *
 * What it exercises (all production code, nothing mocked):
 *   - `FleetColabStore`        — the shared task queue (claim / TTL / DAG / complete)
 *   - `FleetAutonomousLoop`    — pick next claimable task → choose model by the
 *                                free-first ladder → run executor → complete/release
 *   - `chooseAutonomousModel`  — `medium` tasks run on the local tier, `high` tasks
 *                                escalate (policy `escalateAtPriority: 'high'`)
 *   - the executor below       — spawns the real `buddy` agent headless in the
 *                                sandbox (`-p <task> --permission-mode acceptEdits`,
 *                                pinned to the tier's model), then runs the task's
 *                                self-verifying `.check.mjs` as the acceptance gate.
 *
 * Safety: every agent runs with cwd = an ephemeral sandbox copy under the OS temp
 * dir; the checks are fixed `node <file>.check.mjs` invocations; nothing touches
 * this repo. Free: local Ollama, $0.
 *
 * Run:  tsx scripts/autonomy-lab/run.ts
 * Env overrides: CB_LAB_LOCAL_MODEL, CB_LAB_NETWORK_MODEL, OLLAMA_BASE_URL.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// ---- Model ladder config (free, local). Must be set before resolveModelTierConfig. ----
const LOCAL_MODEL = process.env['CB_LAB_LOCAL_MODEL'] || 'qwen3.6:35b-a3b-q4_K_M';
const NETWORK_MODEL = process.env['CB_LAB_NETWORK_MODEL'] || 'qwen3.6:35b-a3b-q4_K_M';
const OLLAMA_V1 = process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434/v1';
process.env['CODEBUDDY_LOCAL_MODEL'] = LOCAL_MODEL;
process.env['OLLAMA_BASE_URL'] = OLLAMA_V1;
process.env['CODEBUDDY_NETWORK_MODELS'] = `${NETWORK_MODEL}@${OLLAMA_V1}`;

const { FleetColabStore } = await import('../../src/fleet/colab-store.js');
const { FleetAutonomousLoop } = await import('../../src/daemon/autonomous-loop.js');
const { resolveModelTierConfig } = await import('../../src/agent/model-tier.js');

interface LabTask {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  filesToModify: string[];
  check: string;
  dependsOn?: string[];
  acceptanceCriteria?: string[];
}

function log(msg: string): void {
  console.log(`[lab] ${msg}`);
}

// tsx binary inside the repo (faster + deterministic than `npx tsx`).
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const indexTs = path.join(repoRoot, 'src', 'index.ts');

function runCheck(sandboxDir: string, checkFile: string): { ok: boolean; out: string } {
  const c = spawnSync('node', [checkFile], { cwd: sandboxDir, encoding: 'utf-8', timeout: 30_000 });
  return { ok: c.status === 0, out: `${c.stdout ?? ''}${c.stderr ?? ''}`.trim() };
}

async function main(): Promise<void> {
  const tasksFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'tasks.json'), 'utf-8')) as { tasks: LabTask[] };
  const tasks = tasksFile.tasks;
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  // 1. Fresh ephemeral sandbox = copy of the committed template.
  const sandboxDir = path.join(os.tmpdir(), 'cb-autonomy-lab', `run-${process.pid}`);
  fs.rmSync(sandboxDir, { recursive: true, force: true });
  fs.mkdirSync(sandboxDir, { recursive: true });
  fs.cpSync(path.join(__dirname, 'sandbox-template'), sandboxDir, { recursive: true });
  const colabDir = path.join(sandboxDir, '.colab');
  log(`sandbox: ${sandboxDir}`);
  log(`models: local=${LOCAL_MODEL}  network(high)=${NETWORK_MODEL}  endpoint=${OLLAMA_V1}`);

  // 2. Seed the colab queue.
  const store = new FleetColabStore({ dir: colabDir, agentId: 'autonomy-lab' });
  for (const t of tasks) {
    store.addTask({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      filesToModify: t.filesToModify,
      ...(t.acceptanceCriteria ? { acceptanceCriteria: t.acceptanceCriteria } : {}),
      ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}),
      createdBy: 'autonomy-lab',
    });
  }
  log(`seeded ${tasks.length} tasks (${tasks.filter((t) => t.dependsOn).length} with deps).`);

  // 3. Real-agent executor: spawn `buddy` headless in the sandbox on the chosen
  //    tier model, then run the acceptance check.
  const executor = async (task: { id: string; title: string; priority: string }, model: { model: string; tier: string; baseUrl?: string; paid?: boolean }) => {
    const meta = tasksById.get(task.id);
    if (!meta) return { ok: false, summary: `unknown task ${task.id}` };
    const host = (model.baseUrl ?? OLLAMA_V1).replace(/\/v1\/?$/, '');
    const env = { ...process.env, CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: host, GROK_MODEL: model.model };
    const prompt = `${task.title}\n\n${meta.description}`;
    const started = Date.now();
    log(`  → ${task.id} [${model.tier}/${model.model}] running real agent…`);
    const agent = spawnSync(tsxBin, [indexTs, '-p', prompt, '--permission-mode', 'acceptEdits', '--output-format', 'text'], {
      cwd: sandboxDir,
      env,
      encoding: 'utf-8',
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const { ok, out } = runCheck(sandboxDir, meta.check);
    const elapsed = Math.round((Date.now() - started) / 1000);
    return {
      ok,
      summary: `${task.id} [${model.tier}/${model.model}] check ${ok ? 'PASS' : 'FAIL'} (${elapsed}s)`,
      filesModified: meta.filesToModify,
      elapsedSeconds: elapsed,
      ...(ok ? {} : { error: (out.split('\n').filter(Boolean).slice(-3).join(' | ')) || (agent.stderr ?? 'check failed').slice(0, 200) }),
    };
  };

  // 4. Drive the real loop until drained (bounded so a permanently-failing task
  //    can't spin forever; t-slug-id is gated behind t-slugify by the DAG).
  const tierConfig = resolveModelTierConfig();
  const loop = new FleetAutonomousLoop({ store, tierConfig, executor: executor as never, policy: { escalateAtPriority: 'high' } });

  const maxTicks = tasks.length + 3;
  const ticks: Array<{ outcome: string; taskId?: string; tier?: string; model?: string }> = [];
  for (let i = 0; i < maxTicks; i++) {
    const r = await loop.tick();
    if (r.outcome === 'idle') {
      log(`tick ${i + 1}: idle — queue drained.`);
      break;
    }
    ticks.push({ outcome: r.outcome, taskId: r.taskId, tier: r.model?.tier, model: r.model?.model });
    log(`tick ${i + 1}: ${r.outcome} — ${r.taskTitle ?? ''} [${r.model?.tier}/${r.model?.model}]`);
  }

  // 5. Final report: re-verify every task's check + collect store state.
  console.log('\n================ AUTONOMY LAB REPORT ================');
  const finalTasks = store.listTasks();
  const rows: Array<Record<string, unknown>> = [];
  let passed = 0;
  for (const t of tasks) {
    const stored = finalTasks.find((x) => x.id === t.id);
    const { ok } = runCheck(sandboxDir, t.check);
    if (ok) passed++;
    const tick = [...ticks].reverse().find((x) => x.taskId === t.id);
    rows.push({
      task: t.id,
      priority: t.priority,
      tier: tick?.tier ?? '—',
      model: tick?.model ?? '—',
      status: stored?.status ?? 'unknown',
      check: ok ? 'PASS ✅' : 'FAIL ❌',
    });
  }
  console.table(rows);
  console.log(`Result: ${passed}/${tasks.length} acceptance checks pass. Sandbox: ${sandboxDir}`);
  console.log('Worklog:');
  for (const w of store.listWorklog?.() ?? []) {
    console.log(`  - [${w.taskId}] ${w.summary}`);
  }
  console.log('====================================================');
  console.log(JSON.stringify({ passed, total: tasks.length, rows, sandboxDir }, null, 2));

  process.exit(passed === tasks.length ? 0 : 1);
}

await main();
