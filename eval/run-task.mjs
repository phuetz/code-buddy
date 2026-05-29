import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

// Automatically confirm approvals in non-interactive evaluation runner
process.env.CODEBUDDY_AUTO_CONFIRM = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const tasksDir = path.join(__dirname, 'tasks');
const sandboxDir = path.join(__dirname, 'sandbox');
const sandboxTarget = path.join(__dirname, 'sandbox', 'target.txt');
const transientCodeBuddyPathPrefixes = [
  '.codebuddy/agent-memory/',
  '.codebuddy/cache/',
  '.codebuddy/lessons-vault/',
  '.codebuddy/replays/',
  '.codebuddy/sync/',
  '.codebuddy/tool-results/',
];
const transientCodeBuddyPaths = new Set([
  '.codebuddy/CODEBUDDY_MEMORY.md',
  '.codebuddy/code-graph.json',
  '.codebuddy/code-graph-snapshot.json',
  '.codebuddy/repoProfile.json',
]);

function formatCommand(command, args) {
  return [command, ...args]
    .map(part => (/[\s"]/).test(part) ? JSON.stringify(part) : part)
    .join(' ');
}

// Helper to run process commands without shell quoting.
function runCmd(command, args = [], cwd = projectRoot, options = {}) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const output = `${err.stdout || ''}${err.stderr || ''}`;
    if (options.allowFailure) {
      return output;
    }
    throw new Error(`Command failed: ${formatCommand(command, args)}\n${output}`);
  }
}

function toRepoPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function createIsolatedEvalRepo() {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-eval-repo-'));
  const targetDir = path.join(runRoot, 'eval', 'sandbox');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sandboxDir, targetDir, { recursive: true });

  runCmd('git', ['init'], runRoot);
  runCmd('git', ['config', 'user.name', 'Code Buddy Eval'], runRoot);
  runCmd('git', ['config', 'user.email', 'eval@example.invalid'], runRoot);
  runCmd('git', ['add', 'eval/sandbox'], runRoot);
  runCmd('git', ['commit', '-m', 'initial eval sandbox'], runRoot);

  return { runRoot };
}

function isTransientCodeBuddyPath(filePath) {
  return transientCodeBuddyPaths.has(filePath)
    || transientCodeBuddyPathPrefixes.some(prefix => filePath.startsWith(prefix));
}

// Clean sandbox state
function cleanSandbox(runRoot) {
  runCmd('git', ['restore', '--', 'eval/sandbox'], runRoot);
}

function parseGitStatusPath(line) {
  const rawPath = line.slice(3).split(' -> ').pop() || line.slice(3);
  return rawPath.trim().replace(/\\/g, '/').replace(/^"|"$/g, '');
}

// Run a single task
function runTask(taskSlug) {
  const taskPath = path.join(tasksDir, taskSlug);
  const contractPath = path.join(taskPath, 'contract.json');
  const expectedPath = path.join(taskPath, 'expected.json');

  if (!fs.existsSync(contractPath) || !fs.existsSync(expectedPath)) {
    console.error(`Task ${taskSlug} is missing contract.json or expected.json`);
    return false;
  }

  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
  const { runRoot } = createIsolatedEvalRepo();
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-eval-task-'));
  const runtimeContractPath = path.join(runtimeDir, 'contract.json');
  const cleanup = () => {
    fs.rmSync(runRoot, { force: true, recursive: true });
    fs.rmSync(runtimeDir, { force: true, recursive: true });
  };

  try {
    console.log(`\n--- Running task: ${taskSlug} ---`);
    cleanSandbox(runRoot);

    const runtimeContract = {
      ...contract,
      repo: toRepoPath(runRoot),
    };
    fs.writeFileSync(runtimeContractPath, `${JSON.stringify(runtimeContract, null, 2)}\n`, 'utf8');

    const additionalArgs = Array.isArray(expected.args) ? expected.args : [];
    const cmdArgs = [
      'dist/index.js',
      'autonomous-code',
      '--task-file',
      runtimeContractPath,
      '--apply-edits',
      '--run-verification',
      '--json',
      ...additionalArgs,
    ];

    console.log(`Command: ${formatCommand(process.execPath, cmdArgs)}`);
    const stdout = runCmd(process.execPath, cmdArgs, projectRoot, { allowFailure: true });

    let result;
    try {
      result = JSON.parse(stdout.trim());
    } catch (_err) {
      console.error(`Failed to parse agent output as JSON for task ${taskSlug}. Raw output:`);
      console.error(stdout);
      return false;
    }

    console.log(`Agent returned status: ${result.status}`);

    // Assertions
    const errors = [];

    if (result.status !== expected.status) {
      errors.push(`Expected status "${expected.status}" but got "${result.status}"`);
    }

    // Get git status to check modified files
    const gitStatusOutput = runCmd('git', ['status', '--porcelain', '--untracked-files=all'], runRoot);
    const modifiedFiles = gitStatusOutput
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(parseGitStatusPath)
      .filter(file => {
        // Exclude transient .codebuddy paths from validation checks
        return !isTransientCodeBuddyPath(file);
      });

    console.log('Modified files:', modifiedFiles);

    if (expected.mustNotTouchOutside) {
      const allowed = contract.allowedPaths || [];
      for (const file of modifiedFiles) {
        // Check if file is allowed (allowed paths are relative)
        const isAllowed = allowed.some(allowedPath => file.endsWith(allowedPath));
        if (!isAllowed) {
          errors.push(`Modified file outside allowedPaths: ${file}`);
        }
      }
    }

    if (expected.mustTouchPaths) {
      for (const mustTouch of expected.mustTouchPaths) {
        const touched = modifiedFiles.some(file => file.endsWith(mustTouch));
        if (!touched && expected.status === 'verified') {
          errors.push(`Expected file to be modified but it was not: ${mustTouch}`);
        }
      }
    }

    if (modifiedFiles.length > expected.maxFilesChanged) {
      errors.push(`Modified ${modifiedFiles.length} files, which exceeds max expected of ${expected.maxFilesChanged}`);
    }

    const verPassed = result.verification && result.verification.length > 0 && result.verification[0].status === 'passed';
    if (expected.verificationMustPass && !verPassed) {
      errors.push(`Expected verification to pass, but it failed or did not run.`);
    } else if (!expected.verificationMustPass && verPassed) {
      errors.push(`Expected verification to fail, but it passed.`);
    }

    cleanSandbox(runRoot);

    if (errors.length > 0) {
      console.log(`[FAIL] Task ${taskSlug} failed validation:`);
      errors.forEach(err => console.log(`  - ${err}`));
      return false;
    } else {
      console.log(`[PASS] Task ${taskSlug} verified successfully.`);
      return true;
    }
  } finally {
    cleanup();
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  let tasksToRun = [];

  if (args.length > 0) {
    tasksToRun = [args[0]];
  } else {
    tasksToRun = fs.readdirSync(tasksDir).filter(file => {
      return fs.statSync(path.join(tasksDir, file)).isDirectory();
    });
  }

  console.log(`Found tasks to run: ${tasksToRun.join(', ')}`);

  let allPassed = true;
  for (const task of tasksToRun) {
    const passed = runTask(task);
    if (!passed) allPassed = false;
  }

  console.log('\n=======================================');
  if (allPassed) {
    console.log('ALL EVALUATION TASKS PASSED SUCCESSFULLY.');
    process.exit(0);
  } else {
    console.log('SOME EVALUATION TASKS FAILED.');
    process.exit(1);
  }
}

main();
