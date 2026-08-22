import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';

export interface ImportConfigOptions {
  dryRun?: boolean;
  from?: string;
}

export interface ImportConfigDependencies {
  cwd?: string;
  stdout?: (message: string) => void;
}

export type RuleImportStatus = 'imported' | 'already-imported';
export type MCPImportStatus = 'imported' | 'existing' | 'duplicate';

export interface RuleImportItem {
  provider: string;
  source: string;
  status: RuleImportStatus;
}

export interface MCPImportItem {
  name: string;
  source: string;
  status: MCPImportStatus;
}

export interface ConfigImportResult {
  dryRun: boolean;
  filesWritten: string[];
  mcpServers: MCPImportItem[];
  mcpServersImported: number;
  ruleSources: RuleImportItem[];
  ruleSourcesImported: number;
  sourceRoot: string;
  warnings: string[];
}

interface SafePathEntry {
  kind: 'directory' | 'file';
  realPath: string;
}

interface DiscoveredRuleSource {
  content: string;
  heading: string;
  marker: string;
  provider: string;
  source: string;
}

interface DiscoveredMCPServer {
  config: Record<string, unknown>;
  name: string;
  source: string;
}

interface DestinationMCPConfig {
  config: Record<string, unknown>;
  existingNames: Set<string>;
  serverKey: 'mcpServers' | 'servers';
  servers: Record<string, unknown>;
}

const MCP_SOURCE_PATHS = [
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  'claude_desktop_config.json',
  '.mcp.json',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function toProjectPath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function importMarker(source: string): string {
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 24);
  return `<!-- codebuddy-import:${digest} -->`;
}

function hasImportedSource(existing: string, source: DiscoveredRuleSource): boolean {
  if (existing.includes(source.marker)) return true;
  return existing.split(/\r?\n/).some((line) => line.trimEnd() === source.heading);
}

function ruleBlock(source: DiscoveredRuleSource): string {
  return [source.marker, source.heading, '', source.content.trimEnd()].join('\n');
}

function appendRuleBlocks(existing: string, sources: readonly DiscoveredRuleSource[]): string {
  if (sources.length === 0) return existing;
  const blocks = sources.map(ruleBlock).join('\n\n');
  if (existing.length === 0) return `${blocks}\n`;
  if (existing.endsWith('\n\n')) return `${existing}${blocks}\n`;
  if (existing.endsWith('\n')) return `${existing}\n${blocks}\n`;
  return `${existing}\n\n${blocks}\n`;
}

