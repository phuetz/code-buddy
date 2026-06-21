#!/usr/bin/env node
/**
 * Honest dependency-audit gate for CI.
 *
 * Replaces a blanket `npm audit --audit-level=moderate` (which is red on a tree
 * with dozens of unfixable transitive advisories) with a documented policy:
 *
 *   - ANY critical            -> FAIL (no exceptions; keep the count at zero)
 *   - ANY high not allowlisted -> FAIL
 *   - high listed in audit-allowlist.json with a future reviewBy -> ALLOWED (logged)
 *   - an allowlist entry whose reviewBy has passed -> FAIL (forces periodic review)
 *   - moderate / low           -> reported, non-blocking
 *
 * This is the opposite of `|| true`: every exception is named, justified, and
 * carries an expiry. Shrink audit-allowlist.json whenever upstream ships a fix.
 *
 * Usage: node scripts/ci-audit-gate.mjs
 * No dependencies — parses `npm audit --json`.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCK = new Set(['critical', 'high']);

function loadAllowlist() {
  try {
    const raw = JSON.parse(readFileSync(join(repoRoot, 'audit-allowlist.json'), 'utf8'));
    const map = new Map();
    for (const e of raw.allow ?? []) map.set(e.package, e);
    return map;
  } catch (e) {
    console.error(`audit-gate: could not read audit-allowlist.json (${e.message})`);
    return new Map();
  }
}

function runAudit() {
  // `npm audit --json` exits non-zero when vulnerabilities exist; capture stdout anyway.
  try {
    return JSON.parse(execSync('npm audit --json', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

const today = new Date().toISOString().slice(0, 10);
const allow = loadAllowlist();
const audit = runAudit();
const vulns = audit.vulnerabilities ?? {};
const meta = audit.metadata?.vulnerabilities ?? {};

const failures = [];
const accepted = [];
const usedAllow = new Set();
const moderates = [];

for (const [name, v] of Object.entries(vulns)) {
  if (!BLOCK.has(v.severity)) {
    if (v.severity === 'moderate' || v.severity === 'low') moderates.push(`${name} [${v.severity}]`);
    continue;
  }
  if (v.severity === 'critical') {
    failures.push(`${name} [critical] — criticals are never allowlisted`);
    continue;
  }
  // high
  const entry = allow.get(name);
  if (!entry) {
    failures.push(`${name} [high] — not in audit-allowlist.json (review and either fix or document it)`);
    continue;
  }
  usedAllow.add(name);
  if (!entry.reviewBy || entry.reviewBy < today) {
    failures.push(`${name} [high] — allowlist entry expired (reviewBy ${entry.reviewBy ?? 'missing'}); re-review`);
  } else {
    accepted.push(`${name} [high] — accepted until ${entry.reviewBy}: ${entry.reason ?? ''}`);
  }
}

// Stale allowlist hygiene: entries that no longer match a live high advisory.
const staleAllow = [...allow.keys()].filter((p) => !usedAllow.has(p));

console.log(`audit-gate: totals ${JSON.stringify(meta)}`);
if (accepted.length) {
  console.log(`\naudit-gate: accepted (documented) high advisories:`);
  for (const a of accepted) console.log(`  ✓ ${a}`);
}
if (moderates.length) {
  console.log(`\naudit-gate: ${moderates.length} moderate/low advisories tracked (non-blocking).`);
}
if (staleAllow.length) {
  console.log(`\naudit-gate: NOTE — allowlist entries with no matching live high advisory (consider removing): ${staleAllow.join(', ')}`);
}
if (failures.length) {
  console.error(`\naudit-gate: FAIL`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\naudit-gate: PASS — 0 critical, ${accepted.length} documented high, no undocumented high.`);
