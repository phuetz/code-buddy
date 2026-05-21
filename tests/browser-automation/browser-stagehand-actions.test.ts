import { BrowserTool } from '../../src/browser-automation/browser-tool.js';

function createToolWithManager(manager: Record<string, unknown>): BrowserTool {
  const tool = new BrowserTool();
  (tool as unknown as { manager: Record<string, unknown> }).manager = manager;
  return tool;
}

describe('BrowserTool Stagehand-like actions', () => {
  it('observes a page with an accessibility snapshot by default', async () => {
    const takeSnapshot = jest.fn().mockResolvedValue({
      id: 'snap-1',
      timestamp: new Date(),
      url: 'https://example.com',
      title: 'Example',
      elements: [],
      elementMap: new Map(),
      viewport: { width: 1280, height: 720 },
      valid: true,
      ttl: 30000,
      format: 'ai',
    });
    const manager = {
      takeSnapshot,
      toTextRepresentation: jest.fn().mockReturnValue('[1] button: "Se connecter"'),
    };
    const tool = createToolWithManager(manager);

    const result = await tool.execute({ action: 'observe' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Observation snapshot');
    expect(result.output).toContain('Se connecter');
    expect(takeSnapshot).toHaveBeenCalledWith({
      interactiveOnly: false,
      includeHidden: undefined,
      maxElements: 80,
    });
  });

  it('extracts searchable page state for internet workflows', async () => {
    const manager = {
      evaluate: jest.fn().mockResolvedValue({
        success: true,
        value: {
          url: 'https://example.com/about',
          title: 'About Example',
          headings: ['About us'],
          actions: ['Contact sales'],
          fields: [],
          links: [{ text: 'Team', href: 'https://example.com/team' }],
          text: 'About us\nOur founders are Ada and Grace.\nContact sales for details.',
          textLength: 63,
        },
      }),
    };
    const tool = createToolWithManager(manager);

    const result = await tool.execute({ action: 'extract', query: 'founders' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Extracted: About Example');
    expect(result.output).toContain('Our founders are Ada and Grace.');
    expect(result.output).toContain('Contact sales');
    expect(result.data).toMatchObject({
      query: 'founders',
      matches: ['Our founders are Ada and Grace.'],
    });
  });

  it('returns persistence suggestions when extracted evidence is marked proven', async () => {
    const manager = {
      evaluate: jest.fn().mockResolvedValue({
        success: true,
        value: {
          url: 'https://example.com/about',
          title: 'About Example',
          headings: ['About us'],
          actions: ['Contact sales'],
          fields: [],
          links: [],
          text: 'About us\nOur founders are Ada and Grace.\nContact sales for details.',
          textLength: 63,
        },
      }),
    };
    const tool = createToolWithManager(manager);

    const result = await tool.execute({
      action: 'extract',
      query: 'founders',
      proofGoal: 'verify company founders',
      persistWhenProven: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Persistence suggestions available: remember, lessons_add');
    expect(result.data).toMatchObject({
      persistenceSuggestions: [
        { tool: 'remember' },
        { tool: 'lessons_add' },
      ],
    });
  });

  it('returns a passing assertion when expected text is present', async () => {
    const manager = {
      evaluate: jest.fn().mockResolvedValue({
        success: true,
        value: {
          url: 'https://example.com/login',
          title: 'Login',
          text: 'Welcome. Se connecter pour continuer.',
        },
      }),
    };
    const tool = createToolWithManager(manager);

    const result = await tool.execute({ action: 'assert_text', expectedText: 'se connecter' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Assertion passed');
    expect(result.data).toMatchObject({ passed: true, expectedText: 'se connecter' });
  });

  it('returns persistence suggestions after a passing assertion', async () => {
    const manager = {
      evaluate: jest.fn().mockResolvedValue({
        success: true,
        value: {
          url: 'https://example.com/login',
          title: 'Login',
          text: 'Welcome. Se connecter pour continuer.',
        },
      }),
    };
    const tool = createToolWithManager(manager);

    const result = await tool.execute({
      action: 'assert_text',
      expectedText: 'se connecter',
      proofGoal: 'verify login page',
      persistWhenProven: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Persistence suggestions available: remember, lessons_add');
    expect(result.data).toMatchObject({
      persistenceSuggestions: [
        { tool: 'remember' },
        { tool: 'lessons_add' },
      ],
    });
  });

  it('returns a controlled failure when expected text is absent', async () => {
    const manager = {
      evaluate: jest.fn().mockResolvedValue({
        success: true,
        value: {
          url: 'https://example.com/login',
          title: 'Login',
          text: 'Welcome page',
        },
      }),
    };
    const tool = createToolWithManager(manager);

    const result = await tool.execute({ action: 'assert_text', expectedText: 'dashboard' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Expected text not found');
    expect(result.output).toContain('Assertion failed');
    expect(result.data).toMatchObject({ passed: false, expectedText: 'dashboard' });
  });
});
