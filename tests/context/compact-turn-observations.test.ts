import { describe, expect, it } from 'vitest';
import {
  compactTurnObservations,
  compactObservation,
} from '../../src/context/compact-turn-observations.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
describe('compact recoverable observations', () => {
  it('retains errors and check counts within its limit with an exact recovery identifier', () => {
    const full =
      Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') +
      '\nerror: wrong result\nexpected: 12\nactual: 7\n# tests 1\n# fail 1';
    const compact = compactObservation(full, 'call-fixture', 700);
    expect(compact.length).toBeLessThanOrEqual(700);
    expect(compact).toContain('expected: 12');
    expect(compact).toContain('# fail 1');
    expect(compact).toContain('call-fixture');
  });
  it('never masks an unrecoverable observation and never splits tool pairs', () => {
    const input: CodeBuddyMessage[] = [
      { role: 'system', content: 'RULE' },
      { role: 'user', content: 'TASK' },
    ];
    for (let i = 0; i < 4; i++)
      input.push(
        {
          role: 'assistant',
          content: 'Thought',
          tool_calls: [
            { id: `c${i}`, type: 'function', function: { name: 'view_file', arguments: '{}' } },
          ],
        },
        { role: 'tool', content: 'SOURCE', tool_call_id: `c${i}` }
      );
    const output = compactTurnObservations(input, () => false);
    expect(output.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual([
      'SOURCE',
      'SOURCE',
      'SOURCE',
      'SOURCE',
    ]);
    expect(output).toHaveLength(input.length);
    expect(input[2]?.content).toBe('Thought');
    const recoverable = compactTurnObservations(input, () => true);
    expect(recoverable.some((m) => String(m.content).includes('restore_context'))).toBe(true);
    expect(recoverable.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c3']);
    expect(
      recoverable
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.tool_calls?.map((c) => c.id) ?? [])
    ).toEqual(['c3']);
    expect(recoverable[0]?.content).toBe('RULE');
    expect(recoverable[1]?.content).toBe('TASK');
  });
  it('keeps older failing diagnostics and source text while shortening metadata paths', () => {
    const source = '1: const path = "/fixture/keep-this-literal";';
    const input: CodeBuddyMessage[] = [
      {
        role: 'system',
        content:
          'Working directory: /fixture\n<persistent_memory>\nProject: fixture\n</persistent_memory>\nRULE',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'red',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"cd /fixture && npm test"}' },
          },
        ],
      },
      {
        role: 'tool',
        content:
          "not ok 1\nlocation: '/fixture/impl.test.js:4:1'\nexpected: 12\nactual: 7\n# fail 1",
        tool_call_id: 'red',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'read',
            type: 'function',
            function: { name: 'view_file', arguments: '{"path":"/fixture/impl.js"}' },
          },
        ],
      },
      { role: 'tool', content: 'Contents of /fixture/impl.js:\n' + source, tool_call_id: 'read' },
    ];
    const output = compactTurnObservations(input, () => true, '/fixture');
    expect(output.find((m) => m.role === 'tool' && m.tool_call_id === 'red')?.content).toContain(
      '# fail 1'
    );
    expect(output.find((m) => m.role === 'tool' && m.tool_call_id === 'red')?.content).toContain(
      'expected: 12'
    );
    expect(output.find((m) => m.role === 'tool' && m.tool_call_id === 'read')?.content).toContain(
      source
    );
    expect(output[0]?.content).toContain('RULE');
    expect(output[0]?.content).not.toContain('/fixture');
    expect(input[0]?.content).toContain('/fixture');
    const call = output.find((m) => m.role === 'assistant' && m.tool_calls?.[0]?.id === 'red');
    expect(
      call?.role === 'assistant' &&
        call.tool_calls?.[0]?.type === 'function' &&
        call.tool_calls[0].function.arguments
    ).toBe('{"command":"npm test"}');
  });
});

it('does not count recovered red text as another check, while retaining the actual failed check', () => {
  const input: CodeBuddyMessage[] = [];
  for (const [id, name] of [
    ['red', 'bash'],
    ['page', 'restore_context'],
    ['last', 'view_file'],
  ]) {
    input.push(
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: id!, type: 'function', function: { name: name!, arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: id!, content: 'not ok 1\n# fail 1' }
    );
  }
  const output = compactTurnObservations(input, () => true);
  expect(output.some((m) => m.role === 'tool' && m.tool_call_id === 'red')).toBe(true);
  expect(output.some((m) => m.role === 'tool' && m.tool_call_id === 'page')).toBe(false);
  expect(output.some((m) => m.role === 'system' && String(m.content).includes('page'))).toBe(true);
  expect(input.filter((m) => m.role === 'tool')).toHaveLength(3);
});
