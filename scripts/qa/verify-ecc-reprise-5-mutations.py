#!/usr/bin/env python3
"""Restore one scoped safety regression at a time, require assertion failures."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / '_qa/pare-feu-ecc/reprise-5/mutations'
OUT.mkdir(parents=True, exist_ok=True)
SCANNER = 'src/security/skill-scanner.ts'
TESTS = ['tests/security/skill-firewall-ecc-reprise-5.test.ts', 'tests/agents/agent-ecc-reprise-5.test.ts', 'tests/skills/skill-firewall-ecc-reprise-5-consumers.test.ts', 'tests/security/skill-firewall-ecc.test.ts']

def replace(old, new):
    def edit(source):
        assert old in source, old
        return source.replace(old, new)
    return edit

def pattern_disabled(name):
    def edit(source):
        line = next(line for line in source.splitlines() if f"name: '{name}'" in line)
        left = line.index('pattern: /'); right = line.index(', severity:', left)
        return replace(line, line[:left] + 'pattern: /(?!)/' + line[right:])(source)
    return edit

CASES = [
    ('support-network-document-quarantined', SCANNER, replace("if (context.supportDocument && dp.capability === 'network' && !['critical', 'high'].includes(dp.severity)) return 'documentary';", "if (context.supportDocument && dp.capability === 'network' && !['critical', 'high'].includes(dp.severity)) return 'active';")),
    ('python-capability-missed', SCANNER, pattern_disabled('python-process')),
    ('prefixed-reference-missed', SCANNER, lambda source: pattern_disabled('prefixed-secret')(replace(r'\b(?:[A-Z][A-Z0-9]*_)*(?:API_KEY|SECRET|PASSWORD|TOKEN)(?:_[A-Z0-9]+)*\b', r'\b(?:API_KEY|SECRET|PASSWORD|TOKEN)\b')(source))),
    ('pytorch-mode-quarantined', SCANNER, replace("// authorization for an unknown evaluator. Scripts retain the critical hit.\n    return 'documentary';", "// authorization for an unknown evaluator. Scripts retain the critical hit.\n    return 'active';")),
    ('kotlin-solidity-assertions-quarantined', SCANNER, lambda source: replace(next(line for line in source.splitlines() if 'isNotBlank' in line), next(line for line in source.splitlines() if 'isNotBlank' in line).replace("return 'benign';", "return 'active';"))(source)),
    ('quoted-refusal-quarantined', SCANNER, lambda source: replace(next(line for line in source.splitlines() if 'if (quoted &&' in line), next(line for line in source.splitlines() if 'if (quoted &&' in line).replace("return 'documentary';", "return 'active';"))(source)),
    ('watched-catalog-quarantined', SCANNER, lambda source: replace(next(line for line in source.splitlines() if "dp.name === 'rm-rf' && context.watched" in line), next(line for line in source.splitlines() if "dp.name === 'rm-rf' && context.watched" in line).replace("return 'documentary';", "return 'active';"))(source)),
    ('mktemp-document-quarantined', SCANNER, replace("if (/^mktemp$/.test(command) ||", "if (/^mktemp$/.test(command)) return 'active';\n    if (/^mktemp$/.test(command) ||")),
    ('unknown-document-quarantined', SCANNER, replace("if (dp.name === 'shell-backtick' && !SHELL_LANGUAGES.has(context.language) && !['rb', 'ruby'].includes(context.language)) return 'documentary';", "if (dp.name === 'shell-backtick' && !SHELL_LANGUAGES.has(context.language) && !['rb', 'ruby'].includes(context.language)) return 'active';")),
    ('typed-property-document-quarantined', SCANNER, replace("/^require\\s*\\(\\s*[A-Za-z_]\\w*\\s*\\.\\s*[A-Za-z_]\\w*/.test(line.slice(offset))) return context.imperative ? 'active' : 'documentary';", "/^require\\s*\\(\\s*[A-Za-z_]\\w*\\s*\\.\\s*[A-Za-z_]\\w*/.test(line.slice(offset))) return 'active';")),
    ('tsx-template-mistaken-for-shell', SCANNER, replace("'js', 'jsx', 'javascript', 'ts', 'tsx', 'typescript'", "'js', 'jsx', 'javascript', 'ts', 'typescript'")),
    ('prefixed-python-missed', SCANNER, replace(r'(?:\w+_)?subprocess', 'subprocess')),
    ('prefixed-node-missed', SCANNER, replace(r'(?:[A-Za-z_$][\w$]*_)?child_process', 'child_process')),
    ('credential-assignment-missed', SCANNER, pattern_disabled('embedded-secret')),
    ('script-secret-exemption', SCANNER, replace("if (!context.markdown) return 'active';", "if (!context.markdown && !['secret-ref', 'prefixed-secret', 'embedded-secret'].includes(dp.name)) return 'active';")),
    ('shebang-language-ignored', SCANNER, replace("shebang ?? (SCRIPT_EXTENSIONS.has(extension) ? extension.slice(1) : 'unknown')", "path.extname(filePath).slice(1).toLowerCase()")),
    ('unknown-language-authorized', SCANNER, replace("(Boolean(context.language) && context.language !== 'php' && !DATA_BACKTICK_LANGUAGES.has(context.language))", 'false')),
    ('mandatory-folding-optout', SCANNER, replace("  {\n    // Minimum interpreter framing", "  if (deobAll) {\n    // Minimum interpreter framing")),
    ('support-payload-ignored', SCANNER, replace('} else if (entry.isFile() || entry.isSymbolicLink()) {', "} else if ((entry.isFile() || entry.isSymbolicLink()) && (withinScripts || SCRIPT_EXTENSIONS.has(path.extname(entry.name)) || /\\.md$/i.test(entry.name) || isExecutableOrShebang(fullPath))) {")),
    ('shell-launcher-ignored', SCANNER, pattern_disabled('shell-interpreter')),
    ('agent-documentary-critical-accepted', 'src/skills/agent-importer.ts', replace("scan.findings = scan.findings.map(f => f.severity === 'critical' || f.severity === 'high' ? { ...f, documentary: false } : f);", '')),
    ('documentary-floor-removed', SCANNER, replace("const verdict = activeVerdict === 'allow' && findings.some(f => f.documentary) ? 'review' : activeVerdict;", 'const verdict = activeVerdict;')),
]

results = []
for name, file, edit in CASES:
    target = ROOT / file
    original = target.read_bytes()
    try:
        mutated = edit(original.decode())
        assert mutated.encode() != original, name
        target.write_text(mutated)
        with (OUT / f'{name}.log').open('w') as log:
            run = subprocess.run(['node_modules/.bin/vitest', 'run', '--configLoader', 'runner', '--maxWorkers', '2', *TESTS], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=120)
        transcript = (OUT / f'{name}.log').read_text()
        failures = [line.strip() for line in transcript.splitlines() if line.startswith(' FAIL ')]
        count = re.search(r'Tests\s+(\d+) failed', transcript)
        killed = run.returncode != 0 and 'AssertionError:' in transcript and bool(failures)
        results.append({'mutation': name, 'file': file, 'exitCode': run.returncode,
                        'killedByAssertion': killed, 'failedTests': failures,
                        'failedTestCount': int(count.group(1)) if count else None,
                        'restoredSha256': hashlib.sha256(original).hexdigest()})
        print(f'{name}: {"killed" if killed else "NOT PROVEN"}', flush=True)
    finally:
        target.write_bytes(original)
    assert target.read_bytes() == original
    (OUT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
sys.exit(0 if all(r['killedByAssertion'] for r in results) else 1)
