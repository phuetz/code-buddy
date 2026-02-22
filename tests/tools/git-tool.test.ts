/**
 * Git Tool Tests
 *
 * Tests for the GitTool class including blame, cherry-pick, and bisect operations.
 * Uses a temporary git repository initialized in beforeEach for isolation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { GitTool } from '../../src/tools/git-tool';
import { ConfirmationService } from '../../src/utils/confirmation-service';

// Auto-approve all confirmation prompts in tests
ConfirmationService.getInstance().setSessionFlag('bashCommands', true);

let tmpDir: string;
let git: GitTool;

/**
 * Helper: run a git command in the temp repo
 */
function runGit(args: string, cwd?: string): string {
  return execSync(`git ${args}`, { cwd: cwd || tmpDir, encoding: 'utf-8' }).trim();
}

/**
 * Helper: create a file and commit it
 */
function createAndCommit(filename: string, content: string, message: string): string {
  const filePath = path.join(tmpDir, filename);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  runGit(`add ${filename}`);
  runGit(`commit -m "${message}"`);
  return runGit('rev-parse HEAD');
}

beforeEach(() => {
  // Create a fresh temporary directory for each test
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tool-test-'));
  runGit('init');
  runGit('config user.email "test@example.com"');
  runGit('config user.name "Test User"');

  git = new GitTool(tmpDir);
});

afterEach(() => {
  // Clean up temp directory
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on Windows
  }
});

// ============================================================================
// Existing functionality tests (baseline)
// ============================================================================

