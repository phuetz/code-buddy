/**
 * End-to-end integration tests for companion identified tools:
 * 1. Full turn lifecycle: Telegram identified user -> image_generate -> photo delivery -> history suffix -> subsequent turn recall
 * 2. Real ComfyUI execution against loopback 127.0.0.1:8188
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCompanionIdentity } from '../../src/companion/companion-identity.js';
import {
  executeCompanionTool,
} from '../../src/companion/companion-toolset.js';
import { runCompanionChannelTurn } from '../../src/channels/companion-channel-turn.js';
import { FormalToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { registerBuiltinTools } from '../../src/tools/registry/index.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

describe('Companion Channel Integration E2E', () => {
  it('runs complete Telegram identified flow: tool loop, photo delivery simulation, history suffix, next turn', async () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
      CODEBUDDY_SENSORY_ALERT_CHAT: '12345',
    };

    // 1. Identity resolution
    const identity = resolveCompanionIdentity({
      channel: 'telegram',
      chatId: '12345',
      senderId: '12345',
      env,
    });
    expect(identity.role).toBe('owner');

    // 2. Mock channel delivery
    const sentMessages: Array<Record<string, unknown>> = [];
    const mockChannel = {
      type: 'telegram',
      send: vi.fn(async (payload: Record<string, unknown>) => {
        sentMessages.push(payload);
        return { success: true };
      }),
    };

    // 3. Register mock image_generate tool
    const tmpImage = path.join(process.cwd(), `tmp-test-cat-${Date.now()}.png`);
    fs.writeFileSync(tmpImage, Buffer.from('fake-cat-png-content'));

    const registry = FormalToolRegistry.getInstance();
    const existing = registry.get('image_generate');
    registry.register(
      {
        name: 'image_generate',
        description: 'generate image',
        execute: async () => ({
          success: true,
          output: `Image generated at ${tmpImage}`,
          data: { outputPath: tmpImage },
        }),
        getSchema: () => ({
          name: 'image_generate',
          description: 'generate an image',
          parameters: { type: 'object', properties: { prompt: { type: 'string' } } },
        }),
      },
      {
        override: true,
        metadata: {
          name: 'image_generate',
          category: 'media',
          priority: 1,
          keywords: [],
          description: 'generate an image',
          requiresConfirmation: false,
        },
      },
    );

    try {
      // 4. Model simulates requesting image_generate
      let turnStep = 0;
      const chat = vi.fn(async (_messages: CodeBuddyMessage[]) => {
        turnStep++;
        if (turnStep === 1) {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_cat',
                      type: 'function',
                      function: {
                        name: 'image_generate',
                        arguments: JSON.stringify({ prompt: 'un chat roux sur un fauteuil' }),
                      },
                    },
                  ],
                },
              },
            ],
            model: 'test-model',
          } as never;
        }
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Et voilà un adorable chat roux confortablement installé sur son fauteuil !',
              },
            },
          ],
          model: 'test-model',
        } as never;
      });

      const waitingWords: string[] = [];
      const turnResult = await runCompanionChannelTurn({
        apiKey: 'fake-key',
        baseUrl: 'http://127.0.0.1:9999/v1',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Lisa, dessine-moi un chat roux sur un fauteuil' }],
        identity,
        surface: 'telegram',
        env,
        chat,
        onWaitingWord: async (w) => {
          waitingWords.push(w);
        },
      });

      // Assertions on turnResult
      expect(waitingWords).toContain('Je dessine…');
      expect(turnResult.text).toContain('adorable chat roux');
      expect(turnResult.media).toHaveLength(1);
      expect(turnResult.media?.[0].imagePath).toBe(tmpImage);
      expect(turnResult.historySuffix).toBe(`\n[Image générée : ${tmpImage}]`);

      // 5. Telegram delivery
      const deliveredMedia = turnResult.media?.[0];
      if (deliveredMedia) {
        await mockChannel.send({
          channelId: '12345',
          content: turnResult.text,
          attachments: [
            {
              type: 'image',
              filePath: deliveredMedia.imagePath,
              fileName: path.basename(deliveredMedia.imagePath),
              mimeType: 'image/png',
            },
          ],
        });
      }

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      expect(sentMessages[0].content).toContain('adorable chat roux');
      expect(sentMessages[0].attachments).toEqual([
        {
          type: 'image',
          filePath: tmpImage,
          fileName: path.basename(tmpImage),
          mimeType: 'image/png',
        },
      ]);

      // 6. Turn 2: Verify persistence in subsequent turn
      const turn1AssistantContent = `${turnResult.text}${turnResult.historySuffix}`;
      const conversationHistory: CodeBuddyMessage[] = [
        { role: 'user', content: 'Lisa, dessine-moi un chat roux sur un fauteuil' },
        { role: 'assistant', content: turn1AssistantContent },
        { role: 'user', content: 'Tu aimes ce que tu as dessiné ?' },
      ];

      let turn2CalledWithHistory = false;
      const chatTurn2 = vi.fn(async (messages: CodeBuddyMessage[]) => {
        const historyText = JSON.stringify(messages);
        if (historyText.includes(`[Image générée : ${tmpImage}]`)) {
          turn2CalledWithHistory = true;
        }
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Oui, j’adore le pelage roux de ce chat !',
              },
            },
          ],
          model: 'test-model',
        } as never;
      });

      const turn2Result = await runCompanionChannelTurn({
        apiKey: 'fake-key',
        baseUrl: 'http://127.0.0.1:9999/v1',
        model: 'test-model',
        messages: conversationHistory,
        identity,
        surface: 'telegram',
        env,
        chat: chatTurn2,
      });

      expect(turn2CalledWithHistory).toBe(true);
      expect(turn2Result.text).toBe('Oui, j’adore le pelage roux de ce chat !');
    } finally {
      if (existing) {
        registry.register(existing.tool, { override: true, metadata: existing.metadata });
      } else {
        registry.unregister('image_generate');
      }
      try {
        fs.unlinkSync(tmpImage);
      } catch {
        // ignore
      }
    }
  });

  // Skipped to respect non-negotiable guardrail: do not touch running ComfyUI service on 8188
  it.skip('runs real ComfyUI image_generate when ComfyUI server is live on 127.0.0.1:8188', async () => {
    // Check if ComfyUI is live
    let comfyLive = false;
    try {
      const res = await fetch('http://127.0.0.1:8188/system_stats', {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) comfyLive = true;
    } catch {
      comfyLive = false;
    }

    if (!comfyLive) {
      console.log('ComfyUI not live on 127.0.0.1:8188 — skipping live ComfyUI test');
      return;
    }

    const registry = FormalToolRegistry.getInstance();
    registerBuiltinTools(registry);

    const oldComfy = process.env.COMFYUI_URL;
    const oldProvider = process.env.CODEBUDDY_IMAGE_PROVIDER;
    const oldCheckpoint = process.env.COMFYUI_CHECKPOINT;
    process.env.COMFYUI_URL = 'http://127.0.0.1:8188';
    process.env.CODEBUDDY_IMAGE_PROVIDER = 'comfyui';
    process.env.COMFYUI_CHECKPOINT = 'sd_turbo.safetensors';

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true',
      COMFYUI_URL: 'http://127.0.0.1:8188',
      CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
      COMFYUI_CHECKPOINT: 'sd_turbo.safetensors',
    };

    try {
      const identity = { role: 'owner' as const, channel: 'telegram' as const, userId: 'owner-id' };
      const toolResult = await executeCompanionTool(
        'image_generate',
        { prompt: 'un chat roux sur un fauteuil' },
        {
          identity,
          env,
        },
      );

      if (!toolResult.success) {
        console.error('[ComfyUI test error]:', toolResult.error);
      }
      expect(toolResult.success).toBe(true);
      const data = toolResult.data as Record<string, unknown> | undefined;
      const outputPath = (data?.outputPath ?? data?.imagePath) as string | undefined;

      expect(outputPath).toBeDefined();
      expect(typeof outputPath).toBe('string');
      expect(fs.existsSync(outputPath!)).toBe(true);

      const stats = fs.statSync(outputPath!);
      expect(stats.size).toBeGreaterThan(1000); // real non-empty image file

      console.log(`[Real ComfyUI Test] Successfully generated image: ${outputPath} (${stats.size} bytes)`);
    } finally {
      if (oldComfy === undefined) delete process.env.COMFYUI_URL;
      else process.env.COMFYUI_URL = oldComfy;
      if (oldProvider === undefined) delete process.env.CODEBUDDY_IMAGE_PROVIDER;
      else process.env.CODEBUDDY_IMAGE_PROVIDER = oldProvider;
      if (oldCheckpoint === undefined) delete process.env.COMFYUI_CHECKPOINT;
      else process.env.COMFYUI_CHECKPOINT = oldCheckpoint;
    }
  }, 120_000);
});