async function inspectSourcePath(
  candidatePath: string,
  projectRealRoot: string,
  displayPath: string,
  warnings: string[]
): Promise<SafePathEntry | undefined> {
  try {
    await fs.lstat(candidatePath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    warnings.push(
      `Impossible d'inspecter ${displayPath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }

  try {
    const realPath = await fs.realpath(candidatePath);
    if (!isPathInside(projectRealRoot, realPath)) {
      warnings.push(`Source ignorée hors projet: ${displayPath}`);
      return undefined;
    }
    const stat = await fs.stat(realPath);
    if (stat.isFile()) return { kind: 'file', realPath };
    if (stat.isDirectory()) return { kind: 'directory', realPath };
    warnings.push(`Source ignorée (ni fichier ni dossier): ${displayPath}`);
  } catch (error) {
    warnings.push(
      `Impossible de lire ${displayPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return undefined;
}

async function readSafeTextFile(
  projectRoot: string,
  projectRealRoot: string,
  candidatePath: string,
  warnings: string[]
): Promise<string | undefined> {
  const displayPath = toProjectPath(projectRoot, candidatePath);
  const entry = await inspectSourcePath(candidatePath, projectRealRoot, displayPath, warnings);
  if (!entry || entry.kind !== 'file') return undefined;
  try {
    const content = await fs.readFile(entry.realPath, 'utf8');
    if (content.includes('\0')) {
      warnings.push(`Source binaire ignorée: ${displayPath}`);
      return undefined;
    }
    return content;
  } catch (error) {
    warnings.push(
      `Impossible de lire ${displayPath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

async function discoverRuleFile(
  provider: string,
  candidatePath: string,
  projectRoot: string,
  projectRealRoot: string,
  warnings: string[]
): Promise<DiscoveredRuleSource | undefined> {
  const content = await readSafeTextFile(projectRoot, projectRealRoot, candidatePath, warnings);
  if (content === undefined) return undefined;
  const source = toProjectPath(projectRoot, candidatePath);
  if (content.trim().length === 0) {
    warnings.push(`Source de règles vide ignorée: ${source}`);
    return undefined;
  }
  return {
    content,
    heading: `# Importé de ${provider} (${source})`,
    marker: importMarker(source),
    provider,
    source,
  };
}

async function listSafeDirectory(
  directoryPath: string,
  projectRoot: string,
  projectRealRoot: string,
  warnings: string[]
): Promise<Dirent<string>[] | undefined> {
  const displayPath = toProjectPath(projectRoot, directoryPath);
  const entry = await inspectSourcePath(directoryPath, projectRealRoot, displayPath, warnings);
  if (!entry || entry.kind !== 'directory') return undefined;
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    warnings.push(
      `Impossible de parcourir ${displayPath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

async function discoverCursorRuleFiles(
  sourceRoot: string,
  projectRoot: string,
  projectRealRoot: string,
  warnings: string[]
): Promise<DiscoveredRuleSource[]> {
  const rulesDirectory = path.join(sourceRoot, '.cursor', 'rules');
  const entries = await listSafeDirectory(rulesDirectory, projectRoot, projectRealRoot, warnings);
  if (!entries) return [];

  const sources: DiscoveredRuleSource[] = [];
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.name.endsWith('.mdc')) continue;
    const source = await discoverRuleFile(
      'Cursor',
      path.join(rulesDirectory, entry.name),
      projectRoot,
      projectRealRoot,
      warnings
    );
    if (source) sources.push(source);
  }
  return sources;
}

async function discoverClineDirectoryFiles(
  directoryPath: string,
  projectRoot: string,
  projectRealRoot: string,
  warnings: string[]
): Promise<DiscoveredRuleSource[]> {
  const entries = await listSafeDirectory(directoryPath, projectRoot, projectRealRoot, warnings);
  if (!entries) return [];

  const sources: DiscoveredRuleSource[] = [];
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const candidatePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      sources.push(
        ...(await discoverClineDirectoryFiles(
          candidatePath,
          projectRoot,
          projectRealRoot,
          warnings
        ))
      );
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const source = await discoverRuleFile(
      'Cline',
      candidatePath,
      projectRoot,
      projectRealRoot,
      warnings
    );
    if (source) sources.push(source);
  }
  return sources;
}

async function discoverClineRules(
  sourceRoot: string,
  projectRoot: string,
  projectRealRoot: string,
  warnings: string[]
): Promise<DiscoveredRuleSource[]> {
  const clinePath = path.join(sourceRoot, '.clinerules');
  const displayPath = toProjectPath(projectRoot, clinePath);
  const entry = await inspectSourcePath(clinePath, projectRealRoot, displayPath, warnings);
  if (!entry) return [];
  if (entry.kind === 'directory') {
    return discoverClineDirectoryFiles(clinePath, projectRoot, projectRealRoot, warnings);
  }
  const source = await discoverRuleFile('Cline', clinePath, projectRoot, projectRealRoot, warnings);
  return source ? [source] : [];
}

async function discoverRuleSources(
  sourceRoot: string,
  projectRoot: string,
  projectRealRoot: string,
  warnings: string[]
): Promise<DiscoveredRuleSource[]> {
  const sources = await discoverCursorRuleFiles(sourceRoot, projectRoot, projectRealRoot, warnings);

  const fixedSources: Array<[provider: string, relativePath: string]> = [
    ['Cursor', '.cursorrules'],
  ];
  for (const [provider, relativePath] of fixedSources) {
    const source = await discoverRuleFile(
      provider,
      path.join(sourceRoot, relativePath),
      projectRoot,
      projectRealRoot,
      warnings
    );
    if (source) sources.push(source);
  }

  sources.push(...(await discoverClineRules(sourceRoot, projectRoot, projectRealRoot, warnings)));

  const remainingSources: Array<[provider: string, relativePath: string]> = [
    ['GitHub Copilot', '.github/copilot-instructions.md'],
    ['Claude Code', 'CLAUDE.md'],
  ];
  for (const [provider, relativePath] of remainingSources) {
    const source = await discoverRuleFile(
      provider,
      path.join(sourceRoot, relativePath),
      projectRoot,
      projectRealRoot,
      warnings
    );
    if (source) sources.push(source);
  }
  return sources;
}

function parseJsonObject(content: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `JSON invalide dans ${source}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isRecord(parsed))
    throw new Error(`Configuration JSON invalide dans ${source}: objet attendu.`);
  return parsed;
}

async function discoverMCPServers(
  sourceRoot: string,
  projectRoot: string,
  projectRealRoot: string,
  warnings: string[]
): Promise<DiscoveredMCPServer[]> {
  const discovered: DiscoveredMCPServer[] = [];
  for (const relativePath of MCP_SOURCE_PATHS) {
    const candidatePath = path.join(sourceRoot, relativePath);
    const content = await readSafeTextFile(projectRoot, projectRealRoot, candidatePath, warnings);
    if (content === undefined) continue;
    const source = toProjectPath(projectRoot, candidatePath);

    let parsed: Record<string, unknown>;
    try {
      parsed = parseJsonObject(content, source);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    let foundServerMap = false;
    for (const key of ['mcpServers', 'servers'] as const) {
      const value = parsed[key];
      if (value === undefined) continue;
      if (!isRecord(value)) {
        warnings.push(`Section ${key} invalide ignorée dans ${source}: objet attendu.`);
        continue;
      }
      foundServerMap = true;
      for (const [name, config] of Object.entries(value)) {
        if (!isRecord(config)) {
          warnings.push(`Serveur MCP invalide ignoré dans ${source}: ${name}`);
          continue;
        }
        discovered.push({ config, name, source });
      }
    }
    if (!foundServerMap) warnings.push(`Aucune section mcpServers/servers dans ${source}.`);
  }
  return discovered;
}

async function readDestinationText(
  destinationPath: string,
  projectRealRoot: string
): Promise<string | undefined> {
  let lstat;
  try {
    lstat = await fs.lstat(destinationPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
  if (lstat.isSymbolicLink()) {
    throw new Error(`Destination symbolique refusée: ${destinationPath}`);
  }
  if (!lstat.isFile())
    throw new Error(`Destination invalide (fichier attendu): ${destinationPath}`);
  const realPath = await fs.realpath(destinationPath);
  if (!isPathInside(projectRealRoot, realPath)) {
    throw new Error(`Destination hors projet refusée: ${destinationPath}`);
  }
  return fs.readFile(realPath, 'utf8');
}

function destinationMCPConfig(content: string | undefined, source: string): DestinationMCPConfig {
  const config = content === undefined ? {} : parseJsonObject(content, source);
  const mcpServersValue = config.mcpServers;
  const serversValue = config.servers;
  if (mcpServersValue !== undefined && !isRecord(mcpServersValue)) {
    throw new Error(
      `Configuration existante invalide dans ${source}: mcpServers doit être un objet.`
    );
  }
  if (serversValue !== undefined && !isRecord(serversValue)) {
    throw new Error(`Configuration existante invalide dans ${source}: servers doit être un objet.`);
  }

  const mcpServers = isRecord(mcpServersValue) ? mcpServersValue : undefined;
  const servers = isRecord(serversValue) ? serversValue : undefined;
  const existingNames = new Set([...Object.keys(mcpServers ?? {}), ...Object.keys(servers ?? {})]);
  if (mcpServers) return { config, existingNames, serverKey: 'mcpServers', servers: mcpServers };
  if (servers) return { config, existingNames, serverKey: 'servers', servers };
  return { config, existingNames, serverKey: 'mcpServers', servers: {} };
}

async function assertSafeDestination(
  destinationPath: string,
  projectRoot: string,
  projectRealRoot: string
): Promise<void> {
  if (!isPathInside(projectRoot, path.resolve(destinationPath))) {
    throw new Error(`Destination hors projet refusée: ${destinationPath}`);
  }

  let existingPath = destinationPath;
  while (true) {
    try {
      const stat = await fs.lstat(existingPath);
      if (existingPath === destinationPath && stat.isSymbolicLink()) {
        throw new Error(`Destination symbolique refusée: ${destinationPath}`);
      }
      break;
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error;
      const parent = path.dirname(existingPath);
      if (parent === existingPath) throw new Error(`Aucun parent existant pour ${destinationPath}`);
      existingPath = parent;
    }
  }

  const realExistingPath = await fs.realpath(existingPath);
  if (!isPathInside(projectRealRoot, realExistingPath)) {
    throw new Error(`Destination hors projet refusée: ${destinationPath}`);
  }
}

async function atomicWrite(
  destinationPath: string,
  content: string,
  projectRoot: string,
  projectRealRoot: string,
  defaultMode: number
): Promise<void> {
  await assertSafeDestination(destinationPath, projectRoot, projectRealRoot);
  const directory = path.dirname(destinationPath);
  await fs.mkdir(directory, { recursive: true });
  await assertSafeDestination(directory, projectRoot, projectRealRoot);
  const mode = await fs
    .stat(destinationPath)
    .then((stat) => stat.mode & 0o777)
    .catch((error: unknown) => {
      if (isErrno(error, 'ENOENT')) return defaultMode;
      throw error;
    });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(destinationPath)}.import-${process.pid}-${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode });
    await fs.rename(temporaryPath, destinationPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function resolveRoots(
  cwd: string,
  from: string | undefined
): Promise<{ projectRealRoot: string; projectRoot: string; sourceRoot: string }> {
  const projectRoot = path.resolve(cwd);
  const projectStat = await fs.stat(projectRoot);
  if (!projectStat.isDirectory()) throw new Error(`Projet invalide: ${projectRoot}`);
  const projectRealRoot = await fs.realpath(projectRoot);
  const sourceRoot = path.resolve(projectRoot, from ?? '.');
  if (!isPathInside(projectRoot, sourceRoot)) {
    throw new Error(`--from doit rester dans le projet courant: ${from}`);
  }
  const sourceRealRoot = await fs.realpath(sourceRoot).catch((error: unknown) => {
    throw new Error(
      `Dossier source introuvable: ${sourceRoot} (${error instanceof Error ? error.message : String(error)})`
    );
  });
  if (!isPathInside(projectRealRoot, sourceRealRoot)) {
    throw new Error(`--from pointe hors du projet courant: ${from}`);
  }
  const sourceStat = await fs.stat(sourceRealRoot);
  if (!sourceStat.isDirectory()) throw new Error(`--from doit désigner un dossier: ${from}`);
  return { projectRealRoot, projectRoot, sourceRoot };
}

export async function importProjectConfiguration(
  options: ImportConfigOptions = {},
  dependencies: ImportConfigDependencies = {}
): Promise<ConfigImportResult> {
  const dryRun = options.dryRun === true;
  const roots = await resolveRoots(dependencies.cwd ?? process.cwd(), options.from);
  const warnings: string[] = [];
  const codeBuddyPath = path.join(roots.projectRoot, 'CODEBUDDY.md');
  const mcpPath = path.join(roots.projectRoot, '.codebuddy', 'mcp.json');

  const [discoveredRules, discoveredMCP, existingRules, existingMCPText] = await Promise.all([
    discoverRuleSources(roots.sourceRoot, roots.projectRoot, roots.projectRealRoot, warnings),
    discoverMCPServers(roots.sourceRoot, roots.projectRoot, roots.projectRealRoot, warnings),
    readDestinationText(codeBuddyPath, roots.projectRealRoot).then((content) => content ?? ''),
    readDestinationText(mcpPath, roots.projectRealRoot),
  ]);

  const rulesToImport: DiscoveredRuleSource[] = [];
  const ruleSources: RuleImportItem[] = discoveredRules.map((source) => {
    if (hasImportedSource(existingRules, source)) {
      return { provider: source.provider, source: source.source, status: 'already-imported' };
    }
    rulesToImport.push(source);
    return { provider: source.provider, source: source.source, status: 'imported' };
  });

  const targetMCP = destinationMCPConfig(
    existingMCPText,
    toProjectPath(roots.projectRoot, mcpPath)
  );
  const claimedNames = new Set(targetMCP.existingNames);
  const mcpToImport: DiscoveredMCPServer[] = [];
  const mcpServers: MCPImportItem[] = discoveredMCP.map((server) => {
    if (targetMCP.existingNames.has(server.name)) {
      return { name: server.name, source: server.source, status: 'existing' };
    }
    if (claimedNames.has(server.name)) {
      return { name: server.name, source: server.source, status: 'duplicate' };
    }
    claimedNames.add(server.name);
    mcpToImport.push(server);
    return { name: server.name, source: server.source, status: 'imported' };
  });

  const filesWritten: string[] = [];
  if (rulesToImport.length > 0) {
    await assertSafeDestination(codeBuddyPath, roots.projectRoot, roots.projectRealRoot);
  }
  if (mcpToImport.length > 0) {
    await assertSafeDestination(mcpPath, roots.projectRoot, roots.projectRealRoot);
  }
  if (!dryRun && rulesToImport.length > 0) {
    await atomicWrite(
      codeBuddyPath,
      appendRuleBlocks(existingRules, rulesToImport),
      roots.projectRoot,
      roots.projectRealRoot,
      0o644
    );
    filesWritten.push('CODEBUDDY.md');
  }

  if (!dryRun && mcpToImport.length > 0) {
    const mergedServers = Object.fromEntries([
      ...Object.entries(targetMCP.servers),
      ...mcpToImport.map((server) => [server.name, server.config] as const),
    ]);
    const mergedConfig = { ...targetMCP.config, [targetMCP.serverKey]: mergedServers };
    await atomicWrite(
      mcpPath,
      `${JSON.stringify(mergedConfig, null, 2)}\n`,
      roots.projectRoot,
      roots.projectRealRoot,
      0o600
    );
    filesWritten.push('.codebuddy/mcp.json');
  }

  return {
    dryRun,
    filesWritten,
    mcpServers,
    mcpServersImported: mcpToImport.length,
    ruleSources,
    ruleSourcesImported: rulesToImport.length,
    sourceRoot: toProjectPath(roots.projectRoot, roots.sourceRoot) || '.',
    warnings,
  };
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatConfigImportResult(result: ConfigImportResult): string {
  const lines = [
    result.dryRun
      ? `Aperçu de l’import depuis ${result.sourceRoot} (aucun fichier écrit)`
      : `Import depuis ${result.sourceRoot}`,
  ];

  for (const item of result.ruleSources) {
    const status =
      item.status === 'already-imported'
        ? 'déjà importée'
        : result.dryRun
          ? 'à importer'
          : 'importée';
    lines.push(
      `  ${item.status === 'already-imported' ? '=' : '+'} Règles ${item.provider}: ${item.source} (${status})`
    );
  }
  for (const item of result.mcpServers) {
    const status =
      item.status === 'existing'
        ? 'nom déjà présent, conservé'
        : item.status === 'duplicate'
          ? 'doublon dans les sources, ignoré'
          : result.dryRun
            ? 'à importer'
            : 'importé';
    lines.push(
      `  ${item.status === 'imported' ? '+' : '='} MCP ${item.name}: ${item.source} (${status})`
    );
  }
  for (const warning of result.warnings) lines.push(`  ! ${warning}`);

  const summaryPrefix = result.dryRun ? 'À importer' : 'Importé';
  lines.push(
    `${summaryPrefix} : ${countLabel(result.ruleSourcesImported, 'source de règles', 'sources de règles')}, ` +
      `${countLabel(result.mcpServersImported, 'serveur MCP', 'serveurs MCP')}.`
  );
  return lines.join('\n');
}

export function createImportCommand(dependencies: ImportConfigDependencies = {}): Command {
  return new Command('import')
    .description('Importer les règles et serveurs MCP d’agents concurrents sans écraser l’existant')
    .option('--dry-run', 'Lister les imports sans écrire de fichier', false)
    .option('--from <chemin>', 'Dossier source situé dans le projet courant', '.')
    .action(async (options: ImportConfigOptions) => {
      const result = await importProjectConfiguration(options, dependencies);
      const write =
        dependencies.stdout ?? ((message: string) => process.stdout.write(`${message}\n`));
      write(formatConfigImportResult(result));
    });
}
