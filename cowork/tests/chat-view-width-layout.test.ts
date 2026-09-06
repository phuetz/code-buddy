import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readChatView() {
  const filePath = path.resolve(__dirname, '../src/renderer/components/ChatView.tsx');
  return fs.readFileSync(filePath, 'utf8');
}

function readChatList() {
  const filePath = path.resolve(__dirname, '../src/renderer/components/ChatList.tsx');
  return fs.readFileSync(filePath, 'utf8');
}

function readUniversalPreviewRail() {
  const filePath = path.resolve(__dirname, '../src/renderer/components/UniversalPreviewRail.tsx');
  return fs.readFileSync(filePath, 'utf8');
}

describe('chat view width layout', () => {
  it('uses a centered responsive messages container', () => {
    const source = readChatList();
    expect(source).toContain('max-w-3xl mx-auto px-4');
  });

  it('observes message container via ref instead of hard-coded class selector', () => {
    const source = readChatView();
    expect(source).toContain('messagesContainerRef');
    expect(source).not.toContain("querySelector('.max-w-3xl')");
  });

  it('starts the fixed-width preview rail collapsed so the dock keeps a visible composer', () => {
    const source = readUniversalPreviewRail();

    expect(source).toContain('const [open, setOpen] = useState(false)');
    expect(source).toContain('data-testid="universal-preview-rail-collapsed"');
    expect(source).toContain('onClick={() => setOpen(true)}');
  });
});
