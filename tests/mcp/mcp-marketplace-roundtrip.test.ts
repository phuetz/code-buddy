import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CodeBuddyMCPServer } from '../../src/mcp/mcp-server.js';

// We override CodeBuddyMCPServer's start to use InMemoryTransport for the test
class TestMCPServer extends CodeBuddyMCPServer {
  async startInMemory(): Promise<InMemoryTransport> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const internals = this as unknown as {
      mcpServer: { connect: (transport: InMemoryTransport) => Promise<void> };
      running: boolean;
      transport: InMemoryTransport | null;
    };
    await internals.mcpServer.connect(serverTransport);
    internals.running = true;
    internals.transport = serverTransport;
    
    return clientTransport;
  }
}

describe('Marketplace Roundtrip', () => {
  let mcpServer: TestMCPServer;
  let client: Client;

  beforeEach(async () => {
    mcpServer = new TestMCPServer();
    const clientTransport = await mcpServer.startInMemory();
    
    client = new Client({
      name: 'marketplace-client',
      version: '1.0.0',
    }, {
      capabilities: { tools: {} },
    });
    
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await mcpServer.stop();
  });

  it('should complete a full roundtrip for tool discovery and execution', async () => {
    // 1. Discover tools (Marketplace asks for what tools we provide)
    const { tools } = await client.listTools();
    
    // We should see the tools exposed by Code Buddy
    expect(tools.length).toBeGreaterThan(7);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('list_directory');
    expect(toolNames).not.toContain('bash');
    expect(toolNames).not.toContain('write_file');
    expect(tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
    const readFile = tools.find(tool => tool.name === 'read_file');
    expect(readFile?.inputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['path']),
      properties: expect.objectContaining({
        path: expect.objectContaining({ type: 'string' }),
      }),
    });
    
    // 2. Execute a tool (Marketplace requests a tool execution)
    // We'll execute list_directory against the current directory
    const result = await client.callTool({
      name: 'list_directory',
      arguments: { path: __dirname },
    });

    // 3. Verify Result (Marketplace receives result)
    expect(result.content).toBeDefined();
    const textBlock = result.content.find(block => block.type === 'text');
    expect(textBlock?.type === 'text' ? textBlock.text : '').toContain(
      'mcp-marketplace-roundtrip.test.ts',
    );
    expect(result.isError).toBeFalsy();
  });
});
