import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeBuddyMCPServer } from '../../src/mcp/mcp-server.js';

const WRITE_ENV = 'CODEBUDDY_MCP_ALLOW_WRITE';
const TOOLS_ENV = 'CODEBUDDY_MCP_TOOLS';
const DESKTOP_CONTROL_ENV = 'CODEBUDDY_MCP_DESKTOP_CONTROL';
const FORBIDDEN_BY_DEFAULT = [
  'apply_patch',
  'bash',
  'code_exec',
  'codebase_replace',
  'create_file',
  'edit_file',
  'execute_code',
  'file_edit',
  'file_write',
  'git',
  'image_edit',
  'interactive_shell',
  'multi_edit',
  'patch',
  'process',
  'shell_docker',
  'shell_exec',
  'shell_git',
  'shell_k8s',
  'shell_process',
  'str_replace_editor',
  'terminal',
  'write_file',
];

describe('CodeBuddyMCPServer registry exposure', () => {
  const previousWriteEnv = process.env[WRITE_ENV];
  const previousToolsEnv = process.env[TOOLS_ENV];
  const previousDesktopControlEnv = process.env[DESKTOP_CONTROL_ENV];

  beforeEach(() => {
    delete process.env[WRITE_ENV];
    delete process.env[TOOLS_ENV];
    delete process.env[DESKTOP_CONTROL_ENV];
  });

  afterEach(() => {
    if (previousWriteEnv === undefined) delete process.env[WRITE_ENV];
    else process.env[WRITE_ENV] = previousWriteEnv;
    if (previousToolsEnv === undefined) delete process.env[TOOLS_ENV];
    else process.env[TOOLS_ENV] = previousToolsEnv;
    if (previousDesktopControlEnv === undefined) delete process.env[DESKTOP_CONTROL_ENV];
    else process.env[DESKTOP_CONTROL_ENV] = previousDesktopControlEnv;
  });

  it('lists a broad read-only surface and no write, shell, or execution tool by default', () => {
    const server = new CodeBuddyMCPServer();
    const tools = server.getExposedToolDefinitions();
    const names = server.getExposedToolNames();

    expect(tools.length).toBeGreaterThan(7);
    expect(names).toEqual(tools.map((tool) => tool.name));
    expect(tools.every((tool) => tool.readOnly)).toBe(true);
    expect(names).toContain('view_file');
    expect(names).toContain('list_directory');
    expect(names).toContain('search');
    expect(FORBIDDEN_BY_DEFAULT.filter((name) => names.includes(name))).toEqual([]);

    const summary = server.getExposureSummary();
    expect(summary.mode).toBe('read-only');
    expect(summary.exposed).toBe(tools.length);
    expect(summary.registryReadOnly).toBe(tools.length);
    expect(summary.registryTotal).toBeGreaterThan(summary.registryReadOnly);
  });

  it('derives MCP argument schemas from the canonical registry', () => {
    const tools = new CodeBuddyMCPServer().getExposedToolDefinitions();
    const readFile = tools.find((tool) => tool.name === 'read_file');

    expect(readFile).toBeDefined();
    expect(readFile?.inputSchema.type).toBe('object');
    expect(readFile?.inputSchema.required).toContain('path');
    expect(readFile?.inputSchema.properties).toMatchObject({
      path: expect.objectContaining({ type: 'string' }),
    });
  });

  it('only adds unsafe registry tools after an explicit allow-write opt-in', () => {
    const defaultFiltered = new CodeBuddyMCPServer({ tools: 'bash' });
    expect(defaultFiltered.getExposedToolNames()).toEqual([]);

    const writeEnabled = new CodeBuddyMCPServer({
      allowWrite: true,
      tools: '{bash,write_file}',
    });
    expect(writeEnabled.getExposedToolNames()).toEqual(['bash', 'write_file']);
    expect(writeEnabled.getExposureSummary().mode).toBe('read-write');

    const patchEnabled = new CodeBuddyMCPServer({
      allowWrite: true,
      tools: 'apply_patch',
    });
    expect(patchEnabled.getExposedToolNames()).toEqual(['apply_patch']);
  });

  it('preserves the 11 historical MCP-only tools behind allow-write', () => {
    const server = new CodeBuddyMCPServer({ allowWrite: true });
    const registryNames = new Set(
      server.getExposedToolDefinitions().map((tool) => tool.name),
    );
    const supplementalNames = server.getExposedToolNames()
      .filter((name) => !registryNames.has(name))
      .sort();

    expect(supplementalNames).toEqual([
      'agent_chat',
      'agent_plan',
      'agent_task',
      'ckg_ingest',
      'ckg_recall',
      'desktop_screenshot',
      'desktop_snapshot',
      'memory_save',
      'memory_search',
      'session_list',
      'session_resume',
    ]);
    expect(server.getExposureSummary().supplementalExposed).toBe(11);
  });

  it('supports environment opt-in and glob filtering', () => {
    process.env[WRITE_ENV] = '1';
    process.env[TOOLS_ENV] = '*_file';

    const names = new CodeBuddyMCPServer().getExposedToolNames();

    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names.every((name) => name.endsWith('_file'))).toBe(true);
  });
});
