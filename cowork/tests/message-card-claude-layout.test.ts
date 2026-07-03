import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Content split across MessageCard.tsx and the message/ sub-components directory
const messageCardPath = path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx');
const messageDir = path.resolve(process.cwd(), 'src/renderer/components/message');

function readAllMessageContent() {
  return [
    fs.readFileSync(messageCardPath, 'utf8'),
    ...fs.readdirSync(messageDir).map((f) => fs.readFileSync(path.join(messageDir, f), 'utf8')),
  ].join('\n');
}

describe('MessageCard Claude-style layout', () => {
  it('uses a right-aligned user message treatment in the shared conversation column', () => {
    const source = readAllMessageContent();
    expect(source).toContain('max-w-3xl mx-auto px-4 w-full');
    expect(source).toContain('max-w-[85%] min-w-0 break-words text-right');
    expect(source).toContain('bg-black/[0.03] dark:bg-white/[0.03]');
  });

  it('uses quieter rounded shells for tool and thinking cards', () => {
    const source = readAllMessageContent();
    expect(source).toContain('rounded-2xl border overflow-hidden');
    expect(source).toContain('rounded-2xl border border-border-subtle bg-background/40 overflow-hidden');
  });

  it('supports Hermes-style transparent stream without compact activity grouping', () => {
    const source = readAllMessageContent();
    expect(source).toContain("chatActivityDisplayMode ?? 'compact_worklog'");
    expect(source).toContain("activityDisplayMode === 'transparent_stream'");
    expect(source).toContain('return { visibleBlocks: contentBlocks, activityBlocks: [] as ContentBlock[] }');
    expect(source).toContain('<ActivityGroupBlock');
  });
});
