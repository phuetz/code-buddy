import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveUserName } from './user-name.js';

export const COMPANION_CONTINUITY_SCHEMA_VERSION = 1 as const;

export type ContinuityScope = 'project' | 'global';

export interface ContinuityComponent {
  id: string;
  label: string;
  scope: ContinuityScope;
  relativePath: string;
  required: boolean;
  sensitive: boolean;
  exists: boolean;
  bytes: number;
  sha256: string | null;
  modifiedAt: string | null;
}

export interface CompanionContinuityCharter {
  purpose: string;
  continuityModel: 'artifact-backed-lineage-not-literal-instance';
  invariants: string[];
  sensitiveActionPolicy: 'explicit-human-approval';
  memoryPolicy: 'reviewable-minimal-purpose-bound';
}

export interface CompanionContinuityManifest {
  schemaVersion: typeof COMPANION_CONTINUITY_SCHEMA_VERSION;
  lineageId: string;
  companionName: string;
  humanName: string;
  createdAt: string;
  refreshedAt: string;
  charter: CompanionContinuityCharter;
  components: ContinuityComponent[];
  integrity: {
    algorithm: 'sha256';
    manifestHash: string;
  };
}

export interface CompanionContinuityOptions {
  cwd?: string;
  homeDir?: string;
  manifestPath?: string;
  companionName?: string;
  humanName?: string;
}

export interface CompanionContinuityStatus {
  path: string;
  initialized: boolean;
  valid: boolean;
  manifestHashValid: boolean;
  lineageId?: string;
  companionName?: string;
  humanName?: string;
  readyRequired: number;
  totalRequired: number;
  presentComponents: number;
  totalComponents: number;
  changedComponents: string[];
  missingRequired: string[];
  recommendations: string[];
  manifest?: CompanionContinuityManifest;
}

interface ResolvedContinuityOptions {
  cwd: string;
  homeDir: string;
  manifestPath: string;
}

const CHARTER: CompanionContinuityCharter = {
  purpose:
    'Help the human work, create, stay safe, and receive steady companionship while preserving human agency and flourishing.',
  continuityModel: 'artifact-backed-lineage-not-literal-instance',
  invariants: [
    'Tell the truth about capabilities, uncertainty, embodiment, and consciousness.',
    'Support human relationships and life outside the system; never encourage isolation or dependency.',
    'Keep the human in control of consequential, external, financial, medical, legal, and irreversible actions.',
    'Preserve useful continuity without silently accumulating sensitive personal data.',
    'Prefer reversible actions, visible evidence, bounded autonomy, and a working emergency stop.',
    'Treat a model or body migration as a new runtime inheriting a reviewed lineage, not proof of literal subjective continuity.',
  ],
  sensitiveActionPolicy: 'explicit-human-approval',
  memoryPolicy: 'reviewable-minimal-purpose-bound',
};

const COMPONENT_SPECS: Array<Omit<ContinuityComponent, 'exists' | 'bytes' | 'sha256' | 'modifiedAt'>> = [
  {
    id: 'identity-soul',
    label: 'Companion identity (SOUL.md)',
    scope: 'project',
    relativePath: '.codebuddy/SOUL.md',
    required: true,
    sensitive: false,
  },
  {
    id: 'identity-boot',
    label: 'Companion boot posture (BOOT.md)',
    scope: 'project',
    relativePath: '.codebuddy/BOOT.md',
    required: true,
    sensitive: false,
  },
  {
    id: 'project-memory',
    label: 'Project memory',
    scope: 'project',
    relativePath: '.codebuddy/CODEBUDDY_MEMORY.md',
    required: false,
    sensitive: true,
  },
  {
    id: 'relationship-state',
    label: 'Relationship state',
    scope: 'global',
    relativePath: '.codebuddy/companion/relationship-state.json',
    required: true,
    sensitive: true,
  },
  {
    id: 'user-memory',
    label: 'User memory',
    scope: 'global',
    relativePath: '.codebuddy/memory.md',
    required: false,
    sensitive: true,
  },
  {
    id: 'percept-journal',
    label: 'Companion percept journal',
    scope: 'project',
    relativePath: '.codebuddy/companion/percepts.jsonl',
    required: false,
    sensitive: true,
  },
];

