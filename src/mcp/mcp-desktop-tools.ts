/**
 * MCP Desktop Tools — expose Code Buddy's desktop-automation over the MCP server.
 *
 * This is the cross-platform equivalent of mediar-ai's Terminator MCP agent, but
 * backed by Code Buddy's own already-validated automation stack (nut-js input +
 * AT-SPI/accessibility snapshots + screenshots), so it works on Linux/macOS/Windows
 * without porting a Windows-only framework.
 *
 * Safety model (mirrors the peer.tool / execute_code RPC opt-in pattern):
 *  - Read-only tools are ALWAYS exposed: `desktop_screenshot`, `desktop_snapshot`.
 *  - Control tools that actuate the real desktop (`desktop_click`, `desktop_type`,
 *    `desktop_move_mouse`, `desktop_key`) are GATED behind
 *    CODEBUDDY_MCP_DESKTOP_CONTROL=1 (fail-closed: not registered when unset).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { DesktopAutomationManager } from '../desktop-automation/automation-manager.js';
import type { MouseButton } from '../desktop-automation/types.js';

/** Control tools actuate the real desktop — opt-in only. */
export function desktopControlEnabled(): boolean {
  const v = process.env['CODEBUDDY_MCP_DESKTOP_CONTROL'];
  return v === '1' || v === 'true';
}

// Lazily initialize a single automation manager (native provider → mock fallback).
let managerPromise: Promise<DesktopAutomationManager> | null = null;
async function getManager(): Promise<DesktopAutomationManager> {
  if (!managerPromise) {
    managerPromise = (async () => {
      const { getDesktopAutomation } = await import('../desktop-automation/index.js');
      const mgr = getDesktopAutomation({ provider: 'native', fallbackProviders: ['nutjs', 'mock'] });
      await mgr.initialize();
      return mgr;
    })().catch((err) => {
      managerPromise = null; // allow retry on next call
      throw err;
    });
  }
  return managerPromise;
}

