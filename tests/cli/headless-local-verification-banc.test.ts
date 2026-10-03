import { describe, expect, it } from 'vitest';
import { evaluateHeadlessTaskOutcome } from '../../src/cli/headless-task-outcome.js';

describe('bilan des vérifications exécutées par chemin local', () => {
  it.each([
    ['./node_modules/.bin/tsc -p tsconfig.build.json --noEmit | head -10; echo "TSC_BUILD_EXIT=$?"', 'src/service.ts(1,2): error TS2322: Type mismatch'],
    ['HOME=/workspace/_qa/home ./node_modules/.bin/vitest run | tail -8', 'Test Files 1 failed (1)\nTests 2 failed (2)'],
    ['/workspace/node_modules/.bin/eslint src/ | tail -5', '✖ 2 problems (2 errors, 0 warnings)'],
    ['./venv/bin/pytest | tail -5', 'FAILED tests/test_service.py::test_service'],
  ])('refuse le rouge visible même si le pipeline termine à zéro : %s', (command, output) => {
    const outcome = evaluateHeadlessTaskOutcome('Vérifie le projet', [{
      type: 'tool_result', content: output,
      toolCall: { id: 'local-check', function: { name: 'bash', arguments: JSON.stringify({ command }) } },
      toolResult: { success: true, output },
    }]);
    expect(outcome.success).toBe(false);
    expect(outcome.reasons).toContain('verification_failed');
  });
});
