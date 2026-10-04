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
 *   - mandatory entry.nodes -> every vulnerable instance must be in that scope
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
if (audit.error || !audit.vulnerabilities || !audit.metadata?.vulnerabilities) {
  console.error('audit-gate: FAIL — npm did not return a complete vulnerability report');
  process.exit(1);
}
const vulns = audit.vulnerabilities ?? {};
const meta = audit.metadata?.vulnerabilities ?? {};

const failures = [];
const accepted = [];
const usedAllow = new Set();
const moderates = [];

const urlToPkg = new Map();
for (const v of Object.values(vulns)) {
  for (const via of v.via || []) {
    if (typeof via === 'object' && via.url) {
      urlToPkg.set(via.url, via.name);
    }
  }
}

// npm propagates advisory severity to parent packages, sometimes through cycles.
// An exception must name ALL actual advisories, including inherited ones, so a
// newly published advisory cannot silently reuse an unrelated package exception.
function advisoryUrls(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const vulnerability = vulns[name];
  if (!vulnerability || !Array.isArray(vulnerability.via)) {
    throw new Error(`missing advisory details for ${name}`);
  }
  return vulnerability.via.flatMap((via) => {
    if (typeof via === 'string') return advisoryUrls(via, seen);
    if (typeof via?.url !== 'string') throw new Error(`missing advisory URL for ${name}`);
    return [via.url];
  });
}

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
  let urls;
  try {
    urls = [...new Set(advisoryUrls(name))];
  } catch (error) {
    failures.push(`${name} [high] — ${error.message}`);
    continue;
  }
  if (!urls.length || urls.some((url) => !entry.advisories?.includes(url))) {
    failures.push(`${name} [high] — advisory outside the allowlisted scope: ${urls.join(', ')}`);
    continue;
  }
  if (!entry.reason?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedOn ?? '') || entry.reviewedOn > today) {
    failures.push(`${name} [high] — exception needs a rationale and a dated review`);
    continue;
  }
  const missingCoverage = entry.advisories?.find(url => {
    const ghsa = url.split('/').pop();
    const pkg = urlToPkg.get(url) || '';
    return !entry.reason.includes(ghsa) && (!pkg || !entry.reason.includes(pkg));
  });
  if (missingCoverage) {
    const ghsa = missingCoverage.split('/').pop();
    const pkg = urlToPkg.get(missingCoverage) || 'unknown';
    failures.push(`${name} [high] — reason must explicitly name advisory ${ghsa} or package ${pkg}`);
    continue;
  }
  // A tooling-only exception must never hide a vulnerable runtime instance.
  if (!Array.isArray(entry.nodes) || !entry.nodes.length ||
      entry.nodes.some((node) => typeof node !== 'string' || !node.trim()) ||
      !Array.isArray(v.nodes) || !v.nodes.length ||
      v.nodes.some((node) => !entry.nodes.includes(node))) {
    failures.push(`${name} [high] — vulnerable nodes outside the allowlisted scope: ${(v.nodes ?? []).join(', ')}`);
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
