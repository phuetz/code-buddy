#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

function run(label, command, args, timeoutMs) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} exited ${result.status ?? 'without a status'}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function parseJson(label, output) {
  const jsonStart = output.indexOf('{');
  if (jsonStart < 0) {
    throw new Error(`${label} did not print JSON:\n${output}`);
  }
  try {
    return JSON.parse(output.slice(jsonStart));
  } catch (error) {
    throw new Error(`${label} printed invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run('TypeScript build', process.execPath, [tscBin], 180_000);

const tools = parseJson(
  'built Hermes tools',
  run('built Hermes tools', process.execPath, ['dist/index.js', 'hermes', 'tools', '--json'], 90_000)
);
if (tools.kind !== 'hermes_official_tool_parity_manifest') {
  throw new Error(`Unexpected tools manifest kind: ${tools.kind}`);
}
if (tools.summary?.gaps !== 0 || tools.summary?.total < 70) {
  throw new Error(`Unexpected Hermes tool parity summary: ${JSON.stringify(tools.summary)}`);
}

const doctor = parseJson(
  'built Hermes doctor',
  run('built Hermes doctor', process.execPath, ['dist/index.js', 'hermes', 'doctor', 'safe', '--json'], 90_000)
);
if (doctor.requestedProfile !== 'safe') {
  throw new Error(`Unexpected doctor profile: ${doctor.requestedProfile}`);
}
if (doctor.diagnostics?.activeToolset?.toolsetId !== 'fleet.hermes.safe') {
  throw new Error(`Unexpected active toolset: ${doctor.diagnostics?.activeToolset?.toolsetId}`);
}

const lifecyclePlan = parseJson(
  'built Hermes lifecycle plan',
  run(
    'built Hermes lifecycle plan',
    process.execPath,
    ['dist/index.js', 'hermes', 'runtime', 'lifecycle', 'daytona', 'attach', '--target', 'sandbox-demo', '--json'],
    90_000
  )
);
if (lifecyclePlan.kind !== 'hermes_runtime_lifecycle_plan') {
  throw new Error(`Unexpected lifecycle plan kind: ${lifecyclePlan.kind}`);
}
if (lifecyclePlan.plan?.displayCommand !== 'daytona ssh sandbox-demo') {
  throw new Error(`Unexpected lifecycle plan command: ${lifecyclePlan.plan?.displayCommand}`);
}
if (!lifecyclePlan.plan?.notes?.some((note) => note.includes('CODEBUDDY_HERMES_ALLOW_LIFECYCLE_EXEC=true'))) {
  throw new Error(`Lifecycle plan did not explain execution guard: ${JSON.stringify(lifecyclePlan.plan?.notes)}`);
}

const lifecycleBlocked = parseJson(
  'built Hermes lifecycle guarded execution',
  run(
    'built Hermes lifecycle guarded execution',
    process.execPath,
    [
      'dist/index.js',
      'hermes',
      'runtime',
      'lifecycle',
      'daytona',
      'hibernate',
      '--target',
      'sandbox-demo',
      '--execute',
      '--json',
    ],
    90_000
  )
);
if (lifecycleBlocked.kind !== 'hermes_runtime_lifecycle_result') {
  throw new Error(`Unexpected lifecycle execution kind: ${lifecycleBlocked.kind}`);
}
if (lifecycleBlocked.result?.status !== 'blocked' || lifecycleBlocked.result?.ok !== false) {
  throw new Error(`Unexpected lifecycle execution status: ${JSON.stringify(lifecycleBlocked.result)}`);
}
if (!lifecycleBlocked.result?.output?.includes('CODEBUDDY_HERMES_ALLOW_LIFECYCLE_EXEC=true')) {
  throw new Error(`Lifecycle execution did not stay blocked by the global guard: ${lifecycleBlocked.result?.output}`);
}

const vercelAttachPlan = parseJson(
  'built Hermes Vercel Sandbox attach plan',
  run(
    'built Hermes Vercel Sandbox attach plan',
    process.execPath,
    [
      'dist/index.js',
      'hermes',
      'runtime',
      'lifecycle',
      'vercel-sandbox',
      'attach',
      '--target',
      'sb_abc123xyz',
      '--json',
    ],
    90_000
  )
);
if (vercelAttachPlan.plan?.displayCommand !== 'sandbox exec --interactive --tty sb_abc123xyz bash') {
  throw new Error(`Unexpected Vercel Sandbox attach plan: ${vercelAttachPlan.plan?.displayCommand}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        'node node_modules/typescript/bin/tsc',
        'node dist/index.js hermes tools --json',
        'node dist/index.js hermes doctor safe --json',
        'node dist/index.js hermes runtime lifecycle daytona attach --target sandbox-demo --json',
        'node dist/index.js hermes runtime lifecycle daytona hibernate --target sandbox-demo --execute --json',
        'node dist/index.js hermes runtime lifecycle vercel-sandbox attach --target sb_abc123xyz --json',
      ],
      toolSummary: tools.summary,
      activeToolset: doctor.diagnostics.activeToolset.toolsetId,
      lifecycleGuard: lifecycleBlocked.result.status,
      vercelAttach: vercelAttachPlan.plan.displayCommand,
    },
    null,
    2
  )
);
