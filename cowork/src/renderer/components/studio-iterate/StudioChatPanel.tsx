import { ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Crosshair, Hammer, ImagePlus, Layers, MessagesSquare, ScrollText, Send, Square, Sparkles, User, X } from 'lucide-react';
import type { IterationMode } from '../studio/iteration-prompt.js';
import type { StudioMessage } from './iterate-model.js';
import { lastAssistantMessage } from './iterate-model.js';
import { isSubmitEnter } from '../../utils/submit-key.js';

export interface StudioChatPanelProps {
  messages: StudioMessage[];
  busy?: boolean;
  suggestions?: string[];
  onSend?: (text: string) => void;
  onStop?: () => void;
  /** « Construire » (modifie le code) ou « Discuter » (planifie sans rien écrire). */
  mode?: IterationMode;
  onModeChange?: (mode: IterationMode) => void;
  /** Après un tour de discussion : lance l'implémentation du plan proposé. */
  onImplementPlan?: () => void;
  /** Pièces jointes à la prochaine demande (élément ciblé, journaux, image). */
  attachments?: StudioChatAttachment[];
  /** Image déposée, collée ou choisie (maquette, capture). */
  onAttachImage?: (file: File) => void;
  /** Message court sous la zone de saisie (ex. modèle sans vision). */
  notice?: string | null;
  /** Panneau de sélection du contexte (fichiers inclus/exclus). */
  contextPanel?: ReactNode;
  /** Estimation en jetons de la demande qui partirait avec ce brouillon. */
  estimateTokens?: (draft: string) => number;
}

export interface StudioChatAttachment {
  id: string;
  kind: 'cible' | 'journaux' | 'image';
  label: string;
  detail?: string;
  onRemove: () => void;
}

const ATTACHMENT_ICON = { cible: Crosshair, journaux: ScrollText, image: ImagePlus } as const;

function Bubble({ message }: { message: StudioMessage }) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';

  return (
    <article className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`} aria-label={isUser ? t('studioChat.userMessage', 'User message') : t('studioChat.assistantMessage', 'Assistant message')}>
      {!isUser && (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <div
        className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isUser ? 'bg-primary text-primary-foreground' : 'border border-border bg-surface text-foreground'
        }`}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.text || (message.streaming ? t('studioChat.iterating', 'Iterating…') : '')}</p>
        {message.streaming && (
          <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label={t('studioChat.responseInProgress', 'Response in progress')}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:240ms]" />
          </span>
        )}
      </div>
      {isUser && (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
          <User className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </article>
  );
}

