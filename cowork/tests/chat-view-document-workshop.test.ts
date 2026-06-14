import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const messageComposerPath = path.resolve(process.cwd(), 'src/renderer/components/MessageComposer.tsx');

describe('ChatView document workshop action', () => {
  it('offers the Word-workshop prompt action for document attachments', () => {
    const source1 = fs.readFileSync(chatViewPath, 'utf8');
    const source2 = fs.readFileSync(messageComposerPath, 'utf8');
    const source = source1 + source2;

    expect(source).toContain('buildDocumentWorkshopPrompt');
    expect(source).toContain('buildComposerContentBlocks');
    expect(source).toContain('hasDocumentWorkshopAttachment');
    expect(source).toContain('shouldShowDocumentWorkshopAction');
    expect(source).toContain('applyDocumentWorkshopPrompt');
    expect(source).toContain("t('chat.documentWorkshopAction', 'Atelier Word')");
    expect(source).toContain('data-testid="chat-document-workshop-action"');
    expect(source).toContain('data-testid="chat-attach-files"');
    expect(source).toContain('data-testid="chat-prompt-input"');
  });

  it('submits a document-workshop prompt automatically when only a document is attached', () => {
    const source1 = fs.readFileSync(chatViewPath, 'utf8');
    const source2 = fs.readFileSync(messageComposerPath, 'utf8');
    const source = source1 + source2;

    expect(source).toContain('const contentBlocks = buildComposerContentBlocks(');
    expect(source).toContain('currentPrompt,');
    expect(source).toContain('attachedFiles,');
    expect(source).toContain('pastedImages');
  });
});