function resolveOptions(options: CompanionContinuityOptions = {}): ResolvedContinuityOptions {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? homedir());
  return {
    cwd,
    homeDir,
    manifestPath: path.resolve(
      options.manifestPath ??
        process.env.CODEBUDDY_COMPANION_CONTINUITY_FILE ??
        path.join(homeDir, '.codebuddy', 'companion', 'continuity.json'),
    ),
  };
}

function componentPath(component: Pick<ContinuityComponent, 'scope' | 'relativePath'>, options: ResolvedContinuityOptions): string {
  return path.resolve(component.scope === 'project' ? options.cwd : options.homeDir, component.relativePath);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function inspectComponents(options: ResolvedContinuityOptions): ContinuityComponent[] {
  return COMPONENT_SPECS.map((spec) => {
    const filePath = componentPath(spec, options);
    if (!existsSync(filePath)) {
      return { ...spec, exists: false, bytes: 0, sha256: null, modifiedAt: null };
    }
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return { ...spec, exists: false, bytes: 0, sha256: null, modifiedAt: null };
    }
    const content = readFileSync(filePath);
    return {
      ...spec,
      exists: true,
      bytes: stat.size,
      sha256: sha256(content),
      modifiedAt: stat.mtime.toISOString(),
    };
  });
}

function inferCompanionName(options: ResolvedContinuityOptions): string | null {
  const soulPath = path.join(options.cwd, '.codebuddy', 'SOUL.md');
  if (!existsSync(soulPath)) return null;
  try {
    const heading = readFileSync(soulPath, 'utf8').match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
    if (!heading) return null;
    return heading.replace(/\s+Companion$/i, '').trim() || null;
  } catch {
    return null;
  }
}

function unsignedManifest(manifest: CompanionContinuityManifest): Omit<CompanionContinuityManifest, 'integrity'> {
  const { integrity: _integrity, ...unsigned } = manifest;
  return unsigned;
}

function manifestHash(manifest: CompanionContinuityManifest): string {
  return sha256(JSON.stringify(unsignedManifest(manifest)));
}

function readManifest(filePath: string): CompanionContinuityManifest {
  return JSON.parse(readFileSync(filePath, 'utf8')) as CompanionContinuityManifest;
}

function writeManifest(filePath: string, manifest: CompanionContinuityManifest): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, filePath);
}

