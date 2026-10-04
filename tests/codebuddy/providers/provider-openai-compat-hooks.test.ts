import { describe, it, expect } from 'vitest';
import {
  injectAnthropicCacheBreakpoints,
  injectJsonSystemPromptForAnthropic,
} from '../../../src/codebuddy/providers/provider-openai-compat-hooks.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

describe('provider-openai-compat-hooks', () => {
  describe('injectAnthropicCacheBreakpoints', () => {
    it('marks the last system message with ephemeral cache_control', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'identity prefix' },
        { role: 'user', content: 'hi' },
      ];

      const result = injectAnthropicCacheBreakpoints(messages);

      const lastSystem = result.find(m => m.role === 'system') as
        & CodeBuddyMessage
        & { cache_control?: { type: string } };
      expect(lastSystem.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('pose le repère sur le dernier message system de tête, pas sur la queue volatile', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'prefixe stable' },
        { role: 'user', content: 'corrige le bug' },
        { role: 'system', content: '<runtime_settings ephemeral="true">{"cwd":"/tmp/autre"}</runtime_settings>' },
      ];

      const result = injectAnthropicCacheBreakpoints(messages);

      const systems = result.filter(m => m.role === 'system') as Array<
        CodeBuddyMessage & { cache_control?: { type: string } }
      >;
      expect(systems[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(systems[1].cache_control).toBeUndefined();
    });

    it('returns the array unchanged (copied) when no system message is present', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'hi' },
      ];

      const result = injectAnthropicCacheBreakpoints(messages);

      expect(result).toEqual(messages);
      // The contract is "originals unmodified"; verify we don't accidentally
      // expose the input array (mutating result must not mutate input).
      expect(result).not.toBe(messages);
    });
  });

  describe('injectJsonSystemPromptForAnthropic', () => {
    it('appends the IMPORTANT JSON instruction to the last system message', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'reply json' },
      ];

      const result = injectJsonSystemPromptForAnthropic(messages);

      const lastSystem = result.find(m => m.role === 'system')!;
      expect(typeof lastSystem.content).toBe('string');
      expect(lastSystem.content as string).toContain('You are helpful.');
      expect(lastSystem.content as string).toContain(
        'IMPORTANT: You must respond with valid JSON only',
      );
    });

    it('preserves the original system message before the appended instruction', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'PREFIX' },
        { role: 'user', content: 'go' },
      ];

      const result = injectJsonSystemPromptForAnthropic(messages);

      const lastSystem = result.find(m => m.role === 'system')!;
      expect((lastSystem.content as string).startsWith('PREFIX')).toBe(true);
    });

    it('targets the LAST system message when multiple are present', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'A' },
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'B' },
      ];

      const result = injectJsonSystemPromptForAnthropic(messages);

      const systems = result.filter(m => m.role === 'system');
      expect(systems[0].content).toBe('A');
      expect(systems[1].content as string).toContain('B\n\nIMPORTANT:');
    });

    it('returns the input untouched when there is no system message', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'hi' },
      ];

      const result = injectJsonSystemPromptForAnthropic(messages);

      expect(result).toBe(messages);
    });

    it('returns the input untouched when the last system has non-string content (parts array)', () => {
      const partsArrayContent = [
        { type: 'text', text: 'hello' },
      ] as unknown as string;
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: partsArrayContent },
        { role: 'user', content: 'hi' },
      ];

      const result = injectJsonSystemPromptForAnthropic(messages);

      expect(result).toBe(messages);
    });

    it('does not mutate the input array', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'original' },
        { role: 'user', content: 'hi' },
      ];
      const before = JSON.stringify(messages);

      injectJsonSystemPromptForAnthropic(messages);

      expect(JSON.stringify(messages)).toBe(before);
    });

    it('regression for commit 7f6853b: returned array is the one to send', () => {
      // The bug pre-fix was that the inlined version reassigned a local var
      // but the payload kept the old reference. Pulling it out as a pure fn
      // that returns a new array makes that bug pattern impossible — the
      // caller must explicitly assign the return value.
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'go' },
      ];

      const result = injectJsonSystemPromptForAnthropic(messages);

      expect(result).not.toBe(messages);
      expect((result.find(m => m.role === 'system')!.content as string)).toContain('IMPORTANT:');
    });
  });
});
