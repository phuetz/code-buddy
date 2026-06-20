/**
 * Skill importer — bring EXTERNAL skills (a Hermes repo, any skills directory)
 * into Code Buddy, safely. External skills are untrusted and get injected into the
 * agent's context, so the firewall gates every one (SKILL.md + its scripts) before
 * install. Hermes nests 1–3 levels but our registry walks 1 level → flatten; Hermes
 * tags live under `metadata.hermes.tags` but our discovery scores top-level `tags` +
 * `nativeEngine.triggers` → remap, else an imported skill is invisible to matching.
 *
 * Imported skills are namespaced `imported-*` (distinct provenance; never touched by
 * the self-improvement engine) and installed flat (1 level) under a tier root.
 *
 * @module skills/skill-importer
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import * as yaml from 'yaml';
import { scanSkillFirewall } from '../security/skill-scanner.js';
import { parseSkillFile, validateSkill } from './parser.js';
import { logger } from '../utils/logger.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const SUPPORT_DIRS = ['references', 'templates', 'scripts', 'assets', 'workflows', 'tests'];
const SKIP_DIRS = new Set(['.git', 'index-cache', '.archive', 'node_modules', '.sources-cache']);
export const IMPORTED_PREFIX = 'imported-';

export interface ImportOptions {
  /** Tier dir to install under. Default ~/.codebuddy/skills/managed. */
  destRoot?: string;
  /** Provenance label written to frontmatter (e.g. "hermes"). */
  source?: string;
  /** When true, scan + report but write nothing. */
  dryRun?: boolean;
  /** Import skills the firewall flags as 'review' (default: skip them). */
  includeReview?: boolean;
  /** Overwrite an existing imported-<name> (default: skip). */
  overwrite?: boolean;
  /** Only import skills whose source path contains this substring. */
  category?: string;
  /** Pin imported skills so curation leaves them alone (default true). */
  pinByDefault?: boolean;
}

export interface ImportedSkill {
  name: string;
  sourcePath: string;
  verdict: string;
}
export interface SkippedSkill {
  sourcePath: string;
  reason: string;
  verdict?: string;
}
export interface ImportReport {
  imported: ImportedSkill[];
  quarantined: SkippedSkill[];
  review: SkippedSkill[];
  skipped: SkippedSkill[];
  total: number;
  dryRun: boolean;
}

function defaultDestRoot(): string {
  return path.join(os.homedir(), '.codebuddy', 'skills', 'managed');
}

/** Recursively find skill directories (those containing a SKILL.md). Skips operational dirs. */
export function findSkillDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'skill.md')) {
      out.push(dir);
      // don't descend into a skill's own support dirs
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name));
    }
  };
  walk(root);
  return out;
}

function slugify(raw: string): string {
  const base = String(raw).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return base.startsWith(IMPORTED_PREFIX) ? base : `${IMPORTED_PREFIX}${base || 'skill'}`;
}

function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const s = String(t).trim().toLowerCase();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Derive discovery triggers (the primary matcher) from the name + tags. */
function deriveTriggers(rawName: string, tags: string[]): string[] {
  const nameWords = String(rawName).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [String(rawName).toLowerCase(), ...tags, ...nameWords]) {
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    if (out.length >= 10) break;
  }
  return out;
}

/** Build a Code-Buddy-shaped SKILL.md from a raw (e.g. Hermes) frontmatter object + body. */
export function remapSkill(
  rawFm: Record<string, unknown>,
  body: string,
  opts: { slug: string; source: string; pinned: boolean },
): string {
  const hermes = (rawFm.metadata as Record<string, unknown> | undefined)?.hermes as
    | Record<string, unknown>
    | undefined;
  const tags = normalizeTags(hermes?.tags ?? rawFm.tags);
  const author = Array.isArray(rawFm.author) ? rawFm.author.join(', ') : rawFm.author;
  const meta: Record<string, unknown> = {
    name: opts.slug,
    description: String(rawFm.description ?? '').trim() || `Imported skill ${opts.slug}`,
    ...(rawFm.version ? { version: rawFm.version } : {}),
    ...(author ? { author } : {}),
    ...(rawFm.license ? { license: rawFm.license } : {}),
    ...(rawFm.platforms ? { platforms: rawFm.platforms } : {}),
    tags,
    nativeEngine: { triggers: deriveTriggers(String(rawFm.name ?? opts.slug), tags) },
    imported: true,
    source: opts.source,
    ...(opts.pinned ? { pinned: true } : {}),
  };
  return `---\n${yaml.stringify(meta)}---\n\n${body.trim()}\n`;
}

