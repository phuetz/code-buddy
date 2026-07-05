import { describe, expect, it } from 'vitest';
import { deviceWidth, lastAssistantMessage, summarizeChanges } from '../../src/renderer/components/studio-iterate/iterate-model.js';

const changes = [
  { path: 'src/App.tsx', kind: 'modified' as const },
  { path: 'src/App.test.tsx', kind: 'added' as const },
  { path: 'src/old.ts', kind: 'deleted' as const },
  { path: 'src/theme.ts', kind: 'modified' as const },
];

describe('iterate-model', () => {
  it('summarizes changed files by kind', () => {
    expect(summarizeChanges(changes)).toEqual({ added: 1, modified: 2, deleted: 1 });
  });

  it('maps preview devices to stable frame widths', () => {
    expect(deviceWidth('desktop')).toBe(1280);
    expect(deviceWidth('tablet')).toBe(768);
    expect(deviceWidth('mobile')).toBe(390);
  });

  it('returns the most recent assistant message', () => {
    const messages = [
      { id: '1', role: 'assistant' as const, text: 'Premier jet' },
      { id: '2', role: 'user' as const, text: 'Ajoute un filtre' },
      { id: '3', role: 'assistant' as const, text: 'Filtre ajouté', streaming: true },
    ];

    expect(lastAssistantMessage(messages)).toEqual(messages[2]);
  });

  it('returns undefined when no assistant has answered yet', () => {
    expect(lastAssistantMessage([{ id: '1', role: 'user', text: 'Bonjour' }])).toBeUndefined();
  });
});
