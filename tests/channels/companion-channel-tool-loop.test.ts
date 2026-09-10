import { describe, it, expect, vi } from 'vitest';
import { runCompanionChannelTurn } from '../../src/channels/companion-channel-turn.js';
import type { CompanionIdentity } from '../../src/companion/companion-identity.js';
import type { CodeBuddyResponse, CodeBuddyTool } from '../../src/codebuddy/client.js';

describe('runCompanionChannelTurn with tools', () => {
  const ownerIdentity: CompanionIdentity = {
    role: 'owner',
    channel: 'telegram',
    confidence: 'high',
    reason: 'test',
  };

  const guestIdentity: CompanionIdentity = {
    role: 'guest',
    channel: 'telegram',
    confidence: 'none',
    reason: 'test',
  };

  it('keeps single chat call with tools=[] when circuit-breaker is OFF', async () => {
    const chatCalls: Array<{ tools: CodeBuddyTool[]; opts: any }> = [];
    const result = await runCompanionChannelTurn({
      apiKey: 'k',
      baseUrl: 'http://localhost',
      model: 'm',
      messages: [{ role: 'user', content: 'dessine moi un chat' }],
      identity: ownerIdentity,
      env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'false' },
      chat: async (messages, tools, opts) => {
        chatCalls.push({ tools, opts });
        return {
          model: 'm',
          choices: [{ message: { role: 'assistant', content: 'Je ne peux pas dessiner.' }, finish_reason: 'stop' }],
        };
      },
    });

    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0].tools).toEqual([]);
    expect(chatCalls[0].opts.tool_choice).toBe('none');
    expect(result.text).toBe('Je ne peux pas dessiner.');
    expect(result.media).toBeUndefined();
    expect(result.executedTools).toBeUndefined();
  });

  it('keeps single chat call with tools=[] when interlocutor is guest', async () => {
    const chatCalls: Array<{ tools: CodeBuddyTool[]; opts: any }> = [];
    const result = await runCompanionChannelTurn({
      apiKey: 'k',
      baseUrl: 'http://localhost',
      model: 'm',
      messages: [{ role: 'user', content: 'dessine moi un chat' }],
      identity: guestIdentity,
      env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      chat: async (messages, tools, opts) => {
        chatCalls.push({ tools, opts });
        return {
          model: 'm',
          choices: [{ message: { role: 'assistant', content: 'Bonjour invité.' }, finish_reason: 'stop' }],
        };
      },
    });

    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0].tools).toEqual([]);
    expect(chatCalls[0].opts.tool_choice).toBe('none');
    expect(result.text).toBe('Bonjour invité.');
  });

  it('executes image tool, calls waiting word, delivers photo, and tracks history', async () => {
    const waitingWords: string[] = [];
    const delivered: any[] = [];
    let turnCount = 0;

    const result = await runCompanionChannelTurn({
      apiKey: 'k',
      baseUrl: 'http://localhost',
      model: 'm',
      messages: [{ role: 'user', content: 'Lisa, dessine-moi un chat roux sur un fauteuil' }],
      identity: ownerIdentity,
      surface: 'telegram',
      env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      onWaitingWord: (word) => {
        waitingWords.push(word);
      },
      deliverMedia: async (media) => {
        delivered.push(media);
      },
      executeTool: async (name, args) => {
        expect(name).toBe('image_generate');
        expect(args.prompt).toContain('chat roux');
        return {
          success: true,
          output: JSON.stringify({ outputPath: '/tmp/test-images/chat_roux.png' }),
          data: { imagePath: '/tmp/test-images/chat_roux.png' },
        };
      },
      chat: async (messages, tools, opts) => {
        turnCount += 1;
        if (turnCount === 1) {
          expect(tools.length).toBeGreaterThan(0);
          expect(opts.tool_choice).toBe('auto');
          // Model triggers image_generate
          return {
            model: 'm',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_img_123',
                      type: 'function',
                      function: {
                        name: 'image_generate',
                        arguments: JSON.stringify({ prompt: 'un chat roux sur un fauteuil' }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          };
        }
        // Round 2: LLM receives tool result and produces final caption
        const lastMsg = messages[messages.length - 1];
        expect(lastMsg.role).toBe('tool');
        expect(lastMsg.tool_call_id).toBe('call_img_123');
        return {
          model: 'm',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Voilà ton petit chat roux bien installé sur son fauteuil !',
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    });

    expect(waitingWords).toContain('Je dessine…');
    expect(result.text).toBe('Voilà ton petit chat roux bien installé sur son fauteuil !');
    expect(result.media).toHaveLength(1);
    expect(result.media![0].imagePath).toBe('/tmp/test-images/chat_roux.png');
    expect(result.historySuffix).toContain('[Image générée : /tmp/test-images/chat_roux.png]');

    expect(delivered).toHaveLength(1);
    expect(delivered[0].imagePath).toBe('/tmp/test-images/chat_roux.png');
    expect(delivered[0].caption).toBe('Voilà ton petit chat roux bien installé sur son fauteuil !');
  });

  it('executes remind tool and formats reminder history note', async () => {
    let turnCount = 0;
    const waitingWords: string[] = [];

    const result = await runCompanionChannelTurn({
      apiKey: 'k',
      baseUrl: 'http://localhost',
      model: 'm',
      messages: [{ role: 'user', content: 'rappelle-moi le train demain à 9h' }],
      identity: ownerIdentity,
      env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      onWaitingWord: (w) => { waitingWords.push(w); },
      executeTool: async (name, args) => {
        expect(name).toBe('remind');
        return {
          success: true,
          output: `Reminder set: "${args.label}" at ${args.time}`,
          data: { id: 'rem_1', label: args.label, time: args.time },
        };
      },
      chat: async (messages, tools, opts) => {
        turnCount += 1;
        if (turnCount === 1) {
          return {
            model: 'm',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_remind_456',
                      type: 'function',
                      function: {
                        name: 'remind',
                        arguments: JSON.stringify({ label: 'train demain', time: '09:00' }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          };
        }
        return {
          model: 'm',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'C’est noté ! Je te rappellerai le train demain à 9h.',
              },
              finish_reason: 'stop',
            },
          ],
        };
      },
    });

    expect(waitingWords).toContain('Je note ton rappel…');
    expect(result.text).toBe('C’est noté ! Je te rappellerai le train demain à 9h.');
    expect(result.historySuffix).toContain('[Rappel créé : train demain à 09:00]');
    expect(result.executedTools).toHaveLength(1);
    expect(result.executedTools![0].name).toBe('remind');
  });
});
