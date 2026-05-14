/**
 * buddy dev — golden-path developer workflows
 *
 * Subcommands:
 *   buddy dev plan "<objective>"     → RepoProfiler + TaskPlanner → show plan
 *   buddy dev run "<objective>"      → plan + implement + RunStore + artifacts
 *   buddy dev pr "<objective>"       → dev run + generate PR summary
 *   buddy dev fix-ci [--log <file>]  → read CI logs + propose patch + re-test
 *   buddy dev explain                → summarise repo conventions + critical paths
 */

import type { Command } from 'commander';

/** Helper: create agent from env */
async function createAgent() {
  const dotenv = await import('dotenv');
  dotenv.config();

  const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
  const { detectProviderFromEnv } = await import('../../utils/provider-detector.js');

  const provider = detectProviderFromEnv();
  if (!provider) {
    console.error('Error: no AI provider found. Run `buddy login chatgpt` or configure a provider API key.');
    process.exit(1);
  }

  return new CodeBuddyAgent(provider.apiKey, provider.baseURL, provider.defaultModel);
}

export function registerDevCommands(program: Command): void {
  const dev = program
    .command('dev')
    .description('Golden-path developer workflows (plan, run, pr, fix-ci, explain)');

  // ── buddy dev plan ─────────────────────────────────────────────
  dev
    .command('plan <objective>')
    .description('Profile repo + produce a task plan (no implementation)')
    .action(async (objective: string) => {
      const { getRepoProfiler } = await import('../../agent/repo-profiler.js');

      const profiler = getRepoProfiler();
      const profile = await profiler.getProfile();

      console.log('\nRepo profile:');
      console.log(`  ${profile.contextPack}`);
      console.log('');

      const agent = await createAgent();
      await agent.systemPromptReady;

      const prompt = `Repo context: ${profile.contextPack}

Objective: ${objective}

Produce a numbered implementation plan. For each step list:
- What file(s) to create or modify
- What change to make and why
- Any dependencies between steps

Do NOT implement yet. Plan only.`;

      console.log(`Planning: ${objective}\n`);
      for await (const chunk of agent.processUserMessageStream(prompt)) {
        if (chunk.type === 'content' && chunk.content) {
          process.stdout.write(chunk.content);
        }
      }
      console.log('');
      agent.dispose?.();
    });

  // ── buddy dev run ──────────────────────────────────────────────
  dev
    .command('run <objective>')
    .description('Plan + implement + test + save artifacts in RunStore')
    .option('-t, --type <type>', 'workflow type: add-feature|fix-tests|refactor|security-audit', 'add-feature')
    .option('-y, --yes', 'skip confirmation prompts (non-interactive)', false)
    .option('--write-policy <mode>', 'write policy: strict|confirm|off', 'strict')
    .action(async (objective: string, opts: { type: string; yes: boolean; writePolicy: string }) => {
      const { runWorkflow } = await import('./workflows.js');
      type WFType = 'add-feature' | 'fix-tests' | 'refactor' | 'security-audit';

      const validTypes: WFType[] = ['add-feature', 'fix-tests', 'refactor', 'security-audit'];
      const workflowType = validTypes.includes(opts.type as WFType)
        ? (opts.type as WFType)
        : 'add-feature';

      const validPolicies = ['strict', 'confirm', 'off'];
      const policyMode = validPolicies.includes(opts.writePolicy)
        ? (opts.writePolicy as 'strict' | 'confirm' | 'off')
        : 'strict';

      const agent = await createAgent();
      await agent.systemPromptReady;

      const result = await runWorkflow(workflowType, objective, agent, {
        nonInteractive: opts.yes,
        writePolicyMode: policyMode,
      });

      console.log(`\nRun ${result.runId}: ${result.status}`);
      if (result.artifactPaths.length > 0) {
        console.log('Artifacts:');
        for (const p of result.artifactPaths) {
          console.log(`  ${p}`);
        }
      }
      console.log(`\nView run: buddy run show ${result.runId}`);
      agent.dispose?.();
    });

  // ── buddy dev pr ───────────────────────────────────────────────
  dev
    .command('pr <objective>')
    .description('Run a workflow then generate a PR summary')
    .option('-t, --type <type>', 'workflow type', 'add-feature')
    .option('-y, --yes', 'skip confirmation prompts', false)
    .action(async (objective: string, opts: { type: string; yes: boolean }) => {
      const { runWorkflow } = await import('./workflows.js');
      type WFType = 'add-feature' | 'fix-tests' | 'refactor' | 'security-audit';

      const validTypes: WFType[] = ['add-feature', 'fix-tests', 'refactor', 'security-audit'];
      const workflowType = validTypes.includes(opts.type as WFType)
        ? (opts.type as WFType)
        : 'add-feature';

      const agent = await createAgent();
      await agent.systemPromptReady;

      const result = await runWorkflow(workflowType, objective, agent, {
        nonInteractive: opts.yes,
        tags: ['pr'],
      });

      if (result.status === 'completed') {
        console.log('\n── PR Summary ──────────────────────────');
        const prPrompt = `Based on what was just implemented, write a GitHub Pull Request description:
- Title (max 70 chars)
- Summary (bullet points of what changed)
- Test plan (what to verify)
Keep it concise and professional.`;

        for await (const chunk of agent.processUserMessageStream(prPrompt)) {
          if (chunk.type === 'content' && chunk.content) {
            process.stdout.write(chunk.content);
          }
        }
        console.log('');

        // Generate full PR description using LLM
        try {
          const { GitHubIntegration } = await import('../../integrations/github-integration.js');
          const gh = new GitHubIntegration();
          const prDescription = await gh.generatePRDescriptionWithLLM(
            undefined,
            async (prompt: string) => {
              let response = '';
              for await (const chunk of agent.processUserMessageStream(prompt)) {
                if (chunk.type === 'content' && chunk.content) response += chunk.content;
              }
              return response;
            },
          );
          console.log('\n── Full PR Description ─────────────────');
          console.log(prDescription);
        } catch {
          // Non-critical: PR summary was already printed above
        }
      }

      agent.dispose?.();
    });

  // ── buddy dev fix-ci ───────────────────────────────────────────
  dev
    .command('fix-ci')
    .description('Read CI/test logs and propose patches to fix failures')
    .option('--log <file>', 'path to CI log file (default: stdin)')
    .option('--run <id>', 'GitHub Actions run ID to fetch logs from')
    .option('--auto', 'auto-fix: root-cause via LLM, apply fix, run tests, push PR', false)
    .option('-y, --yes', 'skip confirmation prompts', false)
    .action(async (opts: { log?: string; run?: string; auto: boolean; yes: boolean }) => {
      // ── Auto-fix path ────────────────────────────────────────
      if (opts.auto) {
        const { getCIAutoFixPipeline } = await import('../../integrations/ci-autofix-pipeline.js');
        const pipeline = getCIAutoFixPipeline();

        // Wire LLM callback via agent
        const agent = await createAgent();
        await agent.systemPromptReady;

        pipeline.setLLMCallback(async (prompt: string) => {
          let response = '';
          for await (const chunk of agent.processUserMessageStream(prompt)) {
            if (chunk.type === 'content' && chunk.content) {
              response += chunk.content;
              process.stdout.write(chunk.content);
            }
          }
          return response;
        });

        // Resolve the CIFailure — either from --run or --log/stdin
        let failure: import('../../integrations/ci-autofix-pipeline.js').CIFailure | null = null;

        if (opts.run) {
          console.log(`Fetching logs for GitHub Actions run ${opts.run}...`);
          failure = await pipeline.fetchGitHubActionsLog(opts.run);
          if (!failure) {
            console.error(`Could not fetch failed job from run ${opts.run}. Is 'gh' installed and authenticated?`);
            agent.dispose?.();
            process.exit(1);
          }
        } else {
          // Read log from --log file or stdin
          let logContent = '';
          if (opts.log) {
            const fs = await import('fs');
            if (!fs.default.existsSync(opts.log)) {
              console.error(`Log file not found: ${opts.log}`);
              agent.dispose?.();
              process.exit(1);
            }
            logContent = fs.default.readFileSync(opts.log, 'utf-8');
          } else if (!process.stdin.isTTY) {
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) {
              chunks.push(chunk as Buffer);
            }
            logContent = Buffer.concat(chunks).toString('utf-8');
          } else {
            console.error('Auto-fix requires --run <id>, --log <file>, or piped CI output via stdin.');
            agent.dispose?.();
            process.exit(1);
          }

          failure = {
            provider: 'unknown',
            runId: `local-${Date.now()}`,
            jobName: 'ci',
            log: logContent,
            branch: 'main',
            commitSha: '',
            timestamp: new Date(),
          };

          // Try to detect branch from git
          try {
            const { BashTool } = await import('../../tools/bash/index.js');
            const bash = new BashTool();
            const branchResult = await bash.execute('git rev-parse --abbrev-ref HEAD');
            if (branchResult.success && branchResult.output) {
              failure.branch = branchResult.output.trim();
            }
            const shaResult = await bash.execute('git rev-parse HEAD');
            if (shaResult.success && shaResult.output) {
              failure.commitSha = shaResult.output.trim();
            }
          } catch {
            // Non-critical, keep defaults
          }
        }

        console.log(`\nAuto-fixing CI failure: ${failure.jobName} on ${failure.branch}`);
        console.log(`Provider: ${failure.provider} | Run: ${failure.runId}\n`);

        const result = await pipeline.autoFix(failure);

        console.log(`\n── Auto-Fix Result ──────────────────────`);
        console.log(`Success: ${result.success}`);
        console.log(`Attempts: ${result.attempts.length}`);

        for (const attempt of result.attempts) {
          console.log(`\n  Attempt ${attempt.attempt}:`);
          console.log(`    Root cause: ${attempt.rootCause}`);
          console.log(`    Files: ${attempt.filesModified.join(', ') || 'none'}`);
          console.log(`    Tests passed: ${attempt.localTestsPassed}`);
          console.log(`    Pushed: ${attempt.pushed}`);
          if (attempt.error) {
            console.log(`    Error: ${attempt.error.substring(0, 200)}`);
          }
        }

        if (result.prUrl) {
          console.log(`\nPR created: ${result.prUrl}`);
        }

        agent.dispose?.();
        return;
      }

      // ── Original interactive path ────────────────────────────
      let logContent = '';

      if (opts.log) {
        const fs = await import('fs');
        if (!fs.default.existsSync(opts.log)) {
          console.error(`Log file not found: ${opts.log}`);
          process.exit(1);
        }
        logContent = fs.default.readFileSync(opts.log, 'utf-8');
      } else if (!process.stdin.isTTY) {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        logContent = Buffer.concat(chunks).toString('utf-8');
      } else {
        console.error('Provide --log <file> or pipe CI output via stdin.');
        process.exit(1);
      }

      const { getRepoProfiler } = await import('../../agent/repo-profiler.js');
      const profiler = getRepoProfiler();
      const profile = await profiler.getProfile();

      const { runWorkflow } = await import('./workflows.js');
      const agent = await createAgent();
      await agent.systemPromptReady;

      // Inject CI log into conversation first
      const logPrompt = `CI/test log output (truncated to 5000 chars):
\`\`\`
${logContent.slice(0, 5000)}
\`\`\`
Repo context: ${profile.contextPack}`;

      for await (const chunk of agent.processUserMessageStream(logPrompt)) {
        if (chunk.type === 'content' && chunk.content) {
          process.stdout.write(chunk.content);
        }
      }

      const result = await runWorkflow('fix-tests', 'Fix CI/test failures from log', agent, {
        nonInteractive: opts.yes,
      });

      console.log(`\nRun ${result.runId}: ${result.status}`);
      agent.dispose?.();
    });

  // ── buddy dev issue ───────────────────────────────────────
  dev
    .command('issue <url-or-number>')
    .description('Fetch a GitHub issue, plan + implement + test + create PR')
    .option('-y, --yes', 'skip confirmation prompts', false)
    .option('--write-policy <mode>', 'write policy: strict|confirm|off', 'strict')
    .action(async (issueRef: string, opts: { yes: boolean; writePolicy: string }) => {
      const { runIssuePipeline } = await import('./issue-pipeline.js');

      const validPolicies = ['strict', 'confirm', 'off'];
      const policyMode = validPolicies.includes(opts.writePolicy)
        ? (opts.writePolicy as 'strict' | 'confirm' | 'off')
        : 'strict';

      const agent = await createAgent();
      await agent.systemPromptReady;

      const result = await runIssuePipeline(issueRef, agent, {
        nonInteractive: opts.yes,
        writePolicyMode: policyMode,
      });

      if (result.status === 'completed') {
        console.log(`\nIssue #${result.issueNumber} resolved successfully!`);
        console.log(`Branch: ${result.branch}`);
        if (result.prUrl) {
          console.log(`PR: ${result.prUrl}`);
        }
      } else {
        console.error(`\nIssue #${result.issueNumber} failed: ${result.error || 'unknown error'}`);
        process.exit(1);
      }

      agent.dispose?.();
    });

  // ── buddy dev explain ──────────────────────────────────────────
  dev
    .command('explain')
    .description('Summarise repo conventions, structure, and critical paths')
    .action(async () => {
      const { getRepoProfiler } = await import('../../agent/repo-profiler.js');

      const profiler = getRepoProfiler();
      const profile = await profiler.refresh(); // Force fresh profile

      console.log('\nRepo Profile:');
      console.log(`  Languages:       ${profile.languages.join(', ') || 'unknown'}`);
      if (profile.framework) console.log(`  Framework:       ${profile.framework}`);
      if (profile.packageManager) console.log(`  Package manager: ${profile.packageManager}`);
      const cmds = Object.entries(profile.commands);
      if (cmds.length > 0) {
        console.log('  Commands:');
        for (const [k, v] of cmds) {
          console.log(`    ${k}: ${v}`);
        }
      }
      const dirs = Object.entries(profile.directories);
      if (dirs.length > 0) {
        console.log('  Directories:');
        for (const [k, v] of dirs) {
          console.log(`    ${k}: ${v}`);
        }
      }
      console.log('');

      const agent = await createAgent();
      await agent.systemPromptReady;

      const prompt = `Repo context: ${profile.contextPack}

Analyse the current repository and provide:
1. Overview of the codebase structure and purpose
2. Key conventions (naming, code style, patterns)
3. Critical entry points and important files
4. How to run tests and build
5. Common development workflows

Be concise — this is a quick orientation for a developer.`;

      for await (const chunk of agent.processUserMessageStream(prompt)) {
        if (chunk.type === 'content' && chunk.content) {
          process.stdout.write(chunk.content);
        }
      }
      console.log('');
      agent.dispose?.();
    });
}
