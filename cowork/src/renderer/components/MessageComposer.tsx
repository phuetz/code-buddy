import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, FileSearch, Plus, Send, Square, Target, Trash2, Pencil, X } from 'lucide-react';
import { MentionAutocomplete, type MentionItem } from './MentionAutocomplete';
import { SlashCommandPalette, type SlashCommandItem } from './SlashCommandPalette';
import { MicButton } from './MicButton';
import { MemoryEditCard } from './MemoryEditCard';
import { FileAttachmentChip } from './FileAttachmentChip';
import type { AttachedFile } from '../utils/file-attachment-helpers';

export interface MessageComposerProps {
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  isSubmitting: boolean;
  pastedImages: Array<{ url: string; base64: string; mediaType: string }>;
  attachedFiles: AttachedFile[];
  modelSupportsVision: boolean | null;
  isDragging: boolean;
  mentionState: { prefix: string; startPos: number; anchor: { top: number; left: number } | null } | null;
  setMentionState: React.Dispatch<React.SetStateAction<{ prefix: string; startPos: number; anchor: { top: number; left: number } | null } | null>>;
  slashState: { prefix: string; startPos: number; anchor: { top: number; left: number } | null } | null;
  setSlashState: React.Dispatch<React.SetStateAction<{ prefix: string; startPos: number; anchor: { top: number; left: number } | null } | null>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  isComposingRef: React.MutableRefObject<boolean>;
  
  goalComposerActive: boolean;
  setGoalComposerActive: React.Dispatch<React.SetStateAction<boolean>>;
  goalComposerDisabled: boolean;

  activeSessionId: string | null;
  activeSession: any; 
  appConfig: any;
  queuedIntents: any[];
  hasActiveTurn: boolean;
  isSessionRunning: boolean;
  canStop: boolean;
  
  shouldShowDocumentWorkshopAction: boolean;
  showMemoryEditor: boolean;
  setShowMemoryEditor: (show: boolean) => void;
  removeQueuedIntent: (sessionId: string, intentId: string) => void;
  setPreviewFilePath: (path: string) => void;
  
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  handleStop: () => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  handlePaste: (e: React.ClipboardEvent) => Promise<void>;
  handleFileSelect: () => Promise<void>;
  removeImage: (index: number) => void;
  removeFile: (index: number) => void;
  applyDocumentWorkshopPrompt: () => void;
  handleEditQueuedIntent: (intentId: string, text: string) => void;
  handleSteerQueuedIntent: (intentId: string) => Promise<void>;

  onMentionSelect: (item: MentionItem) => void;
  onSlashCommandSelect: (item: SlashCommandItem) => Promise<void>;
}

