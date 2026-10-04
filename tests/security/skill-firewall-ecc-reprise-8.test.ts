import { describe, it, expect } from 'vitest';
import { scanSkillContent } from '../../src/security/skill-scanner.js';

describe('Skill Firewall ECC Reprise 8 (Contournements)', () => {
  it('met en quarantaine les orthographes étendues de --', () => {
    const bodies = [
      "bash ''-- ../payload.txt",
      "bash \"\"-- ../payload.txt",
      "bash ''- ../payload.txt",
      "bash \\-- ../payload.txt",
      "bash \\- ../payload.txt"
    ];
    for (const body of bodies) {
      const result = scanSkillContent(body, 'scripts/run.sh');
      const verdicts = result.findings.filter(f => !f.documentary && f.severity === 'high');
      expect(verdicts.length, `Failed on: ${body}`).toBeGreaterThan(0);
      expect(verdicts[0].pattern).toBe('shell-interpreter');
    }
  });

  it('met en quarantaine la continuation de ligne', () => {
    const body = "bash \\\n-- ../payload.txt";
    const result = scanSkillContent(body, 'scripts/run.sh');
    const verdicts = result.findings.filter(f => !f.documentary && f.severity === 'high');
    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts[0].pattern).toBe('shell-interpreter');
  });
});
