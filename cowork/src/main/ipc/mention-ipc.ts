import { ipcMain } from 'electron';
import type { MentionProcessor } from '../input/mention-processor';

// Getter, not value: the processor is assigned during async boot, AFTER this
// top-level registration runs. Resolve lazily per call (see command-ipc.ts).
export function registerMentionIpcHandlers(getProcessor: () => MentionProcessor | null) {
  ipcMain.handle('mention.process', async (_event, text: string, cwd?: string) => {
    const mentionProcessor = getProcessor();
    if (!mentionProcessor) return { cleanedText: text, contextBlocks: [] };
    return mentionProcessor.process(text, cwd);
  });

  ipcMain.handle(
    'mention.autocomplete',
    async (_event, prefix: string, cwd?: string, limit?: number) => {
      const mentionProcessor = getProcessor();
      if (!mentionProcessor) return [];
      return mentionProcessor.autocomplete(prefix, cwd, limit);
    }
  );
}