export function StudioChatPanel({
  messages,
  busy = false,
  suggestions = [],
  onSend,
  onStop,
  mode = 'build',
  onModeChange,
  onImplementPlan,
  attachments = [],
  onAttachImage,
  notice,
  contextPanel,
  estimateTokens,
}: StudioChatPanelProps) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const takeImage = (files: FileList | null | undefined): boolean => {
    const file = files ? Array.from(files).find((f) => f.type.startsWith('image/')) : undefined;
    if (!file || !onAttachImage) return false;
    onAttachImage(file);
    return true;
  };
  const onDrop = (event: DragEvent) => {
    setDragging(false);
    if (!onAttachImage) return;
    event.preventDefault();
    takeImage(event.dataTransfer?.files);
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (takeImage(event.clipboardData?.files)) event.preventDefault();
  };
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const latestAssistant = lastAssistantMessage(messages);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, latestAssistant?.text]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value || busy) {
      return;
    }

    onSend?.(value);
    setDraft('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  // Même loi que l'accueil : Entrée envoie, Maj+Entrée va à la ligne (et une
  // composition IME en cours n'envoie pas).
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSubmitEnter(event)) {
      event.preventDefault();
      send(draft);
    }
  };

  return (
    <section
      className={`flex h-full min-h-0 flex-col rounded-lg border bg-background ${dragging ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
      aria-label={t('studioChat.regionLabel', 'App Studio iteration chat')}
      data-testid="studio-chat"
      onDragOver={(event) => {
        if (!onAttachImage) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t('studioChat.title', 'Iterate on the app')}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === 'discuss'
            ? t('studioChat.hintDiscuss', 'Discussion mode: we plan, no file will be changed.')
            : t('studioChat.hintBuild', 'Ask for a change, then check the preview.')}
        </p>
        {onModeChange ? (
          <div className="mt-2 inline-flex rounded-md border border-border p-0.5" role="group" aria-label={t('studioChat.modeGroup', 'Chat mode')}>
            <button
              type="button"
              onClick={() => onModeChange('build')}
              aria-pressed={mode === 'build'}
              data-testid="studio-mode-build"
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${mode === 'build' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Hammer className="h-3.5 w-3.5" aria-hidden="true" />
              {t('studioChat.modeBuild', 'Build')}
            </button>
            <button
              type="button"
              onClick={() => onModeChange('discuss')}
              aria-pressed={mode === 'discuss'}
              data-testid="studio-mode-discuss"
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${mode === 'discuss' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {t('studioChat.modeDiscuss', 'Discuss')}
            </button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted-foreground">
            {t('studioChat.empty', 'Describe the next iteration: style, component, data or tests to add.')}
          </div>
        ) : (
          messages.map((message) => <Bubble key={message.id} message={message} />)
        )}
        {mode === 'discuss' && onImplementPlan && !busy && latestAssistant?.text ? (
          <button
            type="button"
            onClick={onImplementPlan}
            data-testid="studio-implement-plan"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground hover:bg-accent/90"
          >
            <Hammer className="h-3.5 w-3.5" aria-hidden="true" />
            {t('studioChat.implementPlan', 'Implement this plan')}
          </button>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {suggestions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-border px-4 py-2" aria-label={t('studioChat.suggestionsLabel', 'Iteration suggestions')}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => send(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {contextPanel && showContext ? contextPanel : null}
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 pt-2" aria-label={t('studioChat.attachmentsLabel', 'Attachments for the next request')} data-testid="studio-chat-attachments">
          {attachments.map((item) => {
            const Icon = ATTACHMENT_ICON[item.kind];
            return (
              <span
                key={item.id}
                data-testid={`studio-attachment-${item.kind}`}
                title={item.detail ?? item.label}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-foreground"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
                <button type="button" onClick={item.onRemove} className="shrink-0 rounded-full p-0.5 hover:bg-muted" aria-label={t('studioChat.remove', { label: item.label, defaultValue: 'Remove {{label}}' })}>
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <form className="border-t border-border p-3" onSubmit={submit}>
        <label className="sr-only" htmlFor="studio-iterate-composer">{t('studioChat.composerLabel', 'Iteration message')}</label>
        <textarea
          id="studio-iterate-composer"
          className="min-h-20 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
          placeholder={t('studioChat.placeholder', 'e.g. Make the primary button more prominent and add an empty state')}
          aria-describedby="studio-iterate-key-hint"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
        />
        <p id="studio-iterate-key-hint" className="mt-1 text-xs text-muted-foreground" data-testid="studio-key-hint">
          {t('studioChat.keyHint', 'Enter to send · Shift+Enter for a new line')}
        </p>
        {notice ? (
          <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-foreground" role="status" data-testid="studio-chat-notice">
            {notice}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            {onAttachImage ? (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:text-foreground"
                  title={t('studioChat.attachImageTitle', 'Attach a mockup or a screenshot (or drag and drop / paste an image)')}
                  data-testid="studio-attach-image"
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('studioChat.image', 'Image')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  data-testid="studio-attach-image-input"
                  onChange={(event) => {
                    takeImage(event.target.files);
                    event.target.value = '';
                  }}
                />
              </>
            ) : null}
            {contextPanel ? (
              <button
                type="button"
                onClick={() => setShowContext((v) => !v)}
                aria-pressed={showContext}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${showContext ? 'border-primary text-foreground' : 'border-border hover:text-foreground'}`}
                title={t('studioChat.contextTitle', 'Choose the files included in or excluded from the context')}
                data-testid="studio-context-toggle"
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                {t('studioChat.context', 'Context')}
              </button>
            ) : null}
            {estimateTokens ? (
              <span
                data-testid="studio-token-estimate"
                title={t('studioChat.tokensTitle', 'Estimated input tokens added by this request (history excluded)')}
              >
                ~{estimateTokens(draft).toLocaleString(i18n?.language || 'en')} {t('studioChat.tokensUnit', 'tokens')}
              </span>
            ) : null}
          </span>
          {busy ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/15"
              onClick={onStop}
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              {t('studioChat.stop', 'Stop')}
            </button>
          ) : (
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!draft.trim()}
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {t('studioChat.send', 'Send')}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
