import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/b-compacted-fresh-tool-ttl.json';
import { expireOldToolResults } from '../../src/context/tool-output-masking.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

function history(turns: number): CodeBuddyMessage[] {
  return Array.from({ length: turns }, (_, index): CodeBuddyMessage[] => [
    { role: 'assistant', content: '', tool_calls: [{ id: `old-${index}`, type: 'function', function: { name: 'bash', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `old-${index}`, content: 'observation' },
  ]).flat();
}

describe('âge des outils après compaction du banc B', () => {
  it('garde le résultat réel venant de terminer malgré le compteur global', () => {
    const messages = history(fixture.retainedAssistantTurns - 1);
    messages.push(
      { role: 'assistant', content: '', tool_calls: [{ id: fixture.toolCallId, type: 'function', function: { name: 'bash', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: fixture.toolCallId, content: fixture.observedBeforeExpiry },
    );
    expireOldToolResults(messages, fixture.currentTurn);
    expect(messages.at(-1)).toMatchObject({ tool_call_id: fixture.toolCallId, content: fixture.observedBeforeExpiry });
  });

  it('expire encore les anciens résultats et protège tout le dernier groupe parallèle', () => {
    const messages = history(44);
    messages.push(
      { role: 'assistant', content: '', tool_calls: [
        { id: 'latest', type: 'function', function: { name: 'bash', arguments: '{}' } },
        { id: 'parallel', type: 'function', function: { name: 'bash', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'latest', content: 'observation' },
      { role: 'tool', tool_call_id: 'parallel', content: 'second fresh observation' },
    );
    expireOldToolResults(messages, 500);
    expect(messages[1]?.content).toContain('expired');
    expect(messages.at(-2)?.content).toBe('observation');
    expect(messages.at(-1)?.content).toBe('second fresh observation');
  });
});
