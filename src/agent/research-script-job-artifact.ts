import type { AgentRunArtifact } from './agent-run-contract.js';

export const RESEARCH_SCRIPT_JOB_SCHEMA_VERSION = 1;

export type ResearchScriptLanguage = 'javascript' | 'python' | 'shell' | 'typescript';
export type ResearchScriptSandboxProvider =
  | 'daytona'
  | 'docker'
  | 'local'
  | 'manual_review'
  | 'remote'
  | 'vercel-sandbox'
  | 'wsl';
export type ResearchScriptNetworkPolicy = 'allowlist_only' | 'disabled' | 'https_only_public_web';
export type ResearchScriptWritePolicy = 'artifact_dir_only' | 'output_path_only';
export type ResearchScriptCleanupPolicy = 'delete_tmp_keep_outputs' | 'keep_all_artifacts' | 'manual_review';

export interface ResearchScriptCommand {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  executable: string;
}

export interface ResearchScriptJobFiles {
  input: string;
  manifest: string;
  output: string;
  readme: string;
  script: string;
  stderr: string;
  stdout: string;
  summary: string;
}

export interface ResearchScriptJobSandboxPolicy {
  allowedDomains: string[];
  cleanup: ResearchScriptCleanupPolicy;
  delayMs: number;
  ignoredDomains: string[];
  network: ResearchScriptNetworkPolicy;
  pageBudget: number;
  provider: ResearchScriptSandboxProvider;
  stopOn: string[];
  target: string | null;
  timeoutMs: number;
  writes: ResearchScriptWritePolicy;
}

export interface ResearchScriptJobAssertion {
  description: string;
  id: string;
  kind: 'evidence' | 'file_exists' | 'json_schema' | 'no_contact_action' | 'stdout_contains';
  required: boolean;
}

export interface ResearchScriptJobArtifact {
  schemaVersion: typeof RESEARCH_SCRIPT_JOB_SCHEMA_VERSION;
  id: string;
  artifactRoot: string;
  command: ResearchScriptCommand;
  createdAt: string;
  files: ResearchScriptJobFiles;
  goal: string;
  inputContract: Record<string, string>;
  language: ResearchScriptLanguage;
  outputContract: Record<string, string>;
  sandboxPolicy: ResearchScriptJobSandboxPolicy;
  assertions: ResearchScriptJobAssertion[];
  title: string;
  agentRunArtifact: AgentRunArtifact;
}

export interface BuildResearchScriptJobArtifactInput {
  goal: string;
  inputContract: Record<string, string>;
  language: ResearchScriptLanguage;
  outputContract: Record<string, string>;
  assertions?: ResearchScriptJobAssertion[];
  artifactRoot?: string;
  command?: Partial<ResearchScriptCommand>;
  createdAt?: Date | number | string;
  id?: string;
  sandboxPolicy?: Partial<ResearchScriptJobSandboxPolicy>;
  scriptFileName?: string;
  title?: string;
}

const DEFAULT_STOP_REASONS = ['captcha', 'login', 'paywall', '403', '429', 'private_data'];

export function buildResearchScriptJobArtifact(
  input: BuildResearchScriptJobArtifactInput,
): ResearchScriptJobArtifact {
  const goal = normalizeRequired(input.goal, 'goal');
  const title = normalizeText(input.title) || 'Research script job';
  const createdAt = normalizeCreatedAt(input.createdAt);
  const id = normalizeText(input.id) || buildResearchScriptJobId(goal, title, input.language, createdAt);
  const artifactRoot = normalizeRelativePath(input.artifactRoot) || `research-scripts/${id}`;
  const scriptFileName = normalizeFileName(input.scriptFileName) || `script.${extensionForLanguage(input.language)}`;
  const files = buildFiles(artifactRoot, scriptFileName);
  const command = buildCommand(input.language, files, input.command);
  const sandboxPolicy = buildSandboxPolicy(input.sandboxPolicy);
  const assertions = normalizeAssertions(input.assertions);

  return {
    schemaVersion: RESEARCH_SCRIPT_JOB_SCHEMA_VERSION,
    id,
    artifactRoot,
    command,
    createdAt,
    files,
    goal,
    inputContract: compactStringRecord(input.inputContract),
    language: input.language,
    outputContract: compactStringRecord(input.outputContract),
    sandboxPolicy,
    assertions,
    title,
    agentRunArtifact: {
      kind: 'script',
      path: files.manifest,
      title,
    },
  };
}

export function renderResearchScriptJobManifest(job: ResearchScriptJobArtifact): string {
  return JSON.stringify(job, null, 2);
}

