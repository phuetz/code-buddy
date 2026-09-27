import { describe, expect, it } from 'vitest';
import { runCompanionChannelTurn } from '../../src/channels/companion-channel-turn.js';
import type { CodeBuddyResponse } from '../../src/codebuddy/client.js';
import type { CompanionIdentity } from '../../src/companion/companion-identity.js';

const owner: CompanionIdentity = { role: 'owner', channel: 'telegram', confidence: 'high', reason: 'test' };

describe('companion partial tool outcome', () => {
  it('names only the image produced when the requested email has no tool', async () => {
    let round = 0;
    const result = await runCompanionChannelTurn({
      apiKey: 'k', baseUrl: 'http://localhost', model: 'm',
      messages: [{ role: 'user', content: 'Crée une image et envoie-la par e-mail.' }],
      identity: owner,
      surface: 'telegram',
      env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true', CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'false' },
      deliverMedia: async () => {},
      executeTool: async () => ({ success: true, output: 'Image créée', data: { imagePath: '/tmp/image.png' } }),
      chat: async (): Promise<CodeBuddyResponse> => {
        round++;
        return round === 1
          ? { model: 'm', choices: [{ message: { role: 'assistant', content: '', tool_calls: [
            { id: 'i', type: 'function', function: { name: 'image_generate', arguments: '{"prompt":"un chat"}' } },
          ] }, finish_reason: 'tool_calls' }] }
          : { model: 'm', choices: [{ message: { role: 'assistant', content: 'C’est fait !' }, finish_reason: 'stop' }] };
      },
    });
    expect(result.executedTools).toMatchObject([{ name: 'image_generate', success: true }]);
    expect(result.text).toMatch(/image/i);
    expect(result.text).not.toMatch(/c.est fait|e-mail envoy/i);
  });

  it.each(['', 'C’est fait !'])('does not claim complete success after a failed tool with model text %j', async (modelText) => {
    let round = 0;
    const result = await runCompanionChannelTurn({
      apiKey: 'k', baseUrl: 'http://localhost', model: 'm',
      messages: [{ role: 'user', content: 'Donne la météo et recherche le trafic.' }],
      identity: owner,
      env: { CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true', CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'false' },
      executeTool: async (name) => name === 'weather'
        ? { success: true, output: 'Soleil' }
        : { success: false, error: 'Recherche indisponible' },
      chat: async (): Promise<CodeBuddyResponse> => {
        round++;
        if (round === 1) return { model: 'm', choices: [{ message: { role: 'assistant', content: '', tool_calls: [
          { id: 'w', type: 'function', function: { name: 'weather', arguments: '{"location":"Paris"}' } },
          { id: 's', type: 'function', function: { name: 'web_search', arguments: '{"query":"trafic"}' } },
        ] }, finish_reason: 'tool_calls' }] };
        return { model: 'm', choices: [{ message: { role: 'assistant', content: modelText }, finish_reason: 'stop' }] };
      },
    });
    expect(result.executedTools).toMatchObject([{ name: 'weather', success: true }, { name: 'web_search', success: false }]);
    expect(result.text).not.toMatch(/c.est fait/i);
    expect(result.text).toContain('weather');
    expect(result.text).toContain('web_search');
    expect(result.text).toContain('Recherche indisponible');
  });
});
