/**
 * Cat 33: Message Preprocessing (6 tests, no API)
 * Cat 34: Prompt Suggestions (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 33: Message Preprocessing
// ============================================================================

export function cat33MessagePreprocessing(): TestDef[] {
  return [
    {
      name: '33.1-singleton-lifecycle',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const a = MessagePreprocessor.getInstance();
        const b = MessagePreprocessor.getInstance();
        const same = a === b;
        MessagePreprocessor.resetInstance();
        const c = MessagePreprocessor.getInstance();
        return { pass: same && a !== c };
      },
    },
    {
      name: '33.2-config-defaults',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const mp = MessagePreprocessor.getInstance();
        const config = mp.getConfig();
        MessagePreprocessor.resetInstance();
        return {
          pass: config.enableMediaDetection === true && config.enableLinkUnderstanding === true,
          metadata: config as unknown as Record<string, unknown>,
        };
      },
    },
    {
      name: '33.3-link-extraction',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const mp = MessagePreprocessor.getInstance();
        const result = await mp.preprocess({
          channel: { type: 'telegram' as any },
          sender: { id: 'user1', displayName: 'Test' },
          content: 'Check out https://example.com and http://test.org/page',
          timestamp: new Date(),
          messageId: 'msg1',
        } as any);
        MessagePreprocessor.resetInstance();
        return {
          pass: result.extractedLinks !== undefined && result.extractedLinks.length >= 2,
          metadata: { linkCount: result.extractedLinks?.length, links: result.extractedLinks },
        };
      },
    },
    {
      name: '33.4-media-detection',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const mp = MessagePreprocessor.getInstance();
        const result = await mp.preprocess({
          channel: { type: 'discord' as any },
          sender: { id: 'user1', displayName: 'Test' },
          content: 'Here is a photo',
          timestamp: new Date(),
          messageId: 'msg2',
          attachments: [
            { type: 'image', url: 'https://example.com/photo.jpg', filename: 'photo.jpg', mimeType: 'image/jpeg' },
          ],
        } as any);
        MessagePreprocessor.resetInstance();
        return {
          pass: result.detectedMedia !== undefined && result.detectedMedia.length >= 1,
          metadata: { mediaCount: result.detectedMedia?.length },
        };
      },
    },
    {
      name: '33.5-content-enrichment',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const mp = MessagePreprocessor.getInstance();
        const result = await mp.preprocess({
          channel: { type: 'slack' as any },
          sender: { id: 'user1', displayName: 'Test' },
          content: 'help me with TypeScript generics',
          timestamp: new Date(),
          messageId: 'msg3',
        } as any);
        MessagePreprocessor.resetInstance();
        return {
          pass: result.enrichments !== undefined && typeof result.enrichments === 'object' &&
                (result.enrichments.lengthCategory !== undefined || Object.keys(result.enrichments).length >= 1),
          metadata: { enrichments: result.enrichments },
        };
      },
    },
    {
      name: '33.6-update-config',
      timeout: 5000,
      fn: async () => {
        const { MessagePreprocessor } = await import('../../src/channels/message-preprocessing.js');
        MessagePreprocessor.resetInstance();
        const mp = MessagePreprocessor.getInstance();
        mp.updateConfig({ enableTranscription: false, maxLinkSummaryLength: 500 });
        const config = mp.getConfig();
        MessagePreprocessor.resetInstance();
        return {
          pass: config.enableTranscription === false && config.maxLinkSummaryLength === 500,
          metadata: config as unknown as Record<string, unknown>,
        };
      },
    },
  ];
}

// ============================================================================
// Cat 34: Prompt Suggestions
// ============================================================================

export function cat34PromptSuggestions(): TestDef[] {
  return [
    {
      name: '34.1-enable-disable',
      timeout: 5000,
      fn: async () => {
        const { PromptSuggestionEngine } = await import('../../src/agent/prompt-suggestions.js');
        const engine = new PromptSuggestionEngine(true);
        const enabledBefore = engine.isEnabled();
        engine.setEnabled(false);
        const enabledAfter = engine.isEnabled();
        return { pass: enabledBefore && !enabledAfter };
      },
    },
    {
      name: '34.2-heuristic-test-keyword',
      timeout: 5000,
      fn: async () => {
        const { PromptSuggestionEngine } = await import('../../src/agent/prompt-suggestions.js');
        const engine = new PromptSuggestionEngine(true);
        const suggestions = await engine.generateSuggestions(
          { lastUserMessage: 'I found a test failure' },
          'The test is failing because of a missing import.'
        );
        return {
          pass: suggestions.length >= 1,
          metadata: { count: suggestions.length, suggestions },
        };
      },
    },
    {
      name: '34.3-heuristic-error-keyword',
      timeout: 5000,
      fn: async () => {
        const { PromptSuggestionEngine } = await import('../../src/agent/prompt-suggestions.js');
        const engine = new PromptSuggestionEngine(true);
        const suggestions = await engine.generateSuggestions(
          { lastUserMessage: 'There is an error in the build' },
          'Error: Cannot find module "./utils"'
        );
        return {
          pass: suggestions.length >= 1,
          metadata: { count: suggestions.length, suggestions },
        };
      },
    },
    {
      name: '34.4-cache-retrieval',
      timeout: 5000,
      fn: async () => {
        const { PromptSuggestionEngine } = await import('../../src/agent/prompt-suggestions.js');
        const engine = new PromptSuggestionEngine(true);
        await engine.generateSuggestions(
          { lastUserMessage: 'refactor this code' },
          'I can help with refactoring.'
        );
        const cached = engine.getSuggestions();
        return {
          pass: cached.length >= 1,
          metadata: { cached },
        };
      },
    },
    {
      name: '34.5-clear-suggestions',
      timeout: 5000,
      fn: async () => {
        const { PromptSuggestionEngine } = await import('../../src/agent/prompt-suggestions.js');
        const engine = new PromptSuggestionEngine(true);
        await engine.generateSuggestions(
          { lastUserMessage: 'deploy the app' },
          'Deploying...'
        );
        engine.clearSuggestions();
        const after = engine.getSuggestions();
        return { pass: after.length === 0 };
      },
    },
  ];
}
