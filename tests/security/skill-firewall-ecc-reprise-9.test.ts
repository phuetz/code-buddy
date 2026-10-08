import { describe, it, expect } from 'vitest';
import { scanSkillContent, deobfuscateShellWord } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('Skill Firewall ECC Reprise 9 (Contournements)', () => {
  it('met en quarantaine les quotes et antislashs collés au nom de l\'interpréteur', () => {
    const bodies = [
      "''bash -- ../payload.txt",
      "\"\"bash -- ../payload.txt",
      "bash'' -- ../payload.txt",
      "bash\"\" -- ../payload.txt",
      "\\bash -- ../payload.txt",
      "\\b\\a\\s\\h -- ../payload.txt",
      "ba\\sh -- ../payload.txt",
      "$'bash' -- ../payload.txt",
      "bash$'' -- ../payload.txt",
      "''sh -- ../payload.txt",
      "''dash -- ../payload.txt",
      "bash\\\n'' -- ../payload.txt"
    ];
    for (const body of bodies) {
      const result = scanSkillContent(body, 'scripts/run.sh', true);
      const verdicts = result.findings.filter(f => !f.documentary && f.severity === 'high');
      expect(verdicts.length, `Failed on: ${body}`).toBeGreaterThan(0);
      expect(verdicts[0]!.pattern).toBe('shell-interpreter');
    }
  });

  it('met en quarantaine les variables non normalisables', () => {
    const body = "$bash --flag";
    const result = scanSkillContent(body, 'scripts/run.sh', true);
    const verdicts = result.findings.filter(f => !f.documentary && f.severity === 'high');
    expect(verdicts.length, `Failed on: ${body}`).toBeGreaterThan(0);
    expect(verdicts[0]!.pattern).toBe('shell-interpreter');
  });

  it('ne met pas en quarantaine les mots bénins', () => {
    const body = "$user = User::factory()->create();";
    const result = scanSkillContent(body, 'scripts/run.php', true);
    const verdicts = result.findings.filter(f => !f.documentary && f.severity === 'high' && f.pattern === 'shell-interpreter');
    expect(verdicts.length, `Should be benign: ${body}`).toBe(0);
  });

  it('bloque l\'import via importSkills', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise-9-'));
    fs.mkdirSync(path.join(tmpDir, 'test-skill', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'test-skill', 'SKILL.md'), '---\nname: test-skill\ndescription: Test\n---\nHello');
    fs.writeFileSync(path.join(tmpDir, 'test-skill', 'scripts', 'run.sh'), "''bash -- ../payload.txt");
    
    const result = await importSkills(tmpDir, { dryRun: true });
    expect(result.quarantined.length).toBe(1);
    expect(result.imported.length).toBe(0);
    
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deobfuscateShellWord normalise correctement', () => {
    expect(deobfuscateShellWord("''bash")).toBe("bash");
    expect(deobfuscateShellWord("\"\"bash")).toBe("bash");
    expect(deobfuscateShellWord("\\b\\a\\s\\h")).toBe("bash");
    expect(deobfuscateShellWord("$'bash'")).toBe("bash");
    expect(deobfuscateShellWord("$VAR")).toBeNull();
  });
});
