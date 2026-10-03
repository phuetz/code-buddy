import { describe, expect, it } from 'vitest';
import {
  completedCheckRepairAnswer as completedAnswer,
  projectCheckToRun,
} from '../../src/cli/headless-check-repair.js';
import type { TaskEvidenceEntry } from '../../src/cli/headless-task-outcome.js';
// Supply a final answer in every fixture, including negative controls.
const completedCheckRepairAnswer = (query: string, entries: TaskEvidenceEntry[], cwd: string) =>
  completedAnswer(query, [...entries, { type: 'assistant', content: 'The requested check finished.' }], cwd);
const edit: TaskEvidenceEntry = {
  type: 'tool_result',
  content: 'Updated',
  toolCall: {
    id: 'edit',
    function: {
      name: 'str_replace_editor',
      arguments: '{"path":"impl.js","old_str":"a+b","new_str":"a*b"}',
    },
  },
  toolResult: { success: true },
};
const green: TaskEvidenceEntry = {
  type: 'tool_result',
  content: '# tests 3\n# fail 0',
  toolCall: { id: 'check', function: { name: 'bash', arguments: '{"command":"npm test"}' } },
  toolResult: {
    success: true,
    output: '# tests 3\n# fail 0',
    metadata: {
      shellExecution: { command: 'npm test', cwd: '/fixture', testScript: 'node --test' },
    },
  },
};
describe('observable terminal state for an ordinary test-repair workflow', () => {
  it('finishes only after successful real verification following the source edit', () => {
    expect(
      completedCheckRepairAnswer('run tests and fix failures', [edit, green], '/fixture')
    ).toContain('impl.js');
    expect(
      completedCheckRepairAnswer('run tests and fix failures', [green, edit], '/fixture')
    ).toBeUndefined();
  });
  it('never accepts a failed check, changed tests, or a different project', () => {
    expect(
      completedCheckRepairAnswer(
        'run tests and fix failures',
        [edit, { ...green, toolResult: { ...green.toolResult!, success: false } }],
        '/fixture'
      )
    ).toBeUndefined();
    expect(
      completedCheckRepairAnswer(
        'run tests and fix failures',
        [
          {
            ...edit,
            toolCall: {
              ...edit.toolCall!,
              function: { name: 'str_replace_editor', arguments: '{"path":"impl.test.js"}' },
            },
          },
          green,
        ],
        '/fixture'
      )
    ).toBeUndefined();
    expect(
      completedCheckRepairAnswer('run tests and fix failures', [edit, green], '/other')
    ).toBeUndefined();
  });
  it('does not terminate a compound request after only its checks', () => {
    expect(
      completedCheckRepairAnswer(
        'run tests and fix failures, then add a REST API',
        [edit, green],
        '/fixture'
      )
    ).toBeUndefined();
  });
  it('schedules the observed project check once per edit and never guesses a script', () => {
    const manifest: TaskEvidenceEntry = {
      type: 'tool_result',
      content: '1: {"scripts":{"test":"node --test"}}',
      toolCall: {
        id: 'manifest',
        function: { name: 'view_file', arguments: '{"path":"package.json"}' },
      },
      toolResult: { success: true },
    };
    expect(projectCheckToRun('run tests and fix failures', [edit])).toBeUndefined();
    expect(projectCheckToRun('run tests and fix failures', [manifest])).toBe('npm test');
    expect(projectCheckToRun('run tests and fix failures', [manifest, edit])).toBe('npm test');
    expect(
      projectCheckToRun('run tests and fix failures', [manifest, edit, green])
    ).toBeUndefined();
    expect(
      projectCheckToRun('run tests and fix failures', [
        manifest,
        edit,
        { ...green, toolResult: { success: false } },
      ])
    ).toBeUndefined();
    expect(
      projectCheckToRun('run tests and fix failures then deploy', [manifest, edit])
    ).toBeUndefined();
  });
});