export function MessageComposer(props: MessageComposerProps) {
  const { t } = useTranslation();
  
  return (
    <div
      className="border-t border-border-muted bg-background/92 backdrop-blur-md"
      onDragOver={props.handleDragOver}
      onDragLeave={props.handleDragLeave}
      onDrop={props.handleDrop}
    >
      <div className="max-w-[920px] mx-auto px-5 lg:px-8 py-5">
        <form
          onSubmit={props.handleSubmit}
          className="relative w-full"
        >
          {props.isDragging && (
            <div className="absolute inset-0 z-10 rounded-[2rem] border-2 border-dashed border-accent bg-accent/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
              <span className="text-sm font-medium text-accent">
                {t('chat.dropToAttach', 'Drop files to attach')}
              </span>
            </div>
          )}

          {props.pastedImages.length > 0 && props.modelSupportsVision === false && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning flex items-start gap-2">
              <span className="font-medium">{t('chat.visionWarningTitle')}</span>
              <span className="text-warning/80">{t('chat.visionWarningBody')}</span>
            </div>
          )}

          {props.pastedImages.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
              {props.pastedImages.map((img, index) => (
                <div key={img.url || `pasted-image-${index}`} className="relative group">
                  <img
                    src={img.url}
                    alt={t('common.pastedImageAlt', { index: index + 1 })}
                    className="w-full aspect-square object-cover rounded-lg border border-border block"
                  />
                  <button
                    type="button"
                    onClick={() => props.removeImage(index)}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {props.attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {props.attachedFiles.map((file, index) => (
                <FileAttachmentChip
                  key={file.path || `attached-file-${index}`}
                  file={file}
                  onRemove={() => props.removeFile(index)}
                  onPreview={(f) => {
                    if (f.path) {
                      props.setPreviewFilePath(f.path);
                    }
                  }}
                />
              ))}
              {props.shouldShowDocumentWorkshopAction && (
                <button
                  type="button"
                  onClick={props.applyDocumentWorkshopPrompt}
                  data-testid="chat-document-workshop-action"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-accent/35 bg-accent/10 text-xs font-medium text-accent hover:bg-accent/15 transition-colors"
                  title={t('chat.documentWorkshopActionTitle', 'Prepare a Word workshop prompt')}
                >
                  <FileSearch className="w-3.5 h-3.5" />
                  <span>{t('chat.documentWorkshopAction', 'Atelier Word')}</span>
                </button>
              )}
            </div>
          )}

          {props.queuedIntents.length > 0 && (
            <div
              className="mb-3 space-y-1.5"
              data-testid="chat-queued-intents"
              aria-label={t('chat.queuedIntents', 'Queued messages')}
            >
              {props.queuedIntents.map((intent) => (
                <div
                  key={intent.id}
                  className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface/70 px-3 py-2"
                >
                  <Clock className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-text-secondary">
                      {intent.prompt || t('chat.queuedAttachmentIntent', 'Attachment message')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => props.removeQueuedIntent(intent.sessionId, intent.id)}
                    className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                    title={t('common.delete', 'Delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => props.handleEditQueuedIntent(intent.id, intent.prompt)}
                    className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                    title={t('common.edit', 'Edit')}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void props.handleSteerQueuedIntent(intent.id)}
                    disabled={!props.hasActiveTurn && !props.isSessionRunning}
                    className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={t('chat.steerQueuedIntent', 'Steer current run')}
                  >
                    <Target className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {props.showMemoryEditor && (
            <div className="mb-3">
              <MemoryEditCard onClose={() => props.setShowMemoryEditor(false)} />
            </div>
          )}

          <div
            className={`flex items-end gap-2 p-3.5 rounded-[1.75rem] bg-background/88 border border-border-muted shadow-soft transition-colors ${
              props.isDragging ? 'ring-2 ring-accent bg-accent/5' : ''
            }`}
          >
            <button
              type="button"
              onClick={props.handleFileSelect}
              data-testid="chat-attach-files"
              className="w-9 h-9 rounded-2xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              title={t('welcome.attachFiles')}
            >
              <Plus className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => {
                if (!props.goalComposerDisabled) props.setGoalComposerActive((active) => !active);
              }}
              disabled={props.goalComposerDisabled}
              data-testid="chat-goal-mode-toggle"
              aria-pressed={props.goalComposerActive}
              className={`h-9 min-w-9 rounded-2xl inline-flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                props.goalComposerActive
                  ? 'border border-accent/35 bg-accent/10 text-accent hover:bg-accent/15'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
              }`}
              title={
                props.goalComposerActive
                  ? t('goalMode.composerActiveTitle', 'Goal mode active')
                  : t('goalMode.composerToggleTitle', 'Send as a standing goal')
              }
            >
              <Target className="w-4 h-4" />
              <span className="hidden sm:inline">{t('goalMode.composerLabel', 'Goal')}</span>
            </button>

            <textarea
              ref={props.textareaRef}
              data-testid="chat-prompt-input"
              value={props.prompt}
              onChange={(e) => {
                const newValue = e.target.value;
                props.setPrompt(newValue);

                const caretPos = e.target.selectionStart ?? newValue.length;
                const textBeforeCaret = newValue.slice(0, caretPos);
                const atMatch = textBeforeCaret.match(/(?:^|\s)@([^\s]*)$/);
                if (atMatch) {
                  const startPos = caretPos - atMatch[1].length - 1;
                  const rect = e.target.getBoundingClientRect();
                  props.setMentionState({
                    prefix: atMatch[1],
                    startPos,
                    anchor: {
                      top: rect.top - 300,
                      left: rect.left + 20,
                    },
                  });
                } else {
                  props.setMentionState(null);
                }

                const slashMatch = textBeforeCaret.match(/^\s*\/([\w-]*)$/);
                if (slashMatch) {
                  const prefix = slashMatch[1];
                  const startPos = textBeforeCaret.lastIndexOf('/');
                  const rect = e.target.getBoundingClientRect();
                  props.setSlashState({
                    prefix,
                    startPos,
                    anchor: {
                      top: rect.top - 340,
                      left: rect.left + 20,
                    },
                  });
                } else {
                  props.setSlashState(null);
                }
              }}
              onCompositionStart={() => {
                props.isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                props.isComposingRef.current = false;
              }}
              onPaste={props.handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (e.nativeEvent.isComposing || props.isComposingRef.current || e.keyCode === 229) {
                    return;
                  }
                  e.preventDefault();
                  props.handleSubmit();
                }
              }}
              placeholder={
                props.goalComposerActive
                  ? t('goalMode.promptPlaceholder', 'Describe the standing goal')
                  : t('chat.typeMessage')
              }
              disabled={props.isSubmitting}
              rows={1}
              className="flex-1 resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-[15px] py-2"
            />

            <div className="flex items-center gap-2">
              <MicButton
                language="fr"
                onTranscript={(text) => {
                  props.setPrompt((current) => (current ? `${current} ${text}` : text));
                  props.textareaRef.current?.focus();
                }}
              />

              <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted">
                {props.appConfig?.model || t('chat.noModel')}
              </span>

              {props.canStop && (
                <button
                  type="button"
                  onClick={props.handleStop}
                  className="w-9 h-9 rounded-2xl flex items-center justify-center bg-error/10 text-error hover:bg-error/20 transition-colors"
                  title={
                    props.queuedIntents.length > 0
                      ? t('chat.stopAndSendQueued', 'Stop and send queued message')
                      : t('chat.stop')
                  }
                >
                  <Square className="w-4 h-4" />
                </button>
              )}
              <button
                type="submit"
                disabled={
                  (!props.prompt.trim() &&
                    !props.textareaRef.current?.value.trim() &&
                    props.pastedImages.length === 0 &&
                    props.attachedFiles.length === 0) ||
                  props.isSubmitting
                }
                className="w-9 h-9 rounded-2xl flex items-center justify-center bg-accent text-background disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
                title={t('chat.sendMessage')}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          <p className="text-[11px] text-text-muted/60 text-center mt-2.5">
            {t('chat.disclaimer')}
          </p>
        </form>
      </div>

      {props.mentionState && (
        <MentionAutocomplete
          prefix={props.mentionState.prefix}
          cwd={props.activeSession?.cwd}
          anchorPosition={props.mentionState.anchor}
          onSelect={props.onMentionSelect}
          onClose={() => props.setMentionState(null)}
        />
      )}

      {props.slashState && (
        <SlashCommandPalette
          prefix={props.slashState.prefix}
          anchorPosition={props.slashState.anchor}
          onSelect={props.onSlashCommandSelect}
          onClose={() => props.setSlashState(null)}
        />
      )}
    </div>
  );
}
