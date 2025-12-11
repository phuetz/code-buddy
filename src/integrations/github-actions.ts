/**
 * GitHub Actions Integration
 *
 * Enables AI-powered CI/CD workflow management:
 * - Create and manage GitHub Actions workflows
 * - AI-assisted workflow debugging
 * - Automated PR checks
 * - Security scanning in CI
 * - Cost optimization for workflows
 *
 * Inspired by Gemini CLI's GitHub integration.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as yaml from 'js-yaml';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowConfig {
  name: string;
  on: WorkflowTrigger;
  jobs: Record<string, WorkflowJob>;
  env?: Record<string, string>;
  defaults?: {
    run?: {
      shell?: string;
      'working-directory'?: string;
    };
  };
}

export interface WorkflowTrigger {
  push?: {
    branches?: string[];
    paths?: string[];
    tags?: string[];
  };
  pull_request?: {
    branches?: string[];
    types?: string[];
  };
  workflow_dispatch?: {
    inputs?: Record<string, {
      description: string;
      required?: boolean;
      default?: string;
      type?: 'string' | 'boolean' | 'choice';
      options?: string[];
    }>;
  };
  schedule?: Array<{ cron: string }>;
}

export interface WorkflowJob {
  name?: string;
  'runs-on': string;
  needs?: string | string[];
  if?: string;
  steps: WorkflowStep[];
  env?: Record<string, string>;
  strategy?: {
    matrix?: Record<string, any[]>;
    'fail-fast'?: boolean;
    'max-parallel'?: number;
  };
  timeout?: number;
  services?: Record<string, any>;
}

export interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, any>;
  env?: Record<string, string>;
  if?: string;
  id?: string;
  'working-directory'?: string;
  shell?: string;
  'continue-on-error'?: boolean;
  'timeout-minutes'?: number;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out';
  created_at: string;
  updated_at: string;
  html_url: string;
  workflow_id: number;
  run_number: number;
  head_branch: string;
  head_sha: string;
}

export interface GitHubActionsConfig {
  /** GitHub token */
  token?: string;
  /** Repository owner */
  owner?: string;
  /** Repository name */
  repo?: string;
  /** Workflows directory */
  workflowsDir: string;
}

// ============================================================================
// Workflow Templates
// ============================================================================

