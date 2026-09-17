export type ProvisionTarget = 'supabase' | 'local';

export type ProvisionMode = 'dry-run' | 'apply';

export type ProvisionErrorCode =
  | 'INVALID_NAME'
  | 'MISSING_TOKEN'
  | 'MISSING_CLI'
  | 'MIGRATION_APPLIED'
  | 'UNSAFE_DIR'
  | 'INVALID_TARGET';

export class ProvisionError extends Error {
  readonly code: ProvisionErrorCode;

  constructor(code: ProvisionErrorCode, message: string) {
    super(message);
    this.name = 'ProvisionError';
    this.code = code;
  }
}

export interface PlannedFile {
  /** POSIX-relative path from the project root. */
  path: string;
  action: 'create' | 'update';
  /** Omitted for secret files so callers/logs never see values. */
  content?: string;
  secret?: boolean;
  executable?: boolean;
}

export interface PlannedMigration {
  version: string;
  path: string;
  status: 'pending' | 'already-applied';
}

export interface ProvisionPlan {
  mode: ProvisionMode;
  target: ProvisionTarget;
  projectName: string;
  projectDir: string;
  files: PlannedFile[];
  migrations: PlannedMigration[];
  warnings: string[];
  nextSteps: string[];
  written: boolean;
}

export interface ProvisionDeps {
  commandExists: (command: string) => Promise<boolean>;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  randomBytes: (size: number) => Buffer;
}

export interface ProvisionOptions {
  target: ProvisionTarget;
  projectDir: string;
  projectName: string;
  /** Default false: simulation. Tests use this default. */
  apply?: boolean;
  supabaseCli?: string;
  tokenEnvVar?: string;
  deps?: Partial<ProvisionDeps>;
}
