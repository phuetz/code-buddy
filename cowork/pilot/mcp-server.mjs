#!/usr/bin/env node
/**
 * cowork-pilot MCP (stdio) server — exposes control of the Cowork Electron GUI
 * over the Model Context Protocol. Wraps the shared `CoworkPilot` engine
 * (pilot-core.mjs) as a single lazily-created module-level singleton.
 *
 * IMPORTANT: STDOUT is the MCP transport channel. Never write to it. All
 * logging goes to STDERR via console.error.
 *
 * Run from cowork/pilot/ so Node resolves deps from cowork/node_modules.
 */
process.env.DISPLAY ||= ':10.0';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CoworkPilot, CHATGPT_PROFILE } from './pilot-core.mjs';

// ---- pilot singleton -------------------------------------------------------

let pilot = null; // CoworkPilot | null
let launched = false;

function logErr(...args) {
  console.error('[cowork-mcp]', ...args);
}

function getPilot() {
  if (!pilot) {
    pilot = new CoworkPilot({ log: (line) => logErr(line) });
  }
  return pilot;
}

/** Lazily launch (plain) if a tool that needs the GUI is called pre-launch. */
async function ensureLaunched() {
  if (launched) return;
  await getPilot().launch();
  launched = true;
}

async function stateSummary() {
  try {
    const state = await getPilot().getState();
    return { launched, ...state };
  } catch (err) {
    return { launched, note: `getState failed: ${err?.message || String(err)}` };
  }
}

// ---- result helpers --------------------------------------------------------

const textResult = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
});

const errResult = (err) => ({
  content: [{ type: 'text', text: 'ERROR: ' + (err?.stack || err?.message || String(err)) }],
  isError: true,
});

/** Wrap a handler in try/catch returning the standard error envelope. */
function tool(fn) {
  return async (args) => {
    try {
      return await fn(args || {});
    } catch (err) {
      logErr('tool error:', err?.stack || err);
      return errResult(err);
    }
  };
}

// ---- server ----------------------------------------------------------------

const server = new McpServer({
  name: 'cowork-pilot',
  version: '0.1.0',
});

server.registerTool(
  'cowork_launch',
  {
    title: 'Launch / attach Cowork',
    description:
      'Launch the Cowork Electron GUI (or attach to a running instance over CDP). ' +
      'Idempotent: no-op if already launched. If `real` is set, also configures the ' +
      'real ChatGPT (Codex Responses) provider profile. Returns a state summary.',
    inputSchema: {
      real: z.boolean().optional().describe('Configure the real ChatGPT subscription provider'),
      userDataDir: z.string().optional().describe('Persistent profile dir (default: temp)'),
      attach: z
        .string()
        .optional()
        .describe('CDP endpoint to attach to (e.g. http://localhost:9222) instead of launching'),
    },
  },
  tool(async ({ real, userDataDir, attach }) => {
    if (!launched) {
      // (Re)create the pilot if a userDataDir is requested and none exists yet.
      if (userDataDir && (!pilot || !pilot.userDataDir)) {
        pilot = new CoworkPilot({ userDataDir, log: (line) => logErr(line) });
      }
      const p = getPilot();
      if (attach) {
        await p.attach(attach);
      } else {
        if (userDataDir) p.userDataDir = userDataDir;
        await p.launch();
      }
      launched = true;
      if (real) await p.configureProvider(CHATGPT_PROFILE);
    } else if (real) {
      await getPilot().configureProvider(CHATGPT_PROFILE);
    }
    return textResult(await stateSummary());
  })
);

server.registerTool(
  'cowork_chat',
  {
    title: 'Send a chat prompt',
    description:
      'Send a prompt to the Cowork chat and return {prompt, reply, mode}. ' +
      'Optionally provide a `marker` (text/regex the reply must match for reliable mode) ' +
      'and a `timeoutMs`.',
    inputSchema: {
      prompt: z.string().describe('The chat prompt to send'),
      marker: z.string().optional().describe('Text/regex the assistant reply must match'),
      timeoutMs: z.number().optional().describe('Max wait for the reply (default 180000)'),
    },
  },
  tool(async ({ prompt, marker, timeoutMs }) => {
    await ensureLaunched();
    const opts = {};
    if (marker !== undefined) opts.marker = marker;
    if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
    const result = await getPilot().chat(prompt, opts);
    return textResult(result);
  })
);

