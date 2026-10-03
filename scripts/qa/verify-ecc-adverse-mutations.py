#!/usr/bin/env python3
"""Focused adverse-review mutants, sequential execution, exact byte restoration."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '_qa/pare-feu-ecc/reprise-2/mutations'
OUT.mkdir(parents=True, exist_ok=True)
SCANNER = 'src/security/skill-scanner.ts'
AGENTS = 'src/agent/custom/custom-agent-loader.ts'
IMPORT = 'src/skills/skill-importer.ts'
AGENT_IMPORT = 'src/skills/agent-importer.ts'
TESTS = ['tests/security/skill-firewall-ecc-adverse.test.ts',
         'tests/skills/skill-firewall-ecc-adverse-consumers.test.ts',
         'tests/agents/agent-ecc-adverse.test.ts',
         'tests/skills/skill-import-ecc-adverse.test.ts']

def replace(old, new):
    def edit(source):
        assert old in source, old
        return source.replace(old, new)
    return edit

def pattern_disabled(name):
    def edit(source):
        lines = source.splitlines()
        index = next(i for i, line in enumerate(lines) if f"name: '{name}'" in line)
        assert 'pattern: /' in lines[index]
        start = lines[index].index('pattern: /')
        end = lines[index].index(', severity:', start)
        lines[index] = lines[index][:start] + 'pattern: /(?!)/' + lines[index][end:]
        return '\n'.join(lines) + '\n'
    return edit

def original_pattern(name):
    original = subprocess.check_output(['git', 'show', f'17ca8f374:{SCANNER}'], cwd=ROOT, text=True)
    line = next(line for line in original.splitlines() if f"name: '{name}'" in line)
    def edit(source):
        lines = source.splitlines()
        index = next(i for i, item in enumerate(lines) if f"name: '{name}'" in item)
        lines[index] = line
        return '\n'.join(lines) + '\n'
    return edit

def old_bc(source):
    old = subprocess.check_output(['git', 'show', f'17ca8f374:{SCANNER}'], cwd=ROOT, text=True)
    before = next(line for line in old.splitlines() if '/^echo\\s+' in line)
    after = next(line for line in source.splitlines() if '/^echo\\s+' in line)
    return replace(after, before)(source)

CASES = [
    ('documentary-severity-info', SCANNER, lambda source: source.replace('severity: dp.severity,', "severity: kind === 'documentary' ? 'info' : dp.severity,", 1)),
    ('compound-warning-imperative', SCANNER, replace('(?<![\\w-])(?:run|execute)', r'\b(?:run|execute)')),
    ('imperatives-ignored', SCANNER, replace('return { markdown, language, watched, imperative };', 'return { markdown, language, watched, imperative: false };')),
    ('watched-flag-ignored', SCANNER, replace('context.watched &&', 'true &&')),
    ('html-guard-removed', SCANNER, replace('/<!--/.test(line) || ', '')),
    ('description-unanchored', SCANNER, replace('/^description:', '/description:')),
    ('native-prose-active', SCANNER, replace("return context.imperative ? 'active' : 'documentary';", "return 'active';")),
    ('prefixed-secret-penalties', SCANNER, replace("if (['secret-ref', 'prefixed-secret', 'template-injection'].includes(dp.name)) return 'documentary';", "if (dp.name === 'template-injection') return 'documentary';")),
    ('extended-process-missed', SCANNER, pattern_disabled('extended-process')),
    ('php-backticks-missed', SCANNER, pattern_disabled('php-backtick')),
    ('quoted-delete-missed', SCANNER, original_pattern('script-recursive-delete')),
    ('bc-words-allowed', SCANNER, old_bc),
    ('kotlin-require-always-benign', SCANNER, replace("if (dp.name === 'dynamic-require' && ['kotlin', 'kt', 'solidity'].includes(context.language)) {", "if (dp.name === 'dynamic-require' && ['kotlin', 'kt', 'solidity'].includes(context.language)) { return 'benign';")),
    ('automatic-gate-critical-only', SCANNER, replace("return buildSkillFirewallReport(result.file, [result]).verdict !== 'allow';", "return result.findings.some(f => f.severity === 'critical');")),
    ('registry-scripts-ignored', 'src/skills/registry.ts', replace("path.basename(skill.sourcePath).toLowerCase() === 'skill.md' ? path.dirname(skill.sourcePath) : skill.sourcePath", 'skill.sourcePath')),
    ('authored-review-accepted', 'src/agent/self-improvement/skill-mutator.ts', replace("safe: report.verdict === 'allow',", 'safe: !report.quarantineRequired,')),
    ('production-markdown-ignored', AGENTS, replace("else if (ext === '.md') format = 'md';", '')),
    ('production-disabled-ignored', AGENTS, replace('if (parsed.disabled === true) return null;', '')),
    ('legacy-description-rejected', AGENTS, replace('yaml.parse(compatible)', 'yaml.parse(content)')),
    ('prototype-alias-inherited', 'src/agent/agent-tools.ts', replace('Object.hasOwn(CLAUDE_TOOLS, t) ? CLAUDE_TOOLS[t]! : t', 'CLAUDE_TOOLS[t] ?? t')),
    ('glob-patterns-rejected', 'src/agent/agent-tools.ts', replace('/^!?[A-Za-z*?][\\w.*?:-]*$/', '/^[A-Za-z][\\w.*:-]*$/')),
    ('production-bash-aliases-lost', 'src/agent/custom/custom-agent-tool-filter.ts', replace("const agentEnabled = unique((agent.tools ?? []).flatMap(name => resolveAgentTool(name) === 'bash' ? ['bash', 'terminal', 'shell_exec', 'interactive_shell'] : [name]));", 'const agentEnabled = agent.tools ?? [];')),
    ('production-alias-denials-lost', 'src/agent/custom/custom-agent-tool-filter.ts', replace('const agentDisabled = rawDisabled.length ? unique([...rawDisabled, ...names.filter(name => deniedEffects.has(resolveAgentTool(name)))]) : [];', 'const agentDisabled = rawDisabled;')),
    ('canonical-symlink-opens-filter', IMPORT, replace('const hasCanonical = roots.length > 0;', 'const hasCanonical = roots.length > 0 && !fs.lstatSync(canonical).isSymbolicLink();')),
    ('canonical-prefix-loose', IMPORT, replace("!hasCanonical || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))", '!hasCanonical || dir.startsWith(canonical)')),
    ('skill-profile-home-ignored', IMPORT, replace("return getCodeBuddyPath('skills');", "return path.join(process.env.HOME!, '.codebuddy', 'skills');")),
    ('canonical-case-lost', IMPORT, replace("name.toLowerCase() === 'skills'", "name === 'skills'")),
    ('translation-name-only', IMPORT, replace('if (isLocale && candidates.includes(original)) {', "if (isLocale && skillDirs.some(d => baseSlugForDir(d) === base)) { report.skipped.push({ sourcePath: dir, reason: 'duplicate translation' }); continue; }\n    if (isLocale && candidates.includes(original)) {")),
    ('translation-not-scanned', IMPORT, replace('if (isLocale && candidates.includes(original)) {', "if (isLocale && candidates.includes(original)) { report.skipped.push({ sourcePath: dir, reason: 'duplicate translation' }); continue; } if (false) {")),
    ('agent-dry-run-collision', AGENT_IMPORT, replace('if (reserved.has(destination.toLowerCase()))', 'if (!options.dryRun && reserved.has(destination.toLowerCase()))')),
    ('agent-profile-home-ignored', AGENT_IMPORT, replace('options.destRoot ?? getAgentsDir()', "options.destRoot ?? path.join(process.env.HOME!, '.codebuddy', 'agents')")),
    ('agent-symlink-accepted', AGENT_IMPORT, lambda source: replace('(fs.constants.O_NOFOLLOW ?? 0)', '0')(replace("if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('agent must be a regular file');", '')(source))),
    ('agent-permission-full-auto', AGENT_IMPORT, replace("permissionMode: 'suggest'", "permissionMode: 'full-auto'")),
    ('agent-carry-frontmatter', AGENT_IMPORT, replace('const staged = {', 'const staged = { ...fm,')),
    ('agent-snapshot-reread', AGENT_IMPORT, replace('const match = raw.match(', "const match = fs.readFileSync(file, 'utf8').match(")),
]

results = []
for name, file, edit in CASES:
    target = ROOT / file
    original = target.read_bytes()
    try:
        target.write_text(edit(original.decode()))
        with (OUT / f'{name}.log').open('w') as log:
            run = subprocess.run(['node_modules/.bin/vitest', 'run', '--configLoader', 'runner', '--maxWorkers', '2', *TESTS], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=120)
        transcript = (OUT / f'{name}.log').read_text()
        assertions = [line.strip() for line in transcript.splitlines() if line.startswith(' FAIL ')]
        killed = run.returncode != 0 and 'AssertionError:' in transcript and bool(assertions)
        results.append({'mutation': name, 'file': file, 'exitCode': run.returncode,
                        'killedByAssertion': killed, 'failedTests': assertions,
                        'restoredSha256': hashlib.sha256(original).hexdigest()})
        print(f'{name}: {"killed" if killed else "NOT PROVEN"}', flush=True)
    finally:
        target.write_bytes(original)
    assert target.read_bytes() == original
    (OUT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
sys.exit(0 if all(item['killedByAssertion'] for item in results) else 1)
