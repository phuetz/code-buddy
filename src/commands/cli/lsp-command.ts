/**
 * LSP Command — Language Server Protocol diagnostics
 *
 * Exposes the existing internal LSP client (`src/lsp/lsp-client.ts`) as a
 * user-facing CLI for parity with upstream `hermes lsp`.
 *
 * Usage:
 *   buddy lsp status                 # list supported LSP servers + availability
 *   buddy lsp status --json
 *   buddy lsp diagnostics <file>     # diagnostics for a file via the LSP client
 *   buddy lsp diagnostics <file> --json
 *
 * Reuses the existing singleton client (`getLSPClient`) and the built-in
 * default server configs (`LSPClient.getDefaultConfig`). It does NOT implement
 * a new client. When a capability is unavailable (unsupported file type or the
 * required server binary is not installed), it fails cleanly with a clear
 * message and a non-zero exit code.
 */

import type { Command } from 'commander';
import * as fs from 'fs';
import { logger } from '../../utils/logger.js';
import { commandExists } from '../../utils/command-exists.js';
import {
  getLSPClient,
  LSPClient,
  type LSPLanguage,
  type LSPDiagnostic,
} from '../../lsp/lsp-client.js';

// ============================================================================
// Helpers
// ============================================================================

interface ServerStatus {
  language: LSPLanguage;
  command: string;
  args: string[];
  available: boolean;
}

async function gatherServerStatus(): Promise<ServerStatus[]> {
  const languages = LSPClient.getSupportedLanguages();
  const checks = await Promise.all(
    languages.map(async (language) => {
      const config = LSPClient.getDefaultConfig(language);
      if (!config) {
        return null;
      }
      const available = await commandExists(config.command);
      return {
        language,
        command: config.command,
        args: config.args,
        available,
      } satisfies ServerStatus;
    }),
  );
  return checks.filter((entry): entry is ServerStatus => entry !== null);
}

function formatDiagnostic(diag: LSPDiagnostic): string {
  const where = `${diag.file}:${diag.line}:${diag.column}`;
  const source = diag.source ? ` [${diag.source}]` : '';
  return `  ${diag.severity.toUpperCase()} ${where}${source} — ${diag.message}`;
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerLspCommands(program: Command): void {
  const lsp = program
    .command('lsp')
    .description('Language Server Protocol diagnostics (type errors, hover, references)');

  lsp
    .command('status')
    .description('List supported LSP servers and whether their binaries are installed')
    .option('--json', 'Emit machine-readable JSON')
    .action(async (options: { json?: boolean }) => {
      const statuses = await gatherServerStatus();

      if (options.json) {
        console.log(JSON.stringify({ servers: statuses }, null, 2));
        return;
      }

      const installed = statuses.filter((s) => s.available);
      console.log(`\nLSP Servers (${installed.length}/${statuses.length} installed):\n`);
      for (const status of statuses) {
        const marker = status.available ? 'ok ' : 'missing';
        const cmd = [status.command, ...status.args].join(' ');
        console.log(`  [${marker}] ${status.language.padEnd(12)} ${cmd}`);
      }
      if (installed.length === 0) {
        console.log(
          '\nNo LSP servers detected. Install one (e.g. `npm i -g typescript-language-server`) to enable diagnostics.',
        );
      }
      console.log('');
    });

  lsp
    .command('diagnostics')
    .description('Show diagnostics (type errors / warnings) for a file via the LSP client')
    .argument('<file>', 'Path to the file to analyze')
    .option('--json', 'Emit machine-readable JSON')
    .action(async (file: string, options: { json?: boolean }) => {
      const emitJson = options.json === true;

      // 1. File must exist.
      if (!fs.existsSync(file)) {
        if (emitJson) {
          console.log(JSON.stringify({ error: 'file_not_found', file }));
        } else {
          console.error(`File not found: ${file}`);
        }
        process.exit(1);
        return;
      }

      const client = getLSPClient();

      // 2. Language must be supported by the LSP layer.
      const language = client.detectLanguage(file);
      if (!language) {
        if (emitJson) {
          console.log(JSON.stringify({ error: 'unsupported_file_type', file }));
        } else {
          console.error(`Unsupported file type for LSP diagnostics: ${file}`);
        }
        process.exit(1);
        return;
      }

      // 3. The required server binary must be installed. getDiagnostics() returns
      //    [] both when the binary is missing and when there are genuinely zero
      //    diagnostics, so we must precheck to distinguish the two.
      const config = LSPClient.getDefaultConfig(language);
      if (!config) {
        if (emitJson) {
          console.log(JSON.stringify({ error: 'no_server_config', file, language }));
        } else {
          console.error(`No LSP server configured for language '${language}'.`);
        }
        process.exit(1);
        return;
      }

      const available = await commandExists(config.command);
      if (!available) {
        if (emitJson) {
          console.log(
            JSON.stringify({ error: 'server_not_installed', file, language, command: config.command }),
          );
        } else {
          console.error(
            `LSP server for ${language} is not installed: '${config.command}' not found in PATH.\n` +
              `Install it to enable diagnostics (run \`buddy lsp status\` to see all servers).`,
          );
        }
        process.exit(1);
        return;
      }

      // 4. Run the existing client.
      // A PATH entry may be a broken shim (for example rustup without the
      // rust-analyzer component). Distinguish startup failure from a clean file.
      if (!(await client.ensureServerForFile(file))) {
        if (emitJson) {
          console.log(JSON.stringify({ error: 'server_start_failed', file, language, command: config.command }));
        } else {
          console.error(`LSP server for ${language} failed to start: '${config.command}'.`);
        }
        process.exit(1);
        return;
      }
      logger.debug('Running LSP diagnostics', { file, language, command: config.command });
      let diagnostics: LSPDiagnostic[];
      try {
        diagnostics = await client.getDiagnostics(file);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (emitJson) {
          console.log(JSON.stringify({ error: 'diagnostics_failed', file, language, message }));
        } else {
          console.error(`LSP diagnostics failed: ${message}`);
        }
        process.exitCode = 1;
        return;
      } finally {
        await client.stopAll();
      }

      if (emitJson) {
        console.log(JSON.stringify({ file, language, diagnostics }, null, 2));
        await client.stopAll();
        return;
      }

      if (diagnostics.length === 0) {
        console.log(`\nNo diagnostics for ${file} (${language}). Looks clean.\n`);
        await client.stopAll();
        return;
      }

      console.log(`\nDiagnostics for ${file} (${language}) — ${diagnostics.length} found:\n`);
      for (const diag of diagnostics) {
        console.log(formatDiagnostic(diag));
      }
      console.log('');
      await client.stopAll();
    });
}