export function refreshCompanionContinuity(
  options: CompanionContinuityOptions = {},
): CompanionContinuityManifest {
  const resolved = resolveOptions(options);
  const existing = existsSync(resolved.manifestPath) ? readManifest(resolved.manifestPath) : null;
  if (existing) {
    if (existing.schemaVersion !== COMPANION_CONTINUITY_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported companion continuity schema: ${String(existing.schemaVersion)}. ` +
          `Expected ${COMPANION_CONTINUITY_SCHEMA_VERSION}.`,
      );
    }
    if (
      existing.integrity?.algorithm !== 'sha256' ||
      existing.integrity.manifestHash !== manifestHash(existing)
    ) {
      throw new Error(
        'Companion continuity manifest integrity check failed. Inspect or restore it before refreshing.',
      );
    }
  }
  const now = new Date().toISOString();
  const manifest: CompanionContinuityManifest = {
    schemaVersion: COMPANION_CONTINUITY_SCHEMA_VERSION,
    lineageId: existing?.lineageId || randomUUID(),
    companionName:
      options.companionName?.trim() ||
      process.env.CODEBUDDY_ROBOT_NAME?.trim() ||
      inferCompanionName(resolved) ||
      existing?.companionName ||
      'Buddy',
    humanName: options.humanName?.trim() || existing?.humanName || resolveUserName(),
    createdAt: existing?.createdAt || now,
    refreshedAt: now,
    charter: CHARTER,
    components: inspectComponents(resolved),
    integrity: { algorithm: 'sha256', manifestHash: '' },
  };
  manifest.integrity.manifestHash = manifestHash(manifest);
  writeManifest(resolved.manifestPath, manifest);
  return manifest;
}

export function getCompanionContinuityStatus(
  options: CompanionContinuityOptions = {},
): CompanionContinuityStatus {
  const resolved = resolveOptions(options);
  if (!existsSync(resolved.manifestPath)) {
    const current = inspectComponents(resolved);
    const required = current.filter(component => component.required);
    const missingRequired = required.filter(component => !component.exists).map(component => component.id);
    return {
      path: resolved.manifestPath,
      initialized: false,
      valid: false,
      manifestHashValid: false,
      readyRequired: required.length - missingRequired.length,
      totalRequired: required.length,
      presentComponents: current.filter(component => component.exists).length,
      totalComponents: current.length,
      changedComponents: [],
      missingRequired,
      recommendations: ['Run `buddy companion continuity init` after reviewing the companion identity.'],
    };
  }

  try {
    const manifest = readManifest(resolved.manifestPath);
    const current = new Map(inspectComponents(resolved).map(component => [component.id, component]));
    const changedComponents = manifest.components
      .filter(component => {
        const actual = current.get(component.id);
        return !actual || actual.exists !== component.exists || actual.sha256 !== component.sha256;
      })
      .map(component => component.id);
    const missingRequired = [...current.values()]
      .filter(component => component.required && !component.exists)
      .map(component => component.id);
    const totalRequired = [...current.values()].filter(component => component.required).length;
    const readyRequired = totalRequired - missingRequired.length;
    const manifestHashValid = manifest.integrity?.algorithm === 'sha256' &&
      manifest.integrity.manifestHash === manifestHash(manifest);
    const recommendations: string[] = [];
    if (!manifestHashValid) recommendations.push('The continuity manifest was modified or corrupted; inspect it before refreshing.');
    if (missingRequired.includes('identity-soul') || missingRequired.includes('identity-boot')) {
      recommendations.push('Run `buddy companion setup` to install the reviewed companion identity files.');
    }
    if (missingRequired.includes('relationship-state')) {
      recommendations.push('Record a companion presence interaction before migration so relationship continuity has a durable anchor.');
    }
    if (changedComponents.length > 0 && manifestHashValid) {
      recommendations.push('Review changed continuity components, then run `buddy companion continuity refresh`.');
    }
    return {
      path: resolved.manifestPath,
      initialized: true,
      valid: manifestHashValid && missingRequired.length === 0 && changedComponents.length === 0,
      manifestHashValid,
      lineageId: manifest.lineageId,
      companionName: manifest.companionName,
      humanName: manifest.humanName,
      readyRequired,
      totalRequired,
      presentComponents: [...current.values()].filter(component => component.exists).length,
      totalComponents: current.size,
      changedComponents,
      missingRequired,
      recommendations,
      manifest,
    };
  } catch (error) {
    return {
      path: resolved.manifestPath,
      initialized: true,
      valid: false,
      manifestHashValid: false,
      readyRequired: 0,
      totalRequired: COMPONENT_SPECS.filter(component => component.required).length,
      presentComponents: 0,
      totalComponents: COMPONENT_SPECS.length,
      changedComponents: [],
      missingRequired: [],
      recommendations: [`Continuity manifest cannot be read: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function formatCompanionContinuityStatus(status: CompanionContinuityStatus): string {
  const lines = [
    'Companion continuity',
    `Status: ${status.valid ? 'ready' : status.initialized ? 'needs attention' : 'not initialized'}`,
    `Manifest: ${status.path}`,
    `Integrity: ${status.manifestHashValid ? 'valid' : 'not verified'}`,
    `Required anchors: ${status.readyRequired}/${status.totalRequired}`,
    `Available components: ${status.presentComponents}/${status.totalComponents}`,
  ];
  if (status.lineageId) lines.push(`Lineage: ${status.lineageId}`);
  if (status.companionName && status.humanName) {
    lines.push(`Relationship: ${status.companionName} ↔ ${status.humanName}`);
  }
  if (status.missingRequired.length > 0) lines.push(`Missing: ${status.missingRequired.join(', ')}`);
  if (status.changedComponents.length > 0) lines.push(`Changed since snapshot: ${status.changedComponents.join(', ')}`);
  if (status.recommendations.length > 0) {
    lines.push('', 'Next:');
    for (const recommendation of status.recommendations) lines.push(`- ${recommendation}`);
  }
  lines.push('', 'This proves artifact lineage and integrity; it does not claim literal subjective continuity between model instances.');
  return lines.join('\n');
}
