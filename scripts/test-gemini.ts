#!/usr/bin/env npx tsx
/**
 * Test script for Gemini 2.5 Flash API
 *
 * Usage:
 *   export GOOGLE_API_KEY="your-key-here"
 *   npx tsx scripts/test-gemini.ts
 *
 * Or:
 *   GOOGLE_API_KEY="your-key" npx tsx scripts/test-gemini.ts
 */

import { GeminiProvider } from '../src/providers/gemini-provider.js';
import dotenv from 'dotenv';

dotenv.config();

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1200, 2400];

async function runWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) {
        break;
      }
      const delayMs = RETRY_DELAYS_MS[attempt] ?? 2500;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`Retrying ${label} (${attempt + 1}/${MAX_RETRIES}) after error: ${message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const TESTS = [
  {
    name: 'Basic Completion',
    run: async (provider: GeminiProvider) => {
      const response = await provider.complete({
        messages: [{ role: 'user', content: 'What is 2 + 2? Reply with just the number.' }],
        maxTokens: 80,
      });
      console.log('Response:', response.content);
      console.log('Tokens:', response.usage);
      return response.content?.includes('4');
    },
  },
  {
    name: 'Tool Calling',
    run: async (provider: GeminiProvider) => {
      const response = await provider.complete({
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the current weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        ],
        maxTokens: 200,
      });
      console.log('Tool calls:', response.toolCalls);
      return response.toolCalls && response.toolCalls.length > 0;
    },
  },
  {
    name: 'Streaming',
    run: async (provider: GeminiProvider) => {
      let fullContent = '';
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }],
        maxTokens: 50,
      })) {
        if (chunk.type === 'content') {
          process.stdout.write(chunk.content);
          fullContent += chunk.content;
        }
      }
      console.log('\n');
      return fullContent.includes('1') && fullContent.includes('5');
    },
  },
  {
    name: 'System Prompt',
    run: async (provider: GeminiProvider) => {
      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Reply with exactly: Ahoy matey' }],
        systemPrompt: 'You are a helpful pirate assistant. Always speak like a pirate.',
        maxTokens: 80,
      });
      console.log('Response:', response.content);
      // Check for pirate-like words, allowing case variation and punctuation.
      const content = response.content?.toLowerCase() || '';
      return content.includes('ahoy') || content.includes('matey') || content.includes('arr') || content.includes('aye');
    },
  },
  {
    name: 'Multi-turn Conversation',
    run: async (provider: GeminiProvider) => {
      const response = await provider.complete({
        messages: [
          { role: 'user', content: 'My name is Alice.' },
          { role: 'assistant', content: 'Hello Alice! Nice to meet you.' },
          { role: 'user', content: 'What is my name?' },
        ],
        maxTokens: 50,
      });
      console.log('Response:', response.content);
      return response.content?.toLowerCase().includes('alice');
    },
  },
];

async function main() {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('❌ No API key found!');
    console.error('   Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable.');
    console.error('   Example: export GOOGLE_API_KEY="AIza..."');
    process.exit(1);
  }

  console.log('🚀 Testing Gemini 2.5 Flash API\n');
  console.log('API Key:', apiKey.slice(0, 8) + '...' + apiKey.slice(-4));
  console.log('');

  const provider = new GeminiProvider();
  await provider.initialize({
    apiKey,
    model: 'gemini-2.5-flash',
  });

  console.log('Available models:', await provider.getModels());
  console.log('');

  let passed = 0;
  let failed = 0;

  for (const test of TESTS) {
    console.log(`\n📋 Test: ${test.name}`);
    console.log('─'.repeat(40));

    try {
      const success = await runWithRetry(() => test.run(provider), test.name);
      if (success) {
        console.log(`✅ PASSED`);
        passed++;
      } else {
        console.log(`❌ FAILED (unexpected result)`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ FAILED: ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(40));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