const WORKFLOW_TEMPLATES: Record<string, WorkflowConfig> = {
  'node-ci': {
    name: 'Node.js CI',
    on: {
      push: { branches: ['main', 'develop'] },
      pull_request: { branches: ['main'] },
    },
    jobs: {
      build: {
        'runs-on': 'ubuntu-latest',
        strategy: {
          matrix: {
            'node-version': ['18.x', '20.x', '22.x'],
          },
        },
        steps: [
          { uses: 'actions/checkout@v4' },
          {
            name: 'Use Node.js ${{ matrix.node-version }}',
            uses: 'actions/setup-node@v4',
            with: { 'node-version': '${{ matrix.node-version }}', cache: 'npm' },
          },
          { run: 'npm ci' },
          { run: 'npm run build --if-present' },
          { run: 'npm test' },
        ],
      },
    },
  },

  'python-ci': {
    name: 'Python CI',
    on: {
      push: { branches: ['main'] },
      pull_request: { branches: ['main'] },
    },
    jobs: {
      build: {
        'runs-on': 'ubuntu-latest',
        strategy: {
          matrix: {
            'python-version': ['3.10', '3.11', '3.12'],
          },
        },
        steps: [
          { uses: 'actions/checkout@v4' },
          {
            name: 'Set up Python ${{ matrix.python-version }}',
            uses: 'actions/setup-python@v5',
            with: { 'python-version': '${{ matrix.python-version }}' },
          },
          {
            name: 'Install dependencies',
            run: 'python -m pip install --upgrade pip\npip install -r requirements.txt',
          },
          {
            name: 'Run tests',
            run: 'pytest',
          },
        ],
      },
    },
  },

  'security-scan': {
    name: 'Security Scan',
    on: {
      push: { branches: ['main'] },
      pull_request: { branches: ['main'] },
      schedule: [{ cron: '0 0 * * 0' }],
    },
    jobs: {
      'security-scan': {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          {
            name: 'Run Trivy vulnerability scanner',
            uses: 'aquasecurity/trivy-action@master',
            with: {
              'scan-type': 'fs',
              'ignore-unfixed': true,
              format: 'sarif',
              output: 'trivy-results.sarif',
            },
          },
          {
            name: 'Upload Trivy scan results',
            uses: 'github/codeql-action/upload-sarif@v3',
            with: { 'sarif_file': 'trivy-results.sarif' },
          },
        ],
      },
    },
  },

  'release': {
    name: 'Release',
    on: {
      push: { tags: ['v*'] },
    },
    jobs: {
      release: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          {
            name: 'Create Release',
            uses: 'softprops/action-gh-release@v2',
            with: {
              generate_release_notes: true,
            },
            env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
          },
        ],
      },
    },
  },

  'docker-build': {
    name: 'Docker Build',
    on: {
      push: { branches: ['main'], tags: ['v*'] },
      pull_request: { branches: ['main'] },
    },
    jobs: {
      build: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          {
            name: 'Set up Docker Buildx',
            uses: 'docker/setup-buildx-action@v3',
          },
          {
            name: 'Login to GitHub Container Registry',
            uses: 'docker/login-action@v3',
            with: {
              registry: 'ghcr.io',
              username: '${{ github.actor }}',
              password: '${{ secrets.GITHUB_TOKEN }}',
            },
          },
          {
            name: 'Build and push',
            uses: 'docker/build-push-action@v5',
            with: {
              push: '${{ github.event_name != \'pull_request\' }}',
              tags: 'ghcr.io/${{ github.repository }}:latest',
              cache_from: 'type=gha',
              cache_to: 'type=gha,mode=max',
            },
          },
        ],
      },
    },
  },

  'lint-format': {
    name: 'Lint and Format',
    on: {
      push: { branches: ['main'] },
      pull_request: { branches: ['main'] },
    },
    jobs: {
      lint: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          { uses: 'actions/setup-node@v4', with: { 'node-version': '20', cache: 'npm' } },
          { run: 'npm ci' },
          { name: 'Run ESLint', run: 'npm run lint' },
          { name: 'Check formatting', run: 'npm run format:check || npm run format -- --check' },
          { name: 'Type check', run: 'npm run typecheck || npm run type-check || true' },
        ],
      },
    },
  },

  'grok-review': {
    name: 'Grok AI Review',
    on: {
      pull_request: { types: ['opened', 'synchronize'] },
    },
    jobs: {
      review: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4', with: { 'fetch-depth': 0 } },
          {
            name: 'Install Grok CLI',
            run: 'npm install -g grok-cli',
          },
          {
            name: 'Run AI Review',
            run: 'grok --non-interactive "Review the changes in this PR and provide feedback"',
            env: {
              GROK_API_KEY: '${{ secrets.GROK_API_KEY }}',
            },
          },
        ],
      },
    },
  },
};

// ============================================================================
// GitHub Actions Manager
// ============================================================================

export class GitHubActionsManager extends EventEmitter {
  private config: GitHubActionsConfig;
  private workflowsDir: string;

  constructor(config: Partial<GitHubActionsConfig> = {}) {
    super();
    this.config = {
      workflowsDir: '.github/workflows',
      ...config,
    };
    this.workflowsDir = this.config.workflowsDir;
  }

  /**
   * Initialize and detect repository info
   */
  async initialize(): Promise<void> {
    // Try to detect from git remote
    if (!this.config.owner || !this.config.repo) {
      try {
        const remote = await this.execGit(['remote', 'get-url', 'origin']);
        const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
        if (match) {
          this.config.owner = this.config.owner || match[1];
          this.config.repo = this.config.repo || match[2];
        }
      } catch {
        // Ignore errors
      }
    }

    // Ensure workflows directory exists
    if (!fs.existsSync(this.workflowsDir)) {
      fs.mkdirSync(this.workflowsDir, { recursive: true });
    }

    this.emit('initialized');
  }

  /**
   * List available workflow templates
   */
  getTemplates(): string[] {
    return Object.keys(WORKFLOW_TEMPLATES);
  }

  /**
   * Get template details
   */
  getTemplate(name: string): WorkflowConfig | null {
    return WORKFLOW_TEMPLATES[name] || null;
  }

