/** Native Windows check of the shipped TaskVerifyTool, with real local compilers.
 * Args: package directory, isolated fixture (already containing TypeScript and ESLint).
 * The fixture is disposable. No network, credentials or global installations are used.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const [packageDir, project] = process.argv.slice(2);
assert.equal(process.platform, 'win32', 'This recipe must execute on Windows');
assert.ok(packageDir && project && project.includes(' '), 'Supply package and disposable path with spaces');
const { TaskVerifyTool, resolveProjectBin } = await import(pathToFileURL(path.join(packageDir, 'dist/tools/registry/lessons-tools.js')).href);
const sourceDir = path.join(project, 'src');
fs.mkdirSync(sourceDir, { recursive: true });
fs.writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, types: [] }, files: ['src/invoice.ts'] }));
fs.writeFileSync(path.join(project, 'eslint.config.mjs'), 'export default [{ files: ["**/*.js"], rules: { "no-undef": "error" } }];\n');
const typescriptFile = path.join(sourceDir, 'invoice.ts');
const lintFile = path.join(sourceDir, 'invoice.js');
fs.writeFileSync(typescriptFile, 'export const amount: number = 42;\n');
fs.writeFileSync(lintFile, 'function identity(value) { return value; }\nidentity(42);\n');
const tool = new TaskVerifyTool();
const cwdBefore = process.cwd();
const resolved = { tsc: resolveProjectBin('tsc', sourceDir), eslint: resolveProjectBin('eslint', sourceDir) };
assert.ok(resolved.tsc?.endsWith('tsc.cmd'));
assert.ok(resolved.eslint?.endsWith('eslint.cmd'));
const positive = await tool.execute({ checks: ['typescript', 'lint'], workDir: sourceDir });
fs.writeFileSync(typescriptFile, 'export const amount: number = "wrong";\n');
fs.writeFileSync(lintFile, 'notDefined();\n');
const negative = await tool.execute({ checks: ['typescript', 'lint'], workDir: sourceDir });
const evidence = { platform: process.platform, node: process.version, resolved, positive, negative, cwdUnchanged: process.cwd() === cwdBefore };
fs.writeFileSync(path.join(project, 'task-verify-results.json'), JSON.stringify(evidence, null, 2));
assert.equal(positive.success, true, JSON.stringify(positive));
assert.equal(negative.success, false, JSON.stringify(negative));
assert.match(JSON.stringify(negative), /TS2322/);
assert.match(JSON.stringify(negative), /no-undef/);
assert.equal(evidence.cwdUnchanged, true);
console.log('WINDOWS_TASK_VERIFY_REAL_COMPILERS_OK');
