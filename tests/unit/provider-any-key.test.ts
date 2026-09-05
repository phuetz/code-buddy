import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCES = [
  new URL('../../src/integrations/ide/server.ts', import.meta.url),
  new URL('../../src/integrations/mcp/mcp-server.ts', import.meta.url),
  new URL('../../src/integrations/json-rpc/server.ts', import.meta.url),
  new URL('../../src/interpreter/computer/skills.ts', import.meta.url),
  new URL('../../src/mcp/mcp-server.ts', import.meta.url),
  new URL('../../src/tools/ocr-tool.ts', import.meta.url),
  new URL('../../src/agent/prompt-suggestions.ts', import.meta.url),
  new URL('../../src/hooks/smart-hooks.ts', import.meta.url),
  new URL('../../src/hooks/advanced-hooks.ts', import.meta.url),
  new URL('../../src/agent/codebuddy-agent.ts', import.meta.url),
];

describe('any configured provider key is enough', () => {
  it.each(SOURCES.map((url) => [url.pathname.split('/src/')[1] ?? url.pathname, url]))(
    'uses resolveActiveProviderApiKey in %s',
    (_label, url) => {
      const source = readFileSync(url, 'utf8');
      expect(source).toContain('resolveActiveProviderApiKey');
      expect(source).not.toMatch(/const apiKey = process\.env\.GROK_API_KEY/);
    },
  );
});
