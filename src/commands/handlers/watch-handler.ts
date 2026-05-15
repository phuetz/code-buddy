/**
 * /watch Slash Command Handler
 *
 * Manages file watcher triggers: start, stop, status.
 */

import type { CommandHandlerResult } from './branch-handlers.js';

let watcherInstance: import('../../agent/file-watcher-trigger.js').FileWatcherTrigger | null = null;

export async function handleWatch(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'status';

  switch (action) {
    case 'start': {
      if (watcherInstance?.isRunning()) {
        return result('File watcher is already running. Use `/watch stop` first.');
      }

      const { FileWatcherTrigger } = await import('../../agent/file-watcher-trigger.js');

      // Parse optional patterns from args
      const patterns = args.slice(1).filter(a => !a.startsWith('--'));
      const config = patterns.length > 0 ? { patterns } : {};

      watcherInstance = new FileWatcherTrigger(config);
      let startErrorMessage: string | null = null;

      // Wire up event listeners for user feedback
      watcherInstance.on('change', (event) => {
        const { filePath, changeType } = event;
        const rel = filePath.replace(process.cwd().replace(/\\/g, '/') + '/', '');
        process.stdout.write(`  [watch] ${changeType}: ${rel}\n`);
      });

      watcherInstance.on('error', (err) => {
        startErrorMessage = err.message;
        process.stderr.write(`  [watch] Error: ${err.message}\n`);
      });

      watcherInstance.start(process.cwd());
      if (!watcherInstance.isRunning()) {
        watcherInstance = null;
        return result(`File watcher failed to start: ${startErrorMessage || 'unknown error'}`);
      }

      const cfg = watcherInstance.getConfig();
      return result(
        `File watcher started.\n` +
        `  Patterns: ${cfg.patterns.join(', ')}\n` +
        `  Debounce: ${cfg.debounceMs}ms\n` +
        `  Actions: ${cfg.actions.join(', ')}`
      );
    }

    case 'stop': {
      if (!watcherInstance?.isRunning()) {
        return result('File watcher is not running.');
      }
      watcherInstance.stop();
      watcherInstance = null;
      return result('File watcher stopped.');
    }

    case 'status':
    default: {
      if (!watcherInstance?.isRunning()) {
        return result('File watcher is not running. Use `/watch start` to begin watching.');
      }
      const cfg = watcherInstance.getConfig();
      return result(
        `File watcher is running.\n` +
        `  Patterns: ${cfg.patterns.join(', ')}\n` +
        `  Ignore: ${cfg.ignorePatterns.slice(0, 5).join(', ')}${cfg.ignorePatterns.length > 5 ? '...' : ''}\n` +
        `  Debounce: ${cfg.debounceMs}ms\n` +
        `  Actions: ${cfg.actions.join(', ')}`
      );
    }
  }
}

function result(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}
