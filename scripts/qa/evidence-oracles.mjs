import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/** An oracle reads returned values, never the request or its serialization. */
export function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\s+/g, ' ').trim() : value;
}

export function fileDigest(file) {
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
}

function subset(actual, expected) {
  if (expected === null || typeof expected !== 'object') return isDeepStrictEqual(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, value]) => subset(actual[key], value));
}

function field(value, selector) {
  return selector.split('.').reduce((current, key) => current?.[key], value);
}

/** All clauses are mandatory. There is no success by an unrelated alternative. */
export function evaluateEvidence(result, oracle, context = {}) {
  const checks = [{ check: 'statut attendu', passed: result?.success === (oracle.success ?? true) }];
  let outputJson;
  try { outputJson = JSON.parse(result?.output); } catch { /* Output need not be JSON. */ }
  const values = { output: result?.output, data: result?.data, outputJson, observations: context.observations };
  for (const rule of oracle.rules ?? []) {
    let actual;
    let passed = false;
    try {
      if (rule.file) {
        const file = path.resolve(context.root, rule.file);
        const relative = path.relative(context.root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact outside QA root');
        actual = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
        if (rule.changed) {
          checks.push({ check: `écriture effective de ${rule.file}`, passed: Object.hasOwn(context.beforeFiles ?? {}, rule.file) && fileDigest(file) !== context.beforeFiles[rule.file] && fileDigest(file) !== null });
        }
        if (rule.jsonField) actual = field(JSON.parse(actual), rule.jsonField);
      } else {
        actual = field(values, rule.field);
      }
      if (rule.normalize) actual = normalizeText(actual);
      switch (rule.op) {
        case 'eq': passed = isDeepStrictEqual(actual, rule.value); break;
        case 'includes': passed = typeof actual === 'string' && rule.values.every(value => actual.includes(value)); break;
        case 'excludes': passed = typeof actual === 'string' && rule.values.every(value => !actual.includes(value)); break;
        case 'some': passed = Array.isArray(actual) && actual.some(value => subset(value, rule.value)); break;
        case 'min': passed = Number.isFinite(actual) && actual >= rule.value; break;
        case 'max': passed = Number.isFinite(actual) && actual <= rule.value; break;
        case 'length': passed = actual?.length === rule.value; break;
        case 'nonempty': passed = typeof actual === 'string' && actual.trim().length > 0; break;
        default: passed = false;
      }
    } catch { passed = false; }
    checks.push({ check: rule.label ?? `${rule.field ?? rule.file} ${rule.op}`, passed });
  }
  checks.push({ check: 'oracle spécifique déclaré', passed: (oracle.rules?.length ?? 0) > 0 });
  return { passed: checks.every(check => check.passed), checks };
}