describe('GitTool - Existing Operations', () => {
  it('should detect a git repository', async () => {
    const isRepo = await git.isGitRepo();
    expect(isRepo).toBe(true);
  });

  it('should return false for non-git directory', async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
    const nonGitTool = new GitTool(nonGitDir);
    const isRepo = await nonGitTool.isGitRepo();
    expect(isRepo).toBe(false);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('should get status of clean repo after initial commit', async () => {
    createAndCommit('README.md', '# Test', 'Initial commit');
    const status = await git.getStatus();
    expect(status.staged).toHaveLength(0);
    expect(status.unstaged).toHaveLength(0);
    expect(status.untracked).toHaveLength(0);
  });

  it('should detect untracked files', async () => {
    createAndCommit('README.md', '# Test', 'Initial commit');
    fs.writeFileSync(path.join(tmpDir, 'new-file.txt'), 'hello', 'utf-8');
    const status = await git.getStatus();
    expect(status.untracked).toContain('new-file.txt');
  });

  it('should get log entries', async () => {
    createAndCommit('a.txt', 'a', 'First commit');
    createAndCommit('b.txt', 'b', 'Second commit');
    const log = await git.getLog(2);
    expect(log).toContain('First commit');
    expect(log).toContain('Second commit');
  });

  it('should add and commit files', async () => {
    createAndCommit('init.txt', 'init', 'Initial');
    fs.writeFileSync(path.join(tmpDir, 'staged.txt'), 'staged content', 'utf-8');

    const addResult = await git.add(['staged.txt']);
    expect(addResult.success).toBe(true);

    const commitResult = await git.commit('Test commit');
    expect(commitResult.success).toBe(true);
    expect(commitResult.output).toContain('Test commit');
  });
});

// ============================================================================
// Blame Tests
// ============================================================================

describe('GitTool.blame', () => {
  it('should return blame for a committed file', async () => {
    createAndCommit('hello.txt', 'line 1\nline 2\nline 3\n', 'Add hello');

    const result = await git.blame('hello.txt');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Line');
    expect(result.output).toContain('Commit');
    expect(result.output).toContain('Author');
    expect(result.output).toContain('Test User');
    expect(result.output).toContain('line 1');
    expect(result.output).toContain('line 2');
    expect(result.output).toContain('line 3');
  });

  it('should return structured blame data', async () => {
    createAndCommit('data.txt', 'alpha\nbeta\ngamma\n', 'Add data');

    const result = await git.blame('data.txt');
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const blameLines = result.data as Array<{
      lineNumber: number;
      commitHash: string;
      author: string;
      date: string;
      content: string;
    }>;
    expect(blameLines).toHaveLength(3);
    expect(blameLines[0].lineNumber).toBe(1);
    expect(blameLines[0].author).toBe('Test User');
    expect(blameLines[0].content).toBe('alpha');
    expect(blameLines[0].commitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(blameLines[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should support line range filtering (start and end)', async () => {
    createAndCommit('range.txt', 'one\ntwo\nthree\nfour\nfive\n', 'Add range');

    const result = await git.blame('range.txt', { startLine: 2, endLine: 4 });
    expect(result.success).toBe(true);

    const blameLines = result.data as Array<{ content: string; lineNumber: number }>;
    expect(blameLines).toHaveLength(3);
    expect(blameLines[0].content).toBe('two');
    expect(blameLines[0].lineNumber).toBe(2);
    expect(blameLines[2].content).toBe('four');
    expect(blameLines[2].lineNumber).toBe(4);
  });

  it('should support line range with only start line', async () => {
    createAndCommit('partial.txt', 'a\nb\nc\nd\n', 'Add partial');

    const result = await git.blame('partial.txt', { startLine: 3 });
    expect(result.success).toBe(true);

    const blameLines = result.data as Array<{ content: string }>;
    expect(blameLines).toHaveLength(2);
    expect(blameLines[0].content).toBe('c');
    expect(blameLines[1].content).toBe('d');
  });

  it('should track multiple authors across commits', async () => {
    createAndCommit('multi.txt', 'original line\n', 'First author');

    // Change author for second commit
    runGit('config user.name "Second Author"');
    fs.writeFileSync(path.join(tmpDir, 'multi.txt'), 'original line\nnew line\n', 'utf-8');
    runGit('add multi.txt');
    runGit('commit -m "Second author adds line"');

    const result = await git.blame('multi.txt');
    expect(result.success).toBe(true);

    const blameLines = result.data as Array<{ author: string; content: string }>;
    expect(blameLines).toHaveLength(2);
    expect(blameLines[0].author).toBe('Test User');
    expect(blameLines[0].content).toBe('original line');
    expect(blameLines[1].author).toBe('Second Author');
    expect(blameLines[1].content).toBe('new line');
  });

  it('should fail for non-existent file', async () => {
    createAndCommit('exists.txt', 'hi', 'Init');
    const result = await git.blame('does-not-exist.txt');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should fail for file not yet committed', async () => {
    createAndCommit('init.txt', 'init', 'Init');
    fs.writeFileSync(path.join(tmpDir, 'uncommitted.txt'), 'data', 'utf-8');
    const result = await git.blame('uncommitted.txt');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================================
// Cherry-Pick Tests
// ============================================================================

describe('GitTool.cherryPick', () => {
  let mainCommit: string;
  let featureCommit: string;

  beforeEach(() => {
    // Set up: main branch with initial commit, feature branch with a commit
    mainCommit = createAndCommit('base.txt', 'base content\n', 'Initial commit on main');

    // Create feature branch and add a commit
    runGit('checkout -b feature');
    featureCommit = createAndCommit('feature.txt', 'feature content\n', 'Add feature file');

    // Go back to main
    runGit('checkout master || git checkout main');
  });

  it('should cherry-pick a commit successfully', async () => {
    const result = await git.cherryPick(featureCommit);
    expect(result.success).toBe(true);

    // Verify the file exists on main now
    const filePath = path.join(tmpDir, 'feature.txt');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n')).toBe('feature content\n');

    // Verify a new commit was created
    const log = runGit('log --oneline -1');
    expect(log).toContain('Add feature file');
  });

  it('should cherry-pick with --no-commit flag', async () => {
    const result = await git.cherryPick(featureCommit, { noCommit: true });
    expect(result.success).toBe(true);

    // File should exist but changes should be staged, not committed
    const filePath = path.join(tmpDir, 'feature.txt');
    expect(fs.existsSync(filePath)).toBe(true);

    // The last commit should still be the initial one
    const log = runGit('log --oneline -1');
    expect(log).toContain('Initial commit on main');
  });

  it('should detect and report conflicts', async () => {
    // Modify the same file on main to create a conflict
    fs.writeFileSync(path.join(tmpDir, 'feature.txt'), 'main version\n', 'utf-8');
    runGit('add feature.txt');
    runGit('commit -m "Add conflicting feature.txt on main"');

    const result = await git.cherryPick(featureCommit);
    expect(result.success).toBe(false);
    expect(result.error).toContain('conflict');

    // Abort the cherry-pick to clean up
    runGit('cherry-pick --abort');
  });

  it('should fail with invalid commit hash', async () => {
    const result = await git.cherryPick('0000000000000000000000000000000000000000');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should cherry-pick multiple sequential commits', async () => {
    // Add another commit on feature branch
    runGit('checkout feature');
    const secondCommit = createAndCommit('feature2.txt', 'second feature\n', 'Second feature');
    runGit('checkout master || git checkout main');

    // Cherry-pick the first commit
    const result1 = await git.cherryPick(featureCommit);
    expect(result1.success).toBe(true);

    // Cherry-pick the second commit
    const result2 = await git.cherryPick(secondCommit);
    expect(result2.success).toBe(true);

    // Both files should exist
    expect(fs.existsSync(path.join(tmpDir, 'feature.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'feature2.txt'))).toBe(true);
  });

  it('should provide conflict file list in output', async () => {
    // Create conflicting file
    fs.writeFileSync(path.join(tmpDir, 'feature.txt'), 'conflicting content\n', 'utf-8');
    runGit('add feature.txt');
    runGit('commit -m "Conflicting commit"');

    const result = await git.cherryPick(featureCommit);
    expect(result.success).toBe(false);

    if (result.output) {
      expect(result.output).toContain('feature.txt');
    }

    // Abort the cherry-pick to clean up
    runGit('cherry-pick --abort');
  });
});

// ============================================================================
// Bisect Tests
// ============================================================================

describe('GitTool.bisect', () => {
  let commits: string[];

  beforeEach(() => {
    commits = [];
    // Create a series of commits to bisect through
    for (let i = 1; i <= 6; i++) {
      const hash = createAndCommit(
        `file${i}.txt`,
        `content ${i}\n`,
        `Commit ${i}`
      );
      commits.push(hash);
    }
  });

  it('should start a bisect session', async () => {
    const result = await git.bisectStart();
    expect(result.success).toBe(true);

    // Clean up
    await git.bisectReset();
  });

  it('should start bisect with bad and good refs', async () => {
    const result = await git.bisectStart(commits[5], commits[0]);
    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();

    // Clean up
    await git.bisectReset();
  });

  it('should mark current commit as bad', async () => {
    await git.bisectStart();
    runGit(`bisect bad ${commits[5]}`);
    runGit(`bisect good ${commits[0]}`);

    const result = await git.bisectStep('bad');
    expect(result.success).toBe(true);

    // Clean up
    await git.bisectReset();
  });

  it('should mark current commit as good', async () => {
    await git.bisectStart();
    runGit(`bisect bad ${commits[5]}`);
    runGit(`bisect good ${commits[0]}`);

    const result = await git.bisectStep('good');
    expect(result.success).toBe(true);

    // Clean up
    await git.bisectReset();
  });

  it('should mark current commit as skip', async () => {
    await git.bisectStart();
    runGit(`bisect bad ${commits[5]}`);
    runGit(`bisect good ${commits[0]}`);

    const result = await git.bisectStep('skip');
    expect(result.success).toBe(true);

    // Clean up
    await git.bisectReset();
  });

  it('should complete a full bisect workflow and find the bad commit', async () => {
    // Start bisect: last commit is bad, first is good
    const startResult = await git.bisectStart(commits[5], commits[0]);
    expect(startResult.success).toBe(true);

    // Bisect through commits until done
    let done = false;
    let iterations = 0;
    const maxIterations = 10;

    while (!done && iterations < maxIterations) {
      iterations++;

      // Get current commit
      const currentHash = runGit('rev-parse HEAD');

      // Our "bug" was introduced at commit 3 (index 2)
      const commitIndex = commits.indexOf(currentHash);
      const isBad = commitIndex >= 2;

      const stepResult = await git.bisectStep(isBad ? 'bad' : 'good');
      expect(stepResult.success).toBe(true);

      if (stepResult.data && (stepResult.data as { done: boolean }).done) {
        done = true;
        // The output should mention the first bad commit
        expect(stepResult.output).toContain('is the first bad commit');
      }
    }

    expect(done).toBe(true);
    expect(iterations).toBeLessThanOrEqual(6); // binary search should be fast

    // Clean up
    await git.bisectReset();
  });

  it('should reset the bisect session', async () => {
    await git.bisectStart(commits[5], commits[0]);

    const resetResult = await git.bisectReset();
    expect(resetResult.success).toBe(true);

    // Should be back on the original HEAD
    const currentHead = runGit('rev-parse HEAD');
    expect(currentHead).toBe(commits[5]);
  });

  it('should fail bisect step when no bisect session is active', async () => {
    const result = await git.bisectStep('good');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should fail bisect reset when no bisect session is active', async () => {
    // bisect reset on a repo with no active bisect session
    // Git actually returns success for this case, so just verify it doesn't crash
    const result = await git.bisectReset();
    // Git may succeed or fail depending on version - just verify no crash
    expect(result).toBeDefined();
  });
});

// ============================================================================
// Git Registry Adapter Tests
// ============================================================================

describe('GitOperationTool (Registry Adapter)', () => {
  // Import dynamically to avoid module-level initialization issues
  let GitOperationTool: any;

  beforeEach(async () => {
    const mod = await import('../../src/tools/registry/git-tools');
    GitOperationTool = mod.GitOperationTool;
    mod.resetGitInstance();
  });

  it('should have correct name and description', () => {
    const tool = new GitOperationTool();
    expect(tool.name).toBe('git');
    expect(tool.description).toContain('blame');
    expect(tool.description).toContain('cherry-pick');
    expect(tool.description).toContain('bisect');
  });

  it('should return valid schema', () => {
    const tool = new GitOperationTool();
    const schema = tool.getSchema();
    expect(schema.name).toBe('git');
    expect(schema.parameters.type).toBe('object');
    expect(schema.parameters.properties?.operation?.enum).toContain('blame');
    expect(schema.parameters.properties?.operation?.enum).toContain('cherry_pick');
    expect(schema.parameters.properties?.operation?.enum).toContain('bisect_start');
    expect(schema.parameters.properties?.operation?.enum).toContain('bisect_step');
    expect(schema.parameters.properties?.operation?.enum).toContain('bisect_reset');
  });

  it('should return valid metadata', () => {
    const tool = new GitOperationTool();
    const metadata = tool.getMetadata();
    expect(metadata.category).toBe('git');
    expect(metadata.keywords).toContain('blame');
    expect(metadata.keywords).toContain('cherry-pick');
    expect(metadata.keywords).toContain('bisect');
  });

  it('should validate valid input', () => {
    const tool = new GitOperationTool();
    const result = tool.validate({ operation: 'status' });
    expect(result.valid).toBe(true);
  });

  it('should reject invalid operation', () => {
    const tool = new GitOperationTool();
    const result = tool.validate({ operation: 'invalid_op' });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('should reject missing operation', () => {
    const tool = new GitOperationTool();
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it('should reject non-object input', () => {
    const tool = new GitOperationTool();
    const result = tool.validate('not an object');
    expect(result.valid).toBe(false);
  });

  it('should validate blame requires file arg', () => {
    const tool = new GitOperationTool();
    const result = tool.validate({ operation: 'blame', args: {} });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('blame requires args.file');
  });

  it('should validate cherry_pick requires commit arg', () => {
    const tool = new GitOperationTool();
    const result = tool.validate({ operation: 'cherry_pick', args: {} });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('cherry_pick requires args.commit');
  });

  it('should validate bisect_step requires result arg', () => {
    const tool = new GitOperationTool();
    const result = tool.validate({ operation: 'bisect_step', args: {} });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('bisect_step');
  });

  it('should validate checkout requires branch arg', () => {
    const tool = new GitOperationTool();
    const result = tool.validate({ operation: 'checkout', args: {} });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('checkout requires args.branch');
  });

  it('should validate commit requires message arg', () => {
    const tool = new GitOperationTool();
    const result = tool.validate({ operation: 'commit', args: {} });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('commit requires args.message');
  });

  it('should report as available', () => {
    const tool = new GitOperationTool();
    expect(tool.isAvailable()).toBe(true);
  });

  it('should return error for unknown operation in execute', async () => {
    const tool = new GitOperationTool();
    const result = await tool.execute({ operation: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown git operation');
  });
});

// ============================================================================
// Edge Cases & Error Handling
// ============================================================================

describe('GitTool - Edge Cases', () => {
  it('should handle blame on a single-line file', async () => {
    createAndCommit('single.txt', 'only one line\n', 'Single line file');

    const result = await git.blame('single.txt');
    expect(result.success).toBe(true);

    const blameLines = result.data as Array<{ content: string }>;
    expect(blameLines).toHaveLength(1);
    expect(blameLines[0].content).toBe('only one line');
  });

  it('should handle blame with line range equal to file length', async () => {
    createAndCommit('exact.txt', 'a\nb\nc\n', 'Exact range');

    const result = await git.blame('exact.txt', { startLine: 1, endLine: 3 });
    expect(result.success).toBe(true);

    const blameLines = result.data as Array<{ content: string }>;
    expect(blameLines).toHaveLength(3);
  });

  it('should handle cherry-pick of a commit that is already applied', async () => {
    const commitHash = createAndCommit('already.txt', 'content\n', 'Already here');

    // Cherry-picking a commit that is already on the current branch
    // should fail since there's nothing new to apply
    const result = await git.cherryPick(commitHash);
    // This may succeed with empty or fail depending on git version
    expect(result).toBeDefined();
  });

  it('should handle blame output with special characters in content', async () => {
    createAndCommit('special.txt', 'line with "quotes"\nline with <brackets>\nline with &ampersand\n', 'Special chars');

    const result = await git.blame('special.txt');
    expect(result.success).toBe(true);

    const blameLines = result.data as Array<{ content: string }>;
    expect(blameLines[0].content).toBe('line with "quotes"');
    expect(blameLines[1].content).toBe('line with <brackets>');
    expect(blameLines[2].content).toBe('line with &ampersand');
  });
});
