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

  it('keeps a usable composer in narrow chat panes (measured by layout-recette.mjs in Electron)', () => {
    const chatView = readChatView();
    const rail = readUniversalPreviewRail();
    const composer = fs.readFileSync(path.resolve(__dirname, '../src/renderer/components/MessageComposer.tsx'), 'utf8');
    const autogrow = fs.readFileSync(path.resolve(__dirname, '../src/renderer/hooks/use-textarea-autogrow.ts'), 'utf8');

    // The chat column may shrink below its content instead of overflowing the pane.
    expect(chatView).toContain('flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden');
    // An open rail that would leave less than a usable column overlays the list above the composer.
    expect(rail).toContain('MIN_CHAT_COLUMN_WITH_RAIL_PX');
    expect(rail).toContain("data-layout={overlay.active ? 'overlay' : 'inline'}");
    expect(rail).toContain('bottom: overlay.bottom');
    // The composer measures its own width (not the window) and wraps below the threshold.
    expect(composer).toContain('COMPACT_COMPOSER_WIDTH_PX');
    expect(composer).toContain("compact ? 'order-first basis-full' : ''");
    // Re-wrapping after a width change recomputes the textarea height.
    expect(autogrow).toContain('new ResizeObserver');
  });
});
