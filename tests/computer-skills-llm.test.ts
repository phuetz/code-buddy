/**
 * Tests for ComputerSkills — LLM step execution.
 */

// We mock the LLM client to avoid real API calls

import { ComputerSkills } from '../src/interpreter/computer/skills.js';

jest.mock('../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(function() { return {
    chat: jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'Paris' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  }; }),
}));

describe('ComputerSkills — LLM step', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, GROK_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.clearAllMocks();
  });

  it('executes llm step and returns content + tokens', async () => {
    const skills = new ComputerSkills({ enableBuiltin: false });

    // Register a minimal skill with an llm step
    const skill = {
      id: 'test-llm',
      name: 'Test LLM',
      description: 'Test',
      version: '1.0.0',
      tags: ['test'],
      isBuiltin: false,
      isDefault: false,
      parameters: [{ name: 'question', type: 'string' as const, description: 'The question', required: true }],
      steps: [
        {
          type: 'llm' as const,
          content: 'What is the capital of France? Answer in one word.',
          systemPrompt: 'You are a geography expert. Answer concisely.',
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (skills as any)['skills'].set(skill.id, skill);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (skills as any)['loaded'] = true;

    const result = await skills.run('test-llm', { question: 'capital?' });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    const stepOutput = result.steps[0]?.output as { content: string; tokens: object };
    expect(stepOutput.content).toBe('Paris');
    expect(stepOutput.tokens).toMatchObject({ input: 10, output: 5, total: 15 });
  });

  it('uses built-in llm-ask skill when API key present', async () => {
    const skills = new ComputerSkills();
    await skills.load();

    const result = await skills.run('llm-ask', {
      prompt: 'What is the capital of France?',
      systemPrompt: 'Be concise.',
    });

    expect(result.success).toBe(true);
    expect(result.skillId).toBe('llm-ask');
    const output = result.output as { content: string };
    expect(output.content).toBe('Paris');
  });

  it('throws when GROK_API_KEY is missing', async () => {
    delete process.env.GROK_API_KEY;
    const skills = new ComputerSkills();
    await skills.load();

    const result = await skills.run('llm-ask', { prompt: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('GROK_API_KEY');
  });

  it('lists llm-ask in available skills', async () => {
    const skills = new ComputerSkills();
    await skills.load();

    const list = skills.list({ search: 'llm' });
    const llmAsk = list.find(s => s.id === 'llm-ask');
    expect(llmAsk).toBeDefined();
    expect(llmAsk?.tags).toContain('llm');
  });
});
