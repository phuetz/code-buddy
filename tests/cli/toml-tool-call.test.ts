import { describe, expect, it } from 'vitest';

import {
  findUnexecutedProseToolCall,
  resolveHeadlessTurnExitCode,
} from '../../src/cli/headless-options.js';

const KNOWN = ['create_file', 'str_replace_editor', 'bash'];

describe('findUnexecutedProseToolCall TOML', () => {
  it('detects a TOML tool call name = "create_file"', () => {
    const text = [
      '[tool_call]',
      'name = "create_file"',
      'path = "hello.txt"',
    ].join('\n');
    expect(findUnexecutedProseToolCall(text, KNOWN, [])?.toolName).toBe('create_file');
    expect(resolveHeadlessTurnExitCode(text, KNOWN, [])).toBe(3);
  });
});
