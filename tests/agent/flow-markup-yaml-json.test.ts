import { describe, expect, it } from 'vitest';

import { looksLikeUnexecutedToolMarkup } from '../../src/agent/flow/planning-flow.js';

describe('looksLikeUnexecutedToolMarkup', () => {
  it('detects YAML, JSON and name(...) tool markup', () => {
    expect(looksLikeUnexecutedToolMarkup([
      'tool_call:',
      '  name: create_file',
      '  arguments:',
      '    path: hello.txt',
    ].join('\n'))).toBe(true);
    expect(looksLikeUnexecutedToolMarkup(
      '{"name":"create_file","arguments":{"path":"hello.txt"}}',
    )).toBe(true);
    expect(looksLikeUnexecutedToolMarkup(
      'create_file(path="hello.txt", content="bonjour")',
    )).toBe(true);
  });
});
