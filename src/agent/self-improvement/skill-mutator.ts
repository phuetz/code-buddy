/**
 * Skill mutator — installs / refines / pins / archives authored SKILL.md files
 * under `.codebuddy/skills/<authored-name>/` (ONE level deep so the SkillRegistry's
 * 1-level walk actually loads them) with proven, reversible operations and the
 * firewall scan used to gate authored skill content.
 *
 * Authored skills always carry YAML frontmatter (name + description) so the
 * registry can parse them; the body is the model's markdown. All destructive ops
 * honour a `pinned: true` frontmatter flag and operate ONLY on authored skills.
 *
 * @module agent/self-improvement/skill-mutator
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { getSkillRegistry } from '../../skills/registry.js';
import { scanSkillFirewall } from '../../security/skill-scanner.js';
import { inspectAuthoredCode } from './authored-artifact-gate.js';
import type { SkillSpec } from './skill-types.js';

export const AUTHORED_SKILL_PREFIX = 'authored-';
const ARCHIVE_DIR = '.archive';

export function toAuthoredSkillName(raw: string): string {
  const base = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.startsWith(AUTHORED_SKILL_PREFIX) ? base : `${AUTHORED_SKILL_PREFIX}${base || 'skill'}`;
}

export function isAuthoredSkillName(name: string): boolean {
  return name.startsWith(AUTHORED_SKILL_PREFIX);
}

// ── frontmatter helpers (our controlled format; avoids the registry parser's
//    tier + validation requirements for a simple flag toggle) ────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Ensure the content begins with YAML frontmatter carrying name + description. */
export function ensureFrontmatter(name: string, description: string, content: string): string {
  if (FRONTMATTER_RE.test(content)) return content;
  const desc = description.replace(/"/g, "'").replace(/\r?\n/g, ' ').trim();
  return `---\nname: ${name}\ndescription: "${desc}"\n---\n\n${content.trim()}\n`;
}

export function readPinned(content: string): boolean {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return false;
  return /^\s*pinned\s*:\s*true\s*$/im.test(m[1]!);
}

/** Set or clear the `pinned` flag inside the frontmatter (frontmatter must exist). */
export function setPinned(content: string, value: boolean): string {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return content; // no frontmatter → nothing to pin (create() always adds it)
  let body = m[1]!;
  if (/^\s*pinned\s*:.*$/im.test(body)) {
    body = body.replace(/^\s*pinned\s*:.*$/im, `pinned: ${value}`);
  } else {
    body = `${body}\npinned: ${value}`;
  }
  return content.replace(FRONTMATTER_RE, `---\n${body}\n---\n`);
}

export interface SkillFirewallCheck {
  safe: boolean;
  verdict: string;
  reasons: string[];
}

/** Write the skill body to a throwaway file and run the firewall scan (no install). */
export function scanAuthoredSkillContent(content: string): SkillFirewallCheck {
  const dir = path.join(os.tmpdir(), `cb-skillscan-${randomUUID()}`);
  const file = path.join(dir, 'SKILL.md');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
  try {
    const report = scanSkillFirewall(file);
    return {
      safe: !report.quarantineRequired,
      verdict: String(report.verdict),
      reasons: report.quarantineRequired ? [report.summary] : [],
    };
  } catch (err) {
    return { safe: false, verdict: 'scan-error', reasons: [err instanceof Error ? err.message : String(err)] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Safety re-gate over authored skill CONTENT (static scan + firewall). */
export function safetyGateSkill(content: string): { ok: boolean; reasons: string[] } {
  const scan = inspectAuthoredCode(content, 'skill');
  if (!scan.ok) return { ok: false, reasons: scan.reasons };
  const fw = scanAuthoredSkillContent(content);
  if (!fw.safe) return { ok: false, reasons: [`firewall: ${fw.verdict}`, ...fw.reasons] };
  return { ok: true, reasons: [] };
}

export interface SkillMutatorPort {
  create(spec: SkillSpec): { name: string };
  remove(name: string): boolean;
  has(name: string): boolean;
}

export interface MutationResult {
  ok: boolean;
  reasons: string[];
}

/** Dual-purpose mutator: the engine's port + the curation operations. */
export class LiveSkillMutator implements SkillMutatorPort {
  private readonly skillsRoot: string;

  constructor(skillsRoot?: string) {
    this.skillsRoot = skillsRoot ?? path.join(process.cwd(), '.codebuddy', 'skills');
  }

  /** 1 level deep so the registry's findSkillFiles (1-level) loads it. */
  private dirFor(name: string): string {
    return path.join(this.skillsRoot, name);
  }

  private skillFile(name: string): string {
    return path.join(this.dirFor(name), 'SKILL.md');
  }

  private reload(): void {
    void getSkillRegistry().reloadAll().catch(() => {});
  }

  private readContent(name: string): string | null {
    const f = this.skillFile(name);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : null;
  }

  has(name: string): boolean {
    return fs.existsSync(this.skillFile(name));
  }

  isPinned(name: string): boolean {
    const c = this.readContent(name);
    return c ? readPinned(c) : false;
  }

  create(spec: SkillSpec): { name: string } {
    // Backstops durs, miroir de LiveToolMutator.register : (a) namespace
    // authored-* obligatoire — sans lui, un spec nommé comme une skill user/
    // bundled l'écraserait ; (b) re-gate de sûreté — les appelants légitimes
    // (skill-gate, consolidator) pré-gatent, mais AUCUN chemin d'installation
    // ne doit exister sans scan (appel direct, contenu trafiqué). Si le test
    // gardien no-backdoor casse, une backdoor a été réintroduite — STOP.
    if (!isAuthoredSkillName(spec.name)) {
      throw new Error(
        `refusing to create skill "${spec.name}": authored skills must be named "${AUTHORED_SKILL_PREFIX}*" (never shadow a user/bundled skill)`,
      );
    }
    const content = ensureFrontmatter(spec.name, spec.description, spec.content);
    const gate = safetyGateSkill(content);
    if (!gate.ok) {
      throw new Error(`refusing to install skill "${spec.name}": ${gate.reasons.join('; ')}`);
    }
    const dir = this.dirFor(spec.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.skillFile(spec.name), content, 'utf-8');
    this.reload();
    return { name: spec.name };
  }

  /** Full re-author of an existing authored skill, re-gated. Refuses pinned. */
  update(name: string, newContent: string, description = ''): MutationResult {
    if (!isAuthoredSkillName(name)) return { ok: false, reasons: ['not an authored skill'] };
    if (!this.has(name)) return { ok: false, reasons: ['skill does not exist'] };
    if (this.isPinned(name)) return { ok: false, reasons: ['skill is pinned'] };
    const withFm = ensureFrontmatter(name, description, newContent);
    const gate = safetyGateSkill(withFm);
    if (!gate.ok) return gate;
    fs.writeFileSync(this.skillFile(name), withFm, 'utf-8');
    this.reload();
    return { ok: true, reasons: [] };
  }

  /** Find/replace within an authored skill body (exact; fail on multiple unless replaceAll). */
  patch(name: string, oldStr: string, newStr: string, opts: { replaceAll?: boolean } = {}): MutationResult {
    const content = this.readContent(name);
    if (content === null) return { ok: false, reasons: ['skill does not exist'] };
    if (this.isPinned(name)) return { ok: false, reasons: ['skill is pinned'] };
    const count = content.split(oldStr).length - 1;
    if (count === 0) return { ok: false, reasons: ['old_string not found'] };
    if (count > 1 && !opts.replaceAll) {
      return { ok: false, reasons: [`old_string matches ${count} times — pass replaceAll or add context`] };
    }
    const patched = opts.replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
    return this.update(name, patched);
  }

  remove(name: string): boolean {
    // Contract: the engine only ever touches skills it authored. Without this
    // guard, `improve skills-*` on a user-placed (non-authored) skill would
    // delete/mutate a skill the engine is forbidden to manage.
    if (!isAuthoredSkillName(name)) return false;
    if (this.isPinned(name)) return false;
    const dir = this.dirFor(name);
    const existed = fs.existsSync(dir);
    if (existed) fs.rmSync(dir, { recursive: true, force: true });
    this.reload();
    return existed;
  }

  /** Recoverable removal — move to .archive/. Refuses pinned. Authored-only. */
  archive(name: string): boolean {
    if (!isAuthoredSkillName(name)) return false;
    if (this.isPinned(name)) return false;
    const dir = this.dirFor(name);
    if (!fs.existsSync(dir)) return false;
    const archiveRoot = path.join(this.skillsRoot, ARCHIVE_DIR);
    fs.mkdirSync(archiveRoot, { recursive: true });
    let dest = path.join(archiveRoot, name);
    if (fs.existsSync(dest)) dest = `${dest}-${randomUUID().slice(0, 8)}`;
    fs.renameSync(dir, dest);
    this.reload();
    return true;
  }

  restore(name: string): boolean {
    if (!isAuthoredSkillName(name)) return false;
    const src = path.join(this.skillsRoot, ARCHIVE_DIR, name);
    if (!fs.existsSync(src)) return false;
    const dir = this.dirFor(name);
    if (fs.existsSync(dir)) return false; // don't clobber a live skill
    fs.renameSync(src, dir);
    this.reload();
    return true;
  }

  pin(name: string): boolean {
    return this.setPin(name, true);
  }

  unpin(name: string): boolean {
    return this.setPin(name, false);
  }

  private setPin(name: string, value: boolean): boolean {
    // pin/unpin rewrite the SKILL.md frontmatter — authored-only, like every
    // other mutating op, so a user's hand-placed skill is never rewritten.
    if (!isAuthoredSkillName(name)) return false;
    const content = this.readContent(name);
    if (content === null) return false;
    const withFm = ensureFrontmatter(name, '', content);
    fs.writeFileSync(this.skillFile(name), setPinned(withFm, value), 'utf-8');
    this.reload();
    return true;
  }

  /** List installed authored skills (by the authored- prefix). */
  listAuthored(): string[] {
    if (!fs.existsSync(this.skillsRoot)) return [];
    return fs
      .readdirSync(this.skillsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isAuthoredSkillName(e.name) && fs.existsSync(path.join(this.skillsRoot, e.name, 'SKILL.md')))
      .map((e) => e.name);
  }
}
