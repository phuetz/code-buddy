import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Automatically confirm approvals in non-interactive evaluation runner
process.env.CODEBUDDY_AUTO_CONFIRM = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const tasksDir = path.join(__dirname, 'tasks');
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

// Helper to run shell commands
function runCmd(cmd, cwd = projectRoot, options = {}) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const output = `${err.stdout || ''}${err.stderr || ''}`;
    if (options.allowFailure) {
      return output;
    }
    throw new Error(`Command failed: ${cmd}\n${output}`);
  }
}

function toRepoPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function createIsolatedEvalRepo() {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-eval-repo-'));
  const targetPath = path.join(runRoot, 'eval', 'sandbox', 'target.txt');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sandboxTarget, targetPath);

  runCmd('git init', runRoot);
  runCmd('git config user.name "Code Buddy Eval"', runRoot);
  runCmd('git config user.email "eval@example.invalid"', runRoot);
  runCmd('git add eval/sandbox/target.txt', runRoot);
  runCmd('git commit -m "initial eval sandbox"', runRoot);

  return { runRoot, targetPath };
}

function isTransientCodeBuddyPath(filePath) {
  return transientCodeBuddyPaths.has(filePath)
    || transientCodeBuddyPathPrefixes.some(prefix => filePath.startsWith(prefix));
}

// Clean sandbox state
function cleanSandbox(runRoot) {
  runCmd('git restore -- eval/sandbox/target.txt', runRoot);
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

    const additionalArgs = expected.args ? expected.args.join(' ') : '';
    const cmd = `node dist/index.js autonomous-code --task-file "${runtimeContractPath}" --apply-edits --run-verification --json ${additionalArgs}`;

    console.log(`Command: ${cmd}`);
    const stdout = runCmd(cmd, projectRoot, { allowFailure: true });

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
    const gitStatusOutput = runCmd('git status --porcelain --untracked-files=all', runRoot);
    const modifiedFiles = gitStatusOutput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Line is like: M eval/sandbox/target.txt
        const parts = line.split(/\s+/);
        return parts[parts.length - 1];
      })
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