  /**
   * Create workflow from template
   */
  async createFromTemplate(templateName: string, fileName?: string): Promise<string> {
    const template = WORKFLOW_TEMPLATES[templateName];
    if (!template) {
      throw new Error(`Unknown template: ${templateName}`);
    }

    const workflowFileName = fileName || `${templateName}.yml`;
    const workflowPath = path.join(this.workflowsDir, workflowFileName);

    // Check if file exists
    if (fs.existsSync(workflowPath)) {
      throw new Error(`Workflow file already exists: ${workflowPath}`);
    }

    // Write workflow
    const yamlContent = yaml.dump(template, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(workflowPath, yamlContent);

    this.emit('workflow:created', { path: workflowPath, template: templateName });
    return workflowPath;
  }

  /**
   * Create custom workflow
   */
  async createWorkflow(config: WorkflowConfig, fileName: string): Promise<string> {
    const workflowPath = path.join(this.workflowsDir, fileName);

    if (fs.existsSync(workflowPath)) {
      throw new Error(`Workflow file already exists: ${workflowPath}`);
    }

    const yamlContent = yaml.dump(config, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(workflowPath, yamlContent);

    this.emit('workflow:created', { path: workflowPath });
    return workflowPath;
  }

  /**
   * List existing workflows
   */
  listWorkflows(): Array<{ name: string; path: string; config?: WorkflowConfig }> {
    if (!fs.existsSync(this.workflowsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.workflowsDir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

    return files.map(file => {
      const filePath = path.join(this.workflowsDir, file);
      let config: WorkflowConfig | undefined;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        config = yaml.load(content) as WorkflowConfig;
      } catch {
        // Ignore parse errors
      }

      return {
        name: config?.name || file,
        path: filePath,
        config,
      };
    });
  }

  /**
   * Read workflow file
   */
  readWorkflow(fileName: string): WorkflowConfig | null {
    const workflowPath = path.join(this.workflowsDir, fileName);

    if (!fs.existsSync(workflowPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      return yaml.load(content) as WorkflowConfig;
    } catch {
      return null;
    }
  }

  /**
   * Update workflow file
   */
  async updateWorkflow(fileName: string, config: WorkflowConfig): Promise<void> {
    const workflowPath = path.join(this.workflowsDir, fileName);

    const yamlContent = yaml.dump(config, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(workflowPath, yamlContent);

    this.emit('workflow:updated', { path: workflowPath });
  }

  /**
   * Delete workflow file
   */
  deleteWorkflow(fileName: string): boolean {
    const workflowPath = path.join(this.workflowsDir, fileName);

    if (!fs.existsSync(workflowPath)) {
      return false;
    }

    fs.unlinkSync(workflowPath);
    this.emit('workflow:deleted', { path: workflowPath });
    return true;
  }

  /**
   * Validate workflow syntax
   */
  validateWorkflow(config: WorkflowConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!config.name) {
      errors.push('Workflow must have a name');
    }

    if (!config.on || Object.keys(config.on).length === 0) {
      errors.push('Workflow must have at least one trigger');
    }

    if (!config.jobs || Object.keys(config.jobs).length === 0) {
      errors.push('Workflow must have at least one job');
    }

    // Validate jobs
    for (const [jobId, job] of Object.entries(config.jobs || {})) {
      if (!job['runs-on']) {
        errors.push(`Job "${jobId}" must specify runs-on`);
      }

      if (!job.steps || job.steps.length === 0) {
        errors.push(`Job "${jobId}" must have at least one step`);
      }

      // Validate steps
      for (let i = 0; i < (job.steps || []).length; i++) {
        const step = job.steps[i];
        if (!step.uses && !step.run) {
          errors.push(`Step ${i + 1} in job "${jobId}" must have either 'uses' or 'run'`);
        }
      }

      // Validate job dependencies
      if (job.needs) {
        const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
        for (const dep of needs) {
          if (!config.jobs[dep]) {
            errors.push(`Job "${jobId}" depends on non-existent job "${dep}"`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get workflow runs using GitHub CLI
   */
  async getWorkflowRuns(workflowName?: string, limit = 10): Promise<WorkflowRun[]> {
    try {
      const args = ['run', 'list', '--json', 'databaseId,name,status,conclusion,createdAt,updatedAt,url,workflowDatabaseId,number,headBranch,headSha'];

      if (workflowName) {
        args.push('--workflow', workflowName);
      }

      args.push('--limit', String(limit));

      const output = await this.execGh(args);
      const runs = JSON.parse(output);

      return runs.map((run: any) => ({
        id: run.databaseId,
        name: run.name,
        status: run.status?.toLowerCase(),
        conclusion: run.conclusion?.toLowerCase(),
        created_at: run.createdAt,
        updated_at: run.updatedAt,
        html_url: run.url,
        workflow_id: run.workflowDatabaseId,
        run_number: run.number,
        head_branch: run.headBranch,
        head_sha: run.headSha,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Trigger workflow manually
   */
  async triggerWorkflow(workflowName: string, ref = 'main', inputs?: Record<string, string>): Promise<boolean> {
    try {
      const args = ['workflow', 'run', workflowName, '--ref', ref];

      if (inputs) {
        for (const [key, value] of Object.entries(inputs)) {
          args.push('-f', `${key}=${value}`);
        }
      }

      await this.execGh(args);
      this.emit('workflow:triggered', { workflow: workflowName, ref, inputs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * View workflow run logs
   */
  async getRunLogs(runId: number): Promise<string> {
    try {
      const output = await this.execGh(['run', 'view', String(runId), '--log']);
      return output;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Cancel workflow run
   */
  async cancelRun(runId: number): Promise<boolean> {
    try {
      await this.execGh(['run', 'cancel', String(runId)]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Re-run workflow
   */
  async rerunWorkflow(runId: number, failedOnly = false): Promise<boolean> {
    try {
      const args = ['run', 'rerun', String(runId)];
      if (failedOnly) {
        args.push('--failed');
      }
      await this.execGh(args);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Analyze workflow for optimizations
   */
  analyzeWorkflow(config: WorkflowConfig): Array<{ type: string; message: string; severity: 'info' | 'warning' | 'error' }> {
    const suggestions: Array<{ type: string; message: string; severity: 'info' | 'warning' | 'error' }> = [];

    // Check for caching opportunities
    for (const [_jobId, job] of Object.entries(config.jobs || {})) {
      const hasSetupNode = job.steps?.some(s => s.uses?.includes('setup-node'));
      const hasCache = job.steps?.some(s => s.uses?.includes('actions/cache'));

      if (hasSetupNode && !hasCache) {
        const nodeStep = job.steps?.find(s => s.uses?.includes('setup-node'));
        if (!nodeStep?.with?.cache) {
          suggestions.push({
            type: 'caching',
            message: 'Consider adding cache: "npm" to setup-node for faster builds',
            severity: 'info',
          });
        }
      }
    }

    // Check for parallel job opportunities
    const jobIds = Object.keys(config.jobs || {});
    if (jobIds.length === 1 && config.jobs) {
      const job = config.jobs[jobIds[0]];
      if (job.steps && job.steps.length > 10) {
        suggestions.push({
          type: 'parallelization',
          message: 'Consider splitting long job into multiple parallel jobs',
          severity: 'info',
        });
      }
    }

    // Check for security issues
    for (const [jobId, job] of Object.entries(config.jobs || {})) {
      for (const step of job.steps || []) {
        // Check for unpinned actions
        if (step.uses && !step.uses.includes('@v') && !step.uses.includes('@sha')) {
          suggestions.push({
            type: 'security',
            message: `Job "${jobId}": Action "${step.uses}" should be pinned to a specific version`,
            severity: 'warning',
          });
        }

        // Check for shell injection risks
        if (step.run && step.run.includes('${{')) {
          suggestions.push({
            type: 'security',
            message: `Job "${jobId}": Direct use of expressions in run commands may be vulnerable to injection`,
            severity: 'warning',
          });
        }
      }
    }

    // Check for timeout
    for (const [jobId, job] of Object.entries(config.jobs || {})) {
      if (!job.timeout) {
        suggestions.push({
          type: 'reliability',
          message: `Job "${jobId}": Consider adding a timeout-minutes to prevent stuck workflows`,
          severity: 'info',
        });
      }
    }

    return suggestions;
  }

  /**
   * Format workflow summary
   */
  formatSummary(): string {
    const workflows = this.listWorkflows();
    const lines: string[] = [
      '🔄 GitHub Actions Workflows',
      '═'.repeat(40),
      '',
    ];

    if (workflows.length === 0) {
      lines.push('No workflows found.');
      lines.push('');
      lines.push('Available templates:');
      for (const template of this.getTemplates()) {
        lines.push(`  • ${template}`);
      }
      lines.push('');
      lines.push('Use /actions create <template> to create a workflow');
    } else {
      lines.push(`Found ${workflows.length} workflow(s):`);
      lines.push('');
      for (const workflow of workflows) {
        const triggers = workflow.config?.on
          ? Object.keys(workflow.config.on).join(', ')
          : 'unknown';
        lines.push(`📄 ${workflow.name}`);
        lines.push(`   File: ${workflow.path}`);
        lines.push(`   Triggers: ${triggers}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `Git exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private execGh(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `gh exited with code ${code}`));
        }
      });

      proc.on('error', () => {
        reject(new Error('GitHub CLI (gh) not found. Install from https://cli.github.com/'));
      });
    });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: GitHubActionsManager | null = null;

export function getGitHubActionsManager(config?: Partial<GitHubActionsConfig>): GitHubActionsManager {
  if (!managerInstance) {
    managerInstance = new GitHubActionsManager(config);
  }
  return managerInstance;
}

export function resetGitHubActionsManager(): void {
  managerInstance = null;
}