server.registerTool(
  'cowork_screenshot',
  {
    title: 'Screenshot the Cowork window',
    description:
      'Capture a screenshot of the Cowork window and return it as an image. ' +
      'If `path` is given, the PNG is also saved there.',
    inputSchema: {
      path: z.string().optional().describe('Optional file path to save the PNG'),
      fullPage: z.boolean().optional().describe('Capture the full page (default true)'),
    },
  },
  tool(async ({ path: filePath, fullPage }) => {
    await ensureLaunched();
    const opts = {};
    if (fullPage !== undefined) opts.fullPage = fullPage;
    const shot = await getPilot().screenshot(filePath, opts);
    const content = [{ type: 'image', data: shot.base64, mimeType: 'image/png' }];
    content.push({
      type: 'text',
      text: JSON.stringify({ path: shot.path, bytes: shot.bytes }),
    });
    return { content };
  })
);

server.registerTool(
  'cowork_eval',
  {
    title: 'Evaluate JS in the renderer',
    description:
      'Evaluate a JavaScript expression/statements in the Cowork renderer and return the ' +
      'JSON-serialised result.',
    inputSchema: {
      js: z.string().describe('JavaScript expression or statements to evaluate'),
    },
  },
  tool(async ({ js }) => {
    await ensureLaunched();
    const result = await getPilot().evaluate(js);
    return textResult(result === undefined ? null : result);
  })
);

server.registerTool(
  'cowork_ipc',
  {
    title: 'Invoke a Cowork IPC handler',
    description: 'Call window.electronAPI.invoke({type, payload}) in the renderer.',
    inputSchema: {
      type: z.string().describe('IPC message type'),
      payload: z.record(z.string(), z.unknown()).optional().describe('IPC payload object'),
    },
  },
  tool(async ({ type, payload }) => {
    await ensureLaunched();
    const result = await getPilot().ipc(type, payload || {});
    return textResult(result === undefined ? null : result);
  })
);

server.registerTool(
  'cowork_get_state',
  {
    title: 'Get Cowork state snapshot',
    description: 'Return a best-effort state snapshot (store + headings + url).',
    inputSchema: {},
  },
  tool(async () => {
    await ensureLaunched();
    return textResult(await getPilot().getState());
  })
);

server.registerTool(
  'cowork_click',
  {
    title: 'Click an element',
    description:
      'Click an element. Selector prefixes: testid=, text=, role=Name, or raw CSS.',
    inputSchema: {
      selector: z.string().describe('Selector (testid= / text= / role= / CSS)'),
    },
  },
  tool(async ({ selector }) => {
    await ensureLaunched();
    const ok = await getPilot().click(selector);
    return textResult({ clicked: selector, ok });
  })
);

server.registerTool(
  'cowork_fill',
  {
    title: 'Fill an input',
    description:
      'Fill an input element with text. Selector prefixes: testid=, text=, role=Name, or raw CSS.',
    inputSchema: {
      selector: z.string().describe('Selector (testid= / text= / role= / CSS)'),
      text: z.string().describe('Text to fill into the element'),
    },
  },
  tool(async ({ selector, text }) => {
    await ensureLaunched();
    const ok = await getPilot().fill(selector, text);
    return textResult({ filled: selector, ok });
  })
);

server.registerTool(
  'cowork_list_bundles',
  {
    title: 'List Test Runner bundles',
    description: 'List the bundle rows currently in the Cowork Test Runner catalog.',
    inputSchema: {},
  },
  tool(async () => {
    await ensureLaunched();
    return textResult(await getPilot().listTestBundles());
  })
);

server.registerTool(
  'cowork_run_bundle',
  {
    title: 'Run a Test Runner bundle',
    description: 'Run a Test Runner bundle by id and return {id, status, result}.',
    inputSchema: {
      id: z.string().describe('Bundle id'),
      timeoutMs: z.number().optional().describe('Max wait for the run (default 560000)'),
    },
  },
  tool(async ({ id, timeoutMs }) => {
    await ensureLaunched();
    const opts = {};
    if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
    return textResult(await getPilot().runTestBundle(id, opts));
  })
);

server.registerTool(
  'cowork_get_config',
  {
    title: 'Get Cowork config',
    description: 'Return the current Cowork config (window.electronAPI.config.get()).',
    inputSchema: {},
  },
  tool(async () => {
    await ensureLaunched();
    return textResult(await getPilot().getConfig());
  })
);

server.registerTool(
  'cowork_close',
  {
    title: 'Close Cowork',
    description: 'Close the Cowork GUI and reset the pilot singleton.',
    inputSchema: {},
  },
  tool(async () => {
    if (pilot) {
      await pilot.close();
    }
    pilot = null;
    launched = false;
    return textResult({ closed: true });
  })
);

// ---- lifecycle -------------------------------------------------------------

async function shutdown(signal) {
  logErr(`received ${signal}, shutting down`);
  try {
    if (pilot) await pilot.close();
  } catch (err) {
    logErr('shutdown close error:', err?.message || err);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logErr('cowork-pilot MCP server ready on stdio');
}

main().catch((err) => {
  logErr('fatal:', err?.stack || err);
  process.exit(1);
});
