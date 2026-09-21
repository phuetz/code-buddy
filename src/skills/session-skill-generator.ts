/**
 * Session Skill Generator
 *
 * Automatically turns a complex session into a reusable authored skill.
 * Triggered at session end when the session was hard enough:
 * many tool calls, recovered errors, several files touched.
 *
 * - Passes through the security scanner (scanSkillFile) before install.
 * - Installs under .codebuddy/skills/authored-<slug>/SKILL.md
 * - Registers into the SkillRegistry as tier 'workspace'.
 *
 * @module skills/session-skill-generator
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { scanFile as scanSkillFile } from '../security/skill-scanner.js';
import { getSkillRegistry } from './registry.js';

const SKILLS_DIR = '.codebuddy/skills';
const AUTHORED_PREFIX = 'authored-';

export interface SessionMetrics {
  toolCalls: number;
  errorsRecovered: number;
  filesTouched: string[];
  durationMs?: number;
  summary?: string;
}

export interface GeneratedSkill {
  name: string;
  slug: string;
  filePath: string;
  triggers: string[];
  description: string;
}

/** A session is "complex" when it crossed these thresholds. */
export const COMPLEXITY_THRESHOLDS = {
  minToolCalls: 8,
  minErrorsRecovered: 1,
  minFilesTouched: 2,
};

export function isComplexSession(m: SessionMetrics): boolean {
  return (
    m.toolCalls >= COMPLEXITY_THRESHOLDS.minToolCalls ||
    m.errorsRecovered >= COMPLEXITY_THRESHOLDS.minErrorsRecovered ||
    m.filesTouched.length >= COMPLEXITY_THRESHOLDS.minFilesTouched
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'session';
}

function buildSkillMarkdown(skill: {
  name: string;
  description: string;
  triggers: string[];
  summary: string;
  files: string[];
  errors: number;
  toolCalls: number;
}): string {
  const triggers = skill.triggers.map((t) => `"${t}"`).join(', ');
  const files = skill.files.length
    ? skill.files.map((f) => `- \`${f}\``).join('\n')
    : '- (none recorded)';
  return `---
name: ${skill.name}
description: ${skill.description}
triggers: [${triggers}]
tools: ["view_file", "search", "str_replace_editor", "bash"]
priority: 6
autoActivate: true
tags: ["authored", "session-generated", "auto"]
---

# ${skill.name}

Skill auto-generated from a complex session.

## When to use
This skill captures a hard-won approach. Reach for it when you face a
similar mix of tool calls, recovered errors, and multi-file edits.

## Session snapshot
- Tool calls: ${skill.toolCalls}
- Errors recovered: ${skill.errors}
- Files touched:
${files}

## Approach
${skill.summary}

## Reuse checklist
1. Re-read the files listed above before editing.
2. Reproduce the error path first, then apply the fix.
3. Keep edits small and verify with the project's test suite.
`;
}

export interface GenerateOptions {
  workDir?: string;
  metrics: SessionMetrics;
  topic?: string;
  register?: boolean;
}

/**
 * Generate (and optionally register) an authored skill from a complex session.
 * Returns null when the session is not complex enough.
 */
export function generateSessionSkill(options: GenerateOptions): GeneratedSkill | null {
  const { metrics } = options;
  if (!isComplexSession(metrics)) {
    logger.debug('Session not complex enough for skill generation', metrics);
    return null;
  }

  const cwd = options.workDir ?? process.cwd();
  const topic = options.topic?.trim() || metrics.summary?.split(/[.!?]/)[0]?.trim() || 'complex-task';
  const slug = slugify(topic);
  const name = `${AUTHORED_PREFIX}${slug}`;
  const triggers = Array.from(
    new Set([
      slug,
      ...topic.toLowerCase().split(/\s+/).filter((w) => w.length >= 4).slice(0, 4),
      'session-generated',
    ]),
  );

  const description = `Reusable guide distilled from a complex session about ${topic}.`;
  const markdown = buildSkillMarkdown({
    name,
    description,
    triggers,
    summary: metrics.summary || `Solved a complex task involving ${metrics.filesTouched.length} files and ${metrics.errorsRecovered} recovered errors.`,
    files: metrics.filesTouched,
    errors: metrics.errorsRecovered,
    toolCalls: metrics.toolCalls,
  });

  const skillDir = path.join(cwd, SKILLS_DIR, name);
  const filePath = path.join(skillDir, 'SKILL.md');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(filePath, markdown, { mode: 0o600 });

  // Security scan before registration
  try {
    const scan = scanSkillFile(filePath);
    const critical = scan.findings.filter((f) => f.severity === 'critical');
    if (critical.length > 0) {
      logger.warn('Authored skill blocked by security scanner', {
        name,
        findings: critical.map((f) => f.description),
      });
      fs.rmSync(skillDir, { recursive: true, force: true });
      return null;
    }
  } catch {
    // scanner unavailable — allow through
  }

  if (options.register !== false) {
    try {
      getSkillRegistry().registerSkillFileSync(filePath, 'workspace');
    } catch (err) {
      logger.warn('Failed to register authored skill', {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: GeneratedSkill = { name, slug, filePath, triggers, description };
  logger.info('Session skill generated', result);
  return result;
}

/** Convenience: run generation from a lifecycle session-end event. */
export function maybeGenerateFromSessionEnd(
  metrics: SessionMetrics,
  topic?: string,
  workDir?: string,
): GeneratedSkill | null {
  return generateSessionSkill({ metrics, topic, workDir });
}
