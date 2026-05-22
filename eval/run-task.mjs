import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const tasksDir = path.join(__dirname, 'tasks');
const sandboxTarget = path.join(__dirname, 'sandbox', 'target.txt');

// Helper to run shell commands
function runCmd(cmd, cwd = projectRoot) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    return err.stdout + err.stderr;
  }
}

// Clean sandbox state
function cleanSandbox() {
  runCmd(`git restore "${sandboxTarget}"`);
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

  console.log(`\n--- Running task: ${taskSlug} ---`);
  cleanSandbox();

  const additionalArgs = expected.args ? expected.args.join(' ') : '';
  const cmd = `node dist/index.js autonomous-code --task-file "${contractPath}" --apply-edits --run-verification --json ${additionalArgs}`;

  console.log(`Command: ${cmd}`);
  const stdout = runCmd(cmd);

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
  const gitStatusOutput = runCmd('git status --porcelain');
  const modifiedFiles = gitStatusOutput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      // Line is like: M eval/sandbox/target.txt
      const parts = line.split(/\s+/);
      return parts[parts.length - 1];
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

  cleanSandbox();

  if (errors.length > 0) {
    console.log(`[FAIL] Task ${taskSlug} failed validation:`);
    errors.forEach(err => console.log(`  - ${err}`));
    return false;
  } else {
    console.log(`[PASS] Task ${taskSlug} verified successfully.`);
    return true;
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
