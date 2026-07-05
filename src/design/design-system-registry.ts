import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DesignSystemSummary {
  id: string;
  name: string;
  category: string;
  tagline: string;
}

export interface DesignSystemDetail extends DesignSystemSummary {
  design: string;
  tokensCss?: string;
  designTokens?: unknown;
}

interface CatalogFile {
  systems?: unknown;
}

let cachedAssetsDir: string | null = null;
let cachedCatalog: DesignSystemSummary[] | null = null;

export function resolveDesignAssetsDir(): string {
  if (cachedAssetsDir) return cachedAssetsDir;

  let currentDir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(currentDir, 'assets', 'design-systems');
    if (existsSync(join(candidate, 'catalog.json'))) {
      cachedAssetsDir = candidate;
      return candidate;
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  throw new Error('Unable to locate assets/design-systems/catalog.json from design-system-registry runtime path');
}

export function loadCatalog(): DesignSystemSummary[] {
  if (cachedCatalog) return cachedCatalog;

  const catalogPath = join(resolveDesignAssetsDir(), 'catalog.json');
  const parsed = JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogFile;
  if (!Array.isArray(parsed.systems)) {
    throw new Error(`Invalid design systems catalog: ${catalogPath}`);
  }

  cachedCatalog = parsed.systems.map(parseSummary);
  return cachedCatalog;
}

export function listDesignSystems(opts: { category?: string; query?: string } = {}): DesignSystemSummary[] {
  const category = opts.category?.trim().toLowerCase();
  const query = opts.query?.trim().toLowerCase();

  return loadCatalog().filter((system) => {
    if (category && system.category.toLowerCase() !== category) return false;
    if (!query) return true;

    return [system.id, system.name, system.category, system.tagline]
      .some((value) => value.toLowerCase().includes(query));
  });
}

export function getDesignSystem(id: string): DesignSystemDetail | null {
  const normalizedId = id.trim();
  const summary = loadCatalog().find((system) => system.id === normalizedId);
  if (!summary) return null;

  const systemDir = join(resolveDesignAssetsDir(), summary.id);
  const designPath = join(systemDir, 'DESIGN.md');
  const detail: DesignSystemDetail = {
    ...summary,
    design: readFileSync(designPath, 'utf8'),
  };

  const tokensCssPath = join(systemDir, 'tokens.css');
  if (existsSync(tokensCssPath)) {
    detail.tokensCss = readFileSync(tokensCssPath, 'utf8');
  }

  const designTokensPath = join(systemDir, 'design-tokens.json');
  if (existsSync(designTokensPath)) {
    detail.designTokens = JSON.parse(readFileSync(designTokensPath, 'utf8')) as unknown;
  }

  return detail;
}

export function buildDesignGuidance(id: string, opts: { maxChars?: number } = {}): string | null {
  const detail = getDesignSystem(id);
  if (!detail) return null;

  const maxChars = opts.maxChars ?? 6000;
  const header = `Applique fidèlement ce système de design — couleurs, typographie, géométrie, ombres, espacements.\n\n# ${detail.name} (${detail.id})\nCatégorie: ${detail.category}\n${detail.tagline}\n\n`;
  const budget = Math.max(0, maxChars - header.length);
  const design = truncateOnLineBoundary(detail.design, budget);

  return `${header}${design}`;
}

function parseSummary(value: unknown): DesignSystemSummary {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid design system summary entry in catalog');
  }

  const record = value as Record<string, unknown>;
  const id = readRequiredString(record, 'id');
  const name = readRequiredString(record, 'name');
  const category = readRequiredString(record, 'category');
  const tagline = readRequiredString(record, 'tagline');

  return { id, name, category, tagline };
}

function readRequiredString(record: Record<string, unknown>, key: keyof DesignSystemSummary): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid design systems catalog entry: missing ${key}`);
  }
  return value;
}

function truncateOnLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= '…[tronqué]'.length) return '…[tronqué]';

  const suffix = '\n…[tronqué]';
  const cutLimit = maxChars - suffix.length;
  const lineBoundary = text.lastIndexOf('\n', cutLimit);
  const cutAt = lineBoundary > 0 ? lineBoundary : cutLimit;
  return `${text.slice(0, cutAt).trimEnd()}${suffix}`;
}
