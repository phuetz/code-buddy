import type { CommandHandlerResult } from './branch-handlers.js';
import {
  isCompanionAlwaysOnLoopsRunning,
  startCompanionAlwaysOnLoops,
  stopCompanionAlwaysOnLoops,
} from '../../companion/companion-loops.js';

function entry(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

export async function handleCompanionLoops(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').toLowerCase();
  if (action === 'start' || action === 'enable' || action === 'on') {
    startCompanionAlwaysOnLoops();
    return entry('Companion always-on loops armed (impulse delivery if env flags allow).');
  }
  if (action === 'stop' || action === 'disable' || action === 'off') {
    stopCompanionAlwaysOnLoops();
    return entry('Companion always-on loops stopped.');
  }
  return entry(
    `Companion loops: ${isCompanionAlwaysOnLoopsRunning() ? 'running' : 'stopped'}\n` +
      'Usage: /companion-loops start|stop|status',
  );
}