export function renderResearchScriptJobReadme(job: ResearchScriptJobArtifact): string {
  const lines = [
    `# ${job.title}`,
    '',
    `Goal: ${job.goal}`,
    `Language: ${job.language}`,
    `Sandbox: ${job.sandboxPolicy.provider}`,
    ...(job.sandboxPolicy.target ? [`Target: ${job.sandboxPolicy.target}`] : []),
    `Network: ${job.sandboxPolicy.network}`,
    `Writes: ${job.sandboxPolicy.writes}`,
    `Timeout: ${job.sandboxPolicy.timeoutMs}ms`,
    '',
    '## Files',
    `- Manifest: ${job.files.manifest}`,
    `- Script: ${job.files.script}`,
    `- Input: ${job.files.input}`,
    `- Output: ${job.files.output}`,
    `- Stdout: ${job.files.stdout}`,
    `- Stderr: ${job.files.stderr}`,
    `- Summary: ${job.files.summary}`,
    '',
    '## Command',
    `- ${[job.command.executable, ...job.command.args].join(' ')}`,
    '',
    '## Assertions',
    ...job.assertions.map((assertion) => `- [${assertion.required ? 'required' : 'optional'}] ${assertion.description}`),
  ];

  return lines.join('\n');
}

function buildFiles(root: string, scriptFileName: string): ResearchScriptJobFiles {
  return {
    manifest: `${root}/manifest.json`,
    readme: `${root}/README.md`,
    script: `${root}/${scriptFileName}`,
    input: `${root}/input.json`,
    output: `${root}/output.json`,
    stdout: `${root}/stdout.log`,
    stderr: `${root}/stderr.log`,
    summary: `${root}/summary.md`,
  };
}

function buildCommand(
  language: ResearchScriptLanguage,
  files: ResearchScriptJobFiles,
  command: Partial<ResearchScriptCommand> | undefined,
): ResearchScriptCommand {
  const executable = normalizeText(command?.executable) || defaultExecutable(language);
  const args = normalizeStringArray(command?.args);
  return {
    executable,
    args: args.length > 0 ? args : [files.script],
    cwd: normalizeText(command?.cwd) || '.',
    env: compactStringRecord(command?.env ?? {
      INPUT_JSON: files.input,
      OUTPUT_JSON: files.output,
    }),
  };
}

function buildSandboxPolicy(policy: Partial<ResearchScriptJobSandboxPolicy> | undefined): ResearchScriptJobSandboxPolicy {
  return {
    provider: policy?.provider ?? 'local',
    network: policy?.network ?? 'https_only_public_web',
    writes: policy?.writes ?? 'artifact_dir_only',
    timeoutMs: normalizeBoundedInteger(policy?.timeoutMs, 120000, 1000, 3_600_000),
    pageBudget: normalizeBoundedInteger(policy?.pageBudget, 10, 0, 1000),
    delayMs: normalizeBoundedInteger(policy?.delayMs, 1000, 0, 60_000),
    allowedDomains: normalizeStringArray(policy?.allowedDomains),
    ignoredDomains: normalizeStringArray(policy?.ignoredDomains),
    stopOn: normalizeStringArray(policy?.stopOn).length > 0
      ? normalizeStringArray(policy?.stopOn)
      : DEFAULT_STOP_REASONS,
    target: normalizeText(policy?.target) || null,
    cleanup: policy?.cleanup ?? 'keep_all_artifacts',
  };
}

function normalizeAssertions(assertions: ResearchScriptJobAssertion[] | undefined): ResearchScriptJobAssertion[] {
  const normalized = Array.isArray(assertions)
    ? assertions
      .map((assertion) => ({
        id: normalizeText(assertion.id) || 'assertion',
        kind: assertion.kind,
        description: normalizeText(assertion.description) || assertion.id,
        required: assertion.required,
      }))
      .filter((assertion) => assertion.description.trim().length > 0)
    : [];

  if (normalized.length > 0) {
    return normalized;
  }

  return [
    {
      id: 'output-json-written',
      kind: 'file_exists',
      description: 'The script writes the declared output JSON artifact.',
      required: true,
    },
    {
      id: 'evidence-preserved',
      kind: 'evidence',
      description: 'Every extracted value keeps a source URL or evidence snippet.',
      required: true,
    },
    {
      id: 'no-contact-action',
      kind: 'no_contact_action',
      description: 'The script does not send email, submit forms, or contact leads.',
      required: true,
    },
  ];
}

function buildResearchScriptJobId(goal: string, title: string, language: ResearchScriptLanguage, createdAt: string): string {
  return `research-script-${stableHash([goal, title, language, createdAt].join('|'))}`;
}

function defaultExecutable(language: ResearchScriptLanguage): string {
  switch (language) {
    case 'javascript':
      return 'node';
    case 'python':
      return 'python';
    case 'shell':
      return 'sh';
    case 'typescript':
      return 'tsx';
  }
}

function extensionForLanguage(language: ResearchScriptLanguage): string {
  switch (language) {
    case 'javascript':
      return 'js';
    case 'python':
      return 'py';
    case 'shell':
      return 'sh';
    case 'typescript':
      return 'ts';
  }
}

function normalizeCreatedAt(value: Date | number | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) return value.trim();
  return new Date().toISOString();
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeRelativePath(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.(\/|$)/g, '')
    .replace(/\/+/g, '/');
}

function normalizeFileName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') ?? '';
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function compactStringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, child]) => [normalizeText(key), normalizeText(child)] as const)
      .filter(([key, child]) => key.length > 0 && child.length > 0),
  );
}

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}
