import { describe, expect, it } from 'vitest';

import {
  findUnexecutedProseToolCall,
  resolveHeadlessTurnExitCode,
} from '../../src/cli/headless-options.js';

const KNOWN = ['create_file', 'str_replace_editor', 'bash'];

describe('findUnexecutedProseToolCall', () => {
  it('detects a whole-line tool call', () => {
    const found = findUnexecutedProseToolCall(
      'create_file(path="hello.txt", content="bonjour")',
      KNOWN,
      [],
    );
    expect(found?.toolName).toBe('create_file');
    expect(resolveHeadlessTurnExitCode(
      'create_file(path="hello.txt", content="bonjour")',
      KNOWN,
      [],
    )).toBe(3);
  });

  it('detects an indented tool call', () => {
    const text = '    create_file(path="hello.txt", content="bonjour")';
    expect(findUnexecutedProseToolCall(text, KNOWN, [])?.toolName).toBe('create_file');
    expect(resolveHeadlessTurnExitCode(text, KNOWN, [])).toBe(3);
  });

  it('detects an XML tool_call wrapper', () => {
    const text = [
      'I will write the file now.',
      '<tool_call>',
      'create_file',
      '<arg>path=hello.txt</arg>',
      '</tool_call>',
    ].join('\n');
    expect(findUnexecutedProseToolCall(text, KNOWN, [])?.toolName).toBe('create_file');
    expect(resolveHeadlessTurnExitCode(text, KNOWN, [])).toBe(3);
  });

  it('detects a JSON tool call object', () => {
    const text = '{"name":"create_file","arguments":{"path":"hello.txt"}}';
    expect(findUnexecutedProseToolCall(text, KNOWN, [])?.toolName).toBe('create_file');
    expect(resolveHeadlessTurnExitCode(text, KNOWN, [])).toBe(3);
  });

  it('does not treat ordinary parenthetical prose as a tool call', () => {
    const text = 'The helper (see notes) should stay at exit 0.';
    expect(findUnexecutedProseToolCall(text, KNOWN, [])).toBeNull();
    expect(resolveHeadlessTurnExitCode(text, KNOWN, [])).toBe(0);
  });

  it('ignores a tool that was already executed', () => {
    const text = 'create_file(path="hello.txt")';
    expect(findUnexecutedProseToolCall(text, KNOWN, ['create_file'])).toBeNull();
    expect(resolveHeadlessTurnExitCode(text, KNOWN, ['create_file'])).toBe(0);
  });
});
