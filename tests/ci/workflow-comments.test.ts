import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

describe('CI Workflow Comments', () => {
  it('should accurately describe macOS behavior without claiming it is non-blocking or uses continue-on-error', () => {
    const yamlPath = path.join(process.cwd(), '.github/workflows/ci.yml');
    const content = fs.readFileSync(yamlPath, 'utf8');

    // Vérifier l'absence des mentions fausses
    expect(content.includes('non bloquant')).toBe(false);
    expect(content.includes('continue-on-error ci-dessus')).toBe(false);

    // Vérifier que la matrice OS est inchangée
    const parsed = yaml.parse(content);
    const osMatrix = parsed.jobs.test.strategy.matrix.os;
    expect(osMatrix).toBe("${{ (github.event_name == 'pull_request' && fromJSON('[\"ubuntu-latest\",\"windows-latest\"]')) || fromJSON('[\"ubuntu-latest\",\"windows-latest\",\"macos-latest\"]') }}");
  });
});