/** Reset the lazily-created manager (tests). */
export function resetDesktopMcpTools(): void {
  managerPromise = null;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

/**
 * Register desktop-automation tools with the MCP server.
 */
export function registerDesktopTools(
  server: McpServer,
  shouldRegister: (name: string) => boolean = () => true,
): void {
  // ---- Read-only: screenshot ------------------------------------------------
  if (shouldRegister('desktop_screenshot')) server.tool(
    'desktop_screenshot',
    'Capture a screenshot of the desktop (fullscreen by default, or a region). Returns the saved PNG path and dimensions. Read-only.',
    {
      region: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .optional()
        .describe('Optional region {x,y,width,height}; omit for fullscreen'),
      output_path: z.string().optional().describe('Optional output PNG path'),
    },
    async (args) => {
      try {
        const { ScreenshotTool } = await import('../tools/screenshot-tool.js');
        const tool = new ScreenshotTool();
        const result = args.region
          ? await tool.captureRegion(args.region.x, args.region.y, args.region.width, args.region.height)
          : await tool.capture({ fullscreen: true, ...(args.output_path ? { outputPath: args.output_path } : {}) });
        if (!result.success) return fail(`Screenshot failed: ${result.error ?? 'unknown error'}`);
        return ok(result.output ?? JSON.stringify(result.data ?? {}, null, 2));
      } catch (err) {
        return fail(`Screenshot error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ---- Read-only: accessibility snapshot -----------------------------------
  if (shouldRegister('desktop_snapshot')) server.tool(
    'desktop_snapshot',
    'Enumerate on-screen UI elements (accessibility tree) with numeric refs, roles, labels, and click coordinates. Read-only. Use the returned coordinates with desktop_click.',
    {
      interactive_only: z.boolean().optional().describe('Only return interactive elements (buttons, inputs, links)'),
      max_elements: z.number().optional().describe('Cap the number of elements returned (default 60, max 200)'),
      window: z.string().optional().describe('Window title to scope to (default: whole desktop / focused window)'),
    },
    async (args) => {
      try {
        const { getSmartSnapshotManager } = await import('../desktop-automation/smart-snapshot.js');
        const snap = await getSmartSnapshotManager().takeSnapshot({
          ...(args.interactive_only ? { interactiveOnly: true } : {}),
          ...(args.window ? { window: args.window } : {}),
        });
        const cap = Math.max(1, Math.min(200, args.max_elements ?? 60));
        const shown = snap.elements.slice(0, cap);
        const lines = shown.map(
          (el) =>
            `[${el.ref}] ${el.role} ${JSON.stringify(el.name)}${el.interactive ? ' (interactive)' : ''} @ ${Math.round(el.center.x)},${Math.round(el.center.y)} [${el.bounds.width}x${el.bounds.height}]`,
        );
        const header = `${snap.elements.length} element(s) on "${snap.source}" (${snap.screenSize.width}x${snap.screenSize.height}); showing ${shown.length}:`;
        return ok(`${header}\n${lines.join('\n')}`);
      } catch (err) {
        return fail(`Snapshot error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ---- Control tools (opt-in, actuate the real desktop) --------------------
  if (!desktopControlEnabled()) {
    logger.debug(
      'MCP desktop control tools disabled. Set CODEBUDDY_MCP_DESKTOP_CONTROL=1 to expose desktop_click/type/move_mouse/key.',
    );
    return;
  }

  if (shouldRegister('desktop_click')) server.tool(
    'desktop_click',
    'Click the mouse at screen coordinates. Requires CODEBUDDY_MCP_DESKTOP_CONTROL=1. Actuates the real desktop.',
    {
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
      button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default left)'),
      double: z.boolean().optional().describe('Double-click when true'),
    },
    async (args) => {
      try {
        const mgr = await getManager();
        await mgr.click(args.x, args.y, {
          ...(args.button ? { button: args.button as MouseButton } : {}),
          ...(args.double ? { clicks: 2 } : {}),
        });
        return ok(`Clicked ${args.button ?? 'left'}${args.double ? ' (double)' : ''} at ${args.x},${args.y}.`);
      } catch (err) {
        return fail(`Click error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  if (shouldRegister('desktop_move_mouse')) server.tool(
    'desktop_move_mouse',
    'Move the mouse cursor to screen coordinates. Requires CODEBUDDY_MCP_DESKTOP_CONTROL=1.',
    { x: z.number().describe('X coordinate'), y: z.number().describe('Y coordinate') },
    async (args) => {
      try {
        const mgr = await getManager();
        await mgr.moveMouse(args.x, args.y);
        return ok(`Moved mouse to ${args.x},${args.y}.`);
      } catch (err) {
        return fail(`Move error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  if (shouldRegister('desktop_type')) server.tool(
    'desktop_type',
    'Type text at the current focus. Requires CODEBUDDY_MCP_DESKTOP_CONTROL=1. Actuates the real keyboard.',
    { text: z.string().describe('Text to type') },
    async (args) => {
      try {
        const mgr = await getManager();
        await mgr.type(args.text);
        return ok(`Typed ${args.text.length} character(s).`);
      } catch (err) {
        return fail(`Type error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  if (shouldRegister('desktop_key')) server.tool(
    'desktop_key',
    'Press a key (optionally with modifiers), e.g. "enter", "escape", "tab", "f5". Requires CODEBUDDY_MCP_DESKTOP_CONTROL=1.',
    {
      key: z.string().describe('Key name, e.g. enter, escape, tab, a, f5'),
      modifiers: z
        .array(z.enum(['ctrl', 'alt', 'shift', 'meta', 'cmd', 'win']))
        .optional()
        .describe('Modifier keys to hold'),
    },
    async (args) => {
      try {
        const mgr = await getManager();
        await mgr.keyPress(
          args.key,
          args.modifiers && args.modifiers.length > 0
            ? { modifiers: args.modifiers as unknown as import('../desktop-automation/types.js').ModifierKey[] }
            : undefined,
        );
        return ok(`Pressed ${args.modifiers?.length ? args.modifiers.join('+') + '+' : ''}${args.key}.`);
      } catch (err) {
        return fail(`Key error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