function copySupportDirs(srcDir: string, destDir: string): void {
  for (const sub of SUPPORT_DIRS) {
    const from = path.join(srcDir, sub);
    if (fs.existsSync(from) && fs.statSync(from).isDirectory()) {
      fs.cpSync(from, path.join(destDir, sub), {
        recursive: true,
        // never follow symlinks out of the source tree
        filter: (s) => {
          try {
            return !fs.lstatSync(s).isSymbolicLink();
          } catch {
            return false;
          }
        },
      });
    }
  }
}

/** Import skills from a directory. Pure-ish: writes nothing when dryRun. */
export function importSkills(sourceDir: string, options: ImportOptions = {}): ImportReport {
  const destRoot = options.destRoot ?? defaultDestRoot();
  const source = options.source ?? 'import';
  const dryRun = options.dryRun ?? false;
  const pinByDefault = options.pinByDefault ?? true;
  const report: ImportReport = { imported: [], quarantined: [], review: [], skipped: [], total: 0, dryRun };

  const skillDirs = findSkillDirs(sourceDir);
  report.total = skillDirs.length;

  for (const skillDir of skillDirs) {
    const rel = path.relative(sourceDir, skillDir);
    if (options.category && !rel.includes(options.category)) {
      report.skipped.push({ sourcePath: rel, reason: 'filtered by --category' });
      continue;
    }
    const skillMd = fs.existsSync(path.join(skillDir, 'SKILL.md'))
      ? path.join(skillDir, 'SKILL.md')
      : path.join(skillDir, 'skill.md');
    const content = fs.readFileSync(skillMd, 'utf-8');

    // Compatibility check.
    try {
      const skill = parseSkillFile(content, skillMd, 'managed');
      const v = validateSkill(skill);
      if (!v.valid) {
        report.skipped.push({ sourcePath: rel, reason: `invalid: ${v.errors.join('; ')}` });
        continue;
      }
    } catch (err) {
      report.skipped.push({ sourcePath: rel, reason: `parse error: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    // Firewall gate (scans SKILL.md + scripts/support files recursively).
    const fw = scanSkillFirewall(skillDir);
    if (fw.quarantineRequired) {
      report.quarantined.push({ sourcePath: rel, reason: fw.summary, verdict: String(fw.verdict) });
      continue;
    }
    if (String(fw.verdict) === 'review' && !options.includeReview) {
      report.review.push({ sourcePath: rel, reason: fw.summary, verdict: 'review' });
      continue;
    }

    // Remap + flatten + install.
    const m = content.match(FRONTMATTER_RE);
    if (!m) {
      report.skipped.push({ sourcePath: rel, reason: 'missing frontmatter' });
      continue;
    }
    let rawFm: Record<string, unknown>;
    try {
      rawFm = (yaml.parse(m[1]!) ?? {}) as Record<string, unknown>;
    } catch {
      report.skipped.push({ sourcePath: rel, reason: 'unparseable frontmatter' });
      continue;
    }
    const slug = slugify(String(rawFm.name ?? path.basename(skillDir)));
    const destDir = path.join(destRoot, slug);
    if (fs.existsSync(destDir) && !options.overwrite) {
      report.skipped.push({ sourcePath: rel, reason: `conflict: ${slug} already imported` });
      continue;
    }

    if (!dryRun) {
      try {
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, 'SKILL.md'), remapSkill(rawFm, m[2]!, { slug, source, pinned: pinByDefault }), 'utf-8');
        copySupportDirs(skillDir, destDir);
      } catch (err) {
        report.skipped.push({ sourcePath: rel, reason: `write error: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
    }
    report.imported.push({ name: slug, sourcePath: rel, verdict: String(fw.verdict) });
  }

  if (!dryRun && report.imported.length > 0) {
    void (async () => {
      try {
        const { getSkillRegistry } = await import('./registry.js');
        await getSkillRegistry().reloadAll();
      } catch (err) {
        logger.debug(`skill reload after import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }

  return report;
}
