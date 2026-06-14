import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readAllChatComponents() {
  const fileNames = ['ChatView.tsx', 'ChatList.tsx', 'MessageComposer.tsx', 'ChatHeader.tsx'];
  let combined = '';
  for (const name of fileNames) {
    const filePath = path.resolve(process.cwd(), 'src/renderer/components', name);
    if (fs.existsSync(filePath)) {
      combined += fs.readFileSync(filePath, 'utf8') + '\n';
    }
  }
  return combined;
}

describe('ChatView Claude-style layout', () => {
  it('uses a narrower conversation column shared by messages and composer', () => {
    const source = readAllChatComponents();
    expect(source).toContain('max-w-[920px]');
  });

  it('uses a quieter header treatment with the shared app name and compact connector badge', () => {
    const source = readAllChatComponents();
    expect(source).toContain("import { APP_NAME } from '../brand'");
    expect(source).toContain('{APP_NAME}');
    expect(source).toContain('bg-background/88');
    expect(source).toContain('border-border-muted');
  });

  it('uses a softer rounded composer shell instead of the previous heavy input bar', () => {
    const source = readAllChatComponents();
    expect(source).toContain('rounded-[1.75rem]');
    expect(source).toContain('shadow-soft');
  });
});
