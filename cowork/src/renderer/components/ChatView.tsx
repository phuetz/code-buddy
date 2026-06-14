import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useActiveSessionId,
  useCurrentSession,
  useActiveSessionMessages,
  useActivePartialContent,
  useActiveTurn,
  usePendingTurns,
  useActiveQueuedIntents,
  useActiveExecutionClock,
  useAppConfig,
} from '../store/selectors';
import { useAppStore } from '../store';
import { applySlashCommandResult } from '../commands/slash-command-actions';
import { useIPC } from '../hooks/useIPC';
import { SessionSearch } from './SessionSearch';
import { ChatList } from './ChatList';
import { ChatHeader } from './ChatHeader';
import { MentionAutocomplete, type MentionItem } from './MentionAutocomplete';
import { SlashCommandPalette, type SlashCommandItem } from './SlashCommandPalette';
import { MicButton } from './MicButton';
import { interruptSpeech, speakText } from './VoiceOutputToggle';
import { MemoryEditCard } from './MemoryEditCard';
import { FileAttachmentChip } from './FileAttachmentChip';
import { usePermissionMode, useSearchState } from '../store/selectors';
import type { Message, ContentBlock, ScheduleCreateInput, ScheduleWeekday } from '../types';
import {
  clampSearchMatchIndex,
  findMessageSearchMatches,
  getActiveSearchMatchId,
} from '../utils/session-search';
import {
  buildAttachmentFromDroppedFile,
  buildAttachmentFromPath,
  buildComposerContentBlocks,
  buildDocumentWorkshopPrompt,
  getDroppedFilePath,
  hasDocumentWorkshopAttachment,
  isDroppedFolderCandidate,
  type AttachedFile,
} from '../utils/file-attachment-helpers';
import {
  CHAT_COMPOSER_INSERT_EVENT,
  type ChatComposerInsertDetail,
} from '../utils/chat-composer-events';
import {
  Send,
  Square,
  Plus,
  X,
  Clock,
  Eye,
  FileSearch,
  Target,
  Pencil,
  Trash2,
} from 'lucide-react';

function toScheduleCreateInput(
  input: {
    prompt: string;
    cwd?: string;
    runAt: number;
    nextRunAt: number;
    scheduleConfig:
      | { kind: 'daily'; times: string[] }
      | { kind: 'weekly'; weekdays: number[]; times: string[] }
      | null;
    enabled: boolean;
  },
  fallbackCwd: string
): ScheduleCreateInput {
  return {
    prompt: input.prompt,
    cwd: input.cwd || fallbackCwd,
    runAt: input.runAt,
    nextRunAt: input.nextRunAt,
    scheduleConfig:
      input.scheduleConfig?.kind === 'weekly'
        ? {
            kind: 'weekly',
            weekdays: input.scheduleConfig.weekdays as ScheduleWeekday[],
            times: input.scheduleConfig.times,
          }
        : input.scheduleConfig,
    enabled: input.enabled,
  };
}

export function ChatView() {
  const { t } = useTranslation();
  // Scoped selectors — each subscription only re-renders when its slice changes
  const activeSessionId = useActiveSessionId();
  const activeSession = useCurrentSession();
  const messages = useActiveSessionMessages();
  const { partialMessage, partialThinking } = useActivePartialContent();
  const activeTurn = useActiveTurn();
  const pendingTurns = usePendingTurns();
  const queuedIntents = useActiveQueuedIntents();
  const executionClock = useActiveExecutionClock();
  const appConfig = useAppConfig();
  const permissionMode = usePermissionMode();
  const { searchQuery, searchActive } = useSearchState();
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const showMemoryEditor = useAppStore((s) => s.showMemoryEditor);
  const setShowMemoryEditor = useAppStore((s) => s.setShowMemoryEditor);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const setScheduleDraft = useAppStore((s) => s.setScheduleDraft);
  const removeQueuedIntent = useAppStore((s) => s.removeQueuedIntent);
  const focusedMessageTarget = useAppStore((s) => s.focusedMessageTarget);
  const clearFocusedMessageTarget = useAppStore((s) => s.clearFocusedMessageTarget);
  const { continueSession, steerSession, stopSession, isElectron } = useIPC();
  const [prompt, setPrompt] = useState('');
  const [goalComposerActive, setGoalComposerActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSearchMatch, setCurrentSearchMatch] = useState(0);
  const [pastedImages, setPastedImages] = useState<
    Array<{ url: string; base64: string; mediaType: string }>
  >([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  // Phase 3 step 3: vision capability of the current model (for warning banner).
  const [modelSupportsVision, setModelSupportsVision] = useState<boolean | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mentionState, setMentionState] = useState<{
    prefix: string;
    startPos: number;
    anchor: { top: number; left: number } | null;
  } | null>(null);
  const [slashState, setSlashState] = useState<{
    prefix: string;
    startPos: number;
    anchor: { top: number; left: number } | null;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRequestRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);

  const hasActiveTurn = Boolean(activeTurn);
  const pendingCount = pendingTurns.length;
  const isSessionRunning = activeSession?.status === 'running';
  const canStop = isSessionRunning || hasActiveTurn || pendingCount > 0;
  const documentWorkshopPrompt = useMemo(
    () => buildDocumentWorkshopPrompt(attachedFiles),
    [attachedFiles]
  );
  const shouldShowDocumentWorkshopAction = useMemo(
    () => attachedFiles.some(hasDocumentWorkshopAttachment) && prompt.trim().length === 0,
    [attachedFiles, prompt]
  );
  const goalComposerDisabled =
    pastedImages.length > 0 || attachedFiles.length > 0 || isSubmitting || !activeSessionId;

  const displayedMessages = useMemo(() => {
    if (!activeSessionId) return messages;
    // Show streaming message if we have partial text OR partial thinking
    const hasStreamingContent = partialMessage || partialThinking;
    if (!hasStreamingContent || !activeTurn?.userMessageId) return messages;
    const anchorIndex = messages.findIndex((message) => message.id === activeTurn.userMessageId);
    if (anchorIndex === -1) return messages;

    let insertIndex = anchorIndex + 1;
    while (insertIndex < messages.length) {
      if (messages[insertIndex].role === 'user') break;
      insertIndex += 1;
    }

    const contentBlocks: ContentBlock[] = [];
    if (partialThinking) {
      contentBlocks.push({ type: 'thinking', thinking: partialThinking });
    }
    if (partialMessage) {
      contentBlocks.push({ type: 'text', text: partialMessage });
    }

    const streamingMessage: Message = {
      id: `partial-${activeSessionId}`,
      sessionId: activeSessionId,
      role: 'assistant',
      content: contentBlocks,
      timestamp: Date.now(),
    };

    return [...messages.slice(0, insertIndex), streamingMessage, ...messages.slice(insertIndex)];
  }, [activeSessionId, activeTurn?.userMessageId, messages, partialMessage, partialThinking]);

  const searchMatches = useMemo(
    () => findMessageSearchMatches(displayedMessages, searchQuery),
    [displayedMessages, searchQuery]
  );
  const visibleSearchMatchIndex = useMemo(
    () => clampSearchMatchIndex(currentSearchMatch, searchMatches.length),
    [currentSearchMatch, searchMatches.length]
  );
  const activeSearchMatchId = useMemo(
    () => getActiveSearchMatchId(searchMatches, currentSearchMatch),
    [currentSearchMatch, searchMatches]
  );

  useEffect(() => {
    if (!focusedMessageTarget || focusedMessageTarget.sessionId !== activeSessionId) {
      return;
    }
    const handle = window.setTimeout(() => {
      const element = document.getElementById(`message-${focusedMessageTarget.messageId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearFocusedMessageTarget();
      }
    }, 50);
    return () => window.clearTimeout(handle);
  }, [activeSessionId, clearFocusedMessageTarget, displayedMessages.length, focusedMessageTarget]);

  useEffect(() => {
    setCurrentSearchMatch(0);
  }, [searchQuery, searchActive, activeSessionId]);

  useEffect(() => {
    if (!searchActive || searchMatches.length === 0) return;
    const targetId = activeSearchMatchId;
    if (!targetId) return;
    const element = document.getElementById(`message-${targetId}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeSearchMatchId, searchActive, searchMatches.length]);

  const goToNextSearchMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentSearchMatch((index) => (index + 1) % searchMatches.length);
  }, [searchMatches.length]);

  const goToPreviousSearchMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentSearchMatch((index) => (index - 1 + searchMatches.length) % searchMatches.length);
  }, [searchMatches.length]);

  // --- Real-time execution timer ---
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const isActive = Boolean(executionClock?.startAt && executionClock.endAt === null);
    if (!isActive) {
      return;
    }
    setClockNow(Date.now());
    const interval = setInterval(() => {
      setClockNow(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, [executionClock?.startAt, executionClock?.endAt]);

  const liveElapsed =
    executionClock?.startAt == null
      ? 0
      : Math.max(0, (executionClock.endAt ?? clockNow) - executionClock.startAt);
  const timerActive = Boolean(executionClock?.startAt && executionClock.endAt === null);

  // Debounced scroll function to prevent scroll conflicts
  const scrollToBottom = useRef((behavior: ScrollBehavior = 'auto', immediate: boolean = false) => {
    // Cancel any pending scroll requests
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    if (scrollRequestRef.current) {
      cancelAnimationFrame(scrollRequestRef.current);
      scrollRequestRef.current = null;
    }

    const performScroll = () => {
      if (!isUserAtBottomRef.current) return;

      // Mark as scrolling to prevent concurrent scrolls
      isScrollingRef.current = true;

      messagesEndRef.current?.scrollIntoView({ behavior });

      // Reset scrolling flag after a short delay
      setTimeout(
        () => {
          isScrollingRef.current = false;
        },
        behavior === 'smooth' ? 300 : 50
      );
    };

    if (immediate) {
      performScroll();
    } else {
      // Use RAF + timeout for debouncing
      scrollRequestRef.current = requestAnimationFrame(() => {
        scrollTimeoutRef.current = setTimeout(performScroll, 16); // ~1 frame delay
      });
    }
  }).current;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const updateScrollState = () => {
      const distanceToBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      isUserAtBottomRef.current = distanceToBottom <= 80;
    };
    updateScrollState();
    // 用户阅读旧消息时，阻止新消息自动滚动打断视线
    const onScroll = () => updateScrollState();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const messageCount = messages.length;
    const partialLength = partialMessage.length + partialThinking.length;
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick = partialLength !== prevPartialLengthRef.current && !hasNewMessage;

    // Skip scroll if already scrolling (prevent conflicts)
    if (isScrollingRef.current) {
      prevMessageCountRef.current = messageCount;
      prevPartialLengthRef.current = partialLength;
      return;
    }

    if (isUserAtBottomRef.current) {
      if (!isStreamingTick) {
        // New message - use smooth scroll but with debounce
        const behavior: ScrollBehavior = hasNewMessage ? 'smooth' : 'auto';
        scrollToBottom(behavior, false);
      } else {
        // Streaming tick - use instant scroll with debounce
        scrollToBottom('auto', false);
      }
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [messages.length, partialMessage.length, partialThinking.length]);

  // Phase 2 step 11: speak the latest assistant message when TTS is enabled.
  const lastSpokenIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    const messageId = (last as { id?: string }).id ?? `idx-${messages.length - 1}`;
    if (lastSpokenIdRef.current === messageId) return;
    lastSpokenIdRef.current = messageId;
    const text = Array.isArray(last.content)
      ? (last.content as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text ?? '')
          .join(' ')
      : String(last.content ?? '');
    if (text) void speakText(text);
  }, [messages]);

  // Additional scroll trigger for content height changes (e.g., TodoWrite expand/collapse)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const messagesContainer = messagesContainerRef.current;
    if (!container || !messagesContainer) return;

    const resizeObserver = new ResizeObserver(() => {
      // Don't interfere with ongoing scrolls
      if (!isScrollingRef.current && isUserAtBottomRef.current) {
        // Scroll to bottom when content height changes
        scrollToBottom('auto', false);
      }
    });

    resizeObserver.observe(messagesContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, []); // ResizeObserver is stable — no need to recreate on message count changes

  // Cleanup scroll timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (scrollRequestRef.current) {
        cancelAnimationFrame(scrollRequestRef.current);
      }
    };
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  useEffect(() => {
    if (goalComposerActive && (pastedImages.length > 0 || attachedFiles.length > 0)) {
      setGoalComposerActive(false);
    }
  }, [attachedFiles.length, goalComposerActive, pastedImages.length]);

  // Phase 3 step 3: fetch vision capability when model changes
  useEffect(() => {
    const model = activeSession?.model || appConfig?.model;
    if (!model || !window.electronAPI?.model?.capabilities) {
      setModelSupportsVision(null);
      return;
    }
    let cancelled = false;
    window.electronAPI.model.capabilities(model).then((caps) => {
      if (!cancelled) setModelSupportsVision(caps.supportsVision);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession?.model, appConfig?.model]);

  // Phase 3 step 5: listen for prompt insertion from renderer overlays.
  useEffect(() => {
    const insertBody = (body: string | undefined) => {
      if (!body || !textareaRef.current) return;
      const textarea = textareaRef.current;
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      const next = `${before}${body}${after}`;
      setPrompt(next);
      textarea.value = next;
      requestAnimationFrame(() => {
        textarea.focus();
        const pos = before.length + body.length;
        textarea.setSelectionRange(pos, pos);
      });
    };

    const snippetHandler = (ev: Event) => {
      const custom = ev as CustomEvent<{ body: string }>;
      insertBody(custom.detail?.body);
    };
    const composerHandler = (ev: Event) => {
      const custom = ev as CustomEvent<ChatComposerInsertDetail>;
      insertBody(custom.detail?.body);
    };

    window.addEventListener('snippets:insert', snippetHandler as EventListener);
    window.addEventListener(CHAT_COMPOSER_INSERT_EVENT, composerHandler as EventListener);
    return () => {
      window.removeEventListener('snippets:insert', snippetHandler as EventListener);
      window.removeEventListener(CHAT_COMPOSER_INSERT_EVENT, composerHandler as EventListener);
    };
  }, []);

  // Handle paste event for images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();

    const newImages: Array<{ url: string; base64: string; mediaType: string }> = [];

    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;

      try {
        // Resize if needed to stay under API limit
        const resizedBlob = await resizeImageIfNeeded(blob);
        const base64 = await blobToBase64(resizedBlob);
        const url = URL.createObjectURL(resizedBlob);
        newImages.push({
          url,
          base64,
          mediaType: resizedBlob.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        });
      } catch (err) {
        // Notify the user instead of silently dropping the error
        setGlobalNotice({
          id: `image-paste-failed-${Date.now()}`,
          type: 'warning',
          message: t('chat.imageProcessFailed'),
        });
      }
    }

    setPastedImages((prev) => [...prev, ...newImages]);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('FileReader result is not a string'));
          return;
        }
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const parts = result.split(',');
        resolve(parts[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Resize and compress image if needed to stay under 5MB base64 limit
  const resizeImageIfNeeded = async (blob: Blob): Promise<Blob> => {
    // Claude API limit is 5MB for base64 encoded images
    // Base64 encoding increases size by ~33%, so we target 3.75MB for the blob
    const MAX_BLOB_SIZE = 3.75 * 1024 * 1024; // 3.75MB

    if (blob.size <= MAX_BLOB_SIZE) {
      return blob; // No need to resize
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // Calculate scaling factor to reduce file size
        // We use a more aggressive approach: scale down until size is acceptable
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Start with a scale factor based on size ratio
        const scale = Math.sqrt(MAX_BLOB_SIZE / blob.size);
        const quality = 0.9;

        const attemptCompress = (currentScale: number, currentQuality: number): Promise<Blob> => {
          canvas.width = Math.floor(img.width * currentScale);
          canvas.height = Math.floor(img.height * currentScale);

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          return new Promise((resolveBlob) => {
            canvas.toBlob(
              (compressedBlob) => {
                if (!compressedBlob) {
                  reject(new Error('Failed to compress image'));
                  return;
                }

                // If still too large, try again with lower quality or scale
                if (compressedBlob.size > MAX_BLOB_SIZE && (currentQuality > 0.5 || currentScale > 0.3)) {
                  const newQuality = Math.max(0.5, currentQuality - 0.1);
                  const newScale = currentQuality <= 0.5 ? currentScale * 0.9 : currentScale;
                  attemptCompress(newScale, newQuality).then(resolveBlob);
                } else {
                  resolveBlob(compressedBlob);
                }
              },
              blob.type || 'image/jpeg',
              currentQuality
            );
          });
        };

        attemptCompress(scale, quality).then(resolve).catch(reject);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  };

  const removeImage = (index: number) => {
    setPastedImages((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].url);
      updated.splice(index, 1);
      return updated;
    });
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });
  };

  const applyDocumentWorkshopPrompt = useCallback(() => {
    setPrompt(documentWorkshopPrompt);
    if (textareaRef.current) {
      textareaRef.current.value = documentWorkshopPrompt;
      textareaRef.current.focus();
      const end = documentWorkshopPrompt.length;
      textareaRef.current.setSelectionRange(end, end);
    }
  }, [documentWorkshopPrompt]);

  const setComposerText = useCallback((text: string) => {
    setPrompt(text);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.value = text;
      textarea.focus();
      textarea.setSelectionRange(text.length, text.length);
    });
  }, []);

  const handleEditQueuedIntent = useCallback(
    (intentId: string, text: string) => {
      if (!activeSessionId) return;
      removeQueuedIntent(activeSessionId, intentId);
      setComposerText(text);
    },
    [activeSessionId, removeQueuedIntent, setComposerText]
  );

  const handleSteerQueuedIntent = useCallback(
    async (intentId: string) => {
      if (!activeSessionId) return;
      const intent = queuedIntents.find((item) => item.id === intentId);
      if (!intent) return;
      removeQueuedIntent(activeSessionId, intentId);
      const result = await steerSession(activeSessionId, intent.content, intent.id);
      if (!result.delivered && !result.fallbackQueued) {
        useAppStore.getState().enqueueQueuedIntent({
          ...intent,
          source: 'leftover_steer',
          updatedAt: Date.now(),
        });
      }
    },
    [activeSessionId, queuedIntents, removeQueuedIntent, steerSession]
  );

  const handleFileSelect = async () => {
    if (!isElectron || !window.electronAPI) {
      console.log('[ChatView] Not in Electron, file selection not available');
      return;
    }

    try {
      const filePaths = await window.electronAPI.selectFiles();
      if (filePaths.length === 0) return;

      const newFiles = filePaths.map(buildAttachmentFromPath);
      setAttachedFiles((prev) => [...prev, ...newFiles]);
    } catch (error) {
      console.error('[ChatView] Error selecting files:', error);
    }
  };

  // Handle drag and drop for images
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);

    // Detect folder drops — switch working directory
    const folderFiles = files.filter(isDroppedFolderCandidate);
    if (folderFiles.length > 0) {
      const folderPath = getDroppedFilePath(folderFiles[0]);
      if (folderPath && window.electronAPI) {
        window.electronAPI.send({
          type: 'workdir.set',
          payload: { path: folderPath },
        });
      }
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    const otherFiles = files.filter((file) => !file.type.startsWith('image/'));

    // Process images
    if (imageFiles.length > 0) {
      const newImages: Array<{ url: string; base64: string; mediaType: string }> = [];

      for (const file of imageFiles) {
        try {
          // Resize if needed to stay under API limit
          const resizedBlob = await resizeImageIfNeeded(file);
          const base64 = await blobToBase64(resizedBlob);
          const url = URL.createObjectURL(resizedBlob);
          newImages.push({
            url,
            base64,
            mediaType: resizedBlob.type,
          });
        } catch (err) {
          // Notify the user instead of silently dropping the error
          setGlobalNotice({
            id: `image-drop-failed-${Date.now()}`,
            type: 'warning',
            message: t('chat.imageProcessFailed'),
          });
        }
      }

      setPastedImages((prev) => [...prev, ...newImages]);
    }

    // Process other files
    if (otherFiles.length > 0) {
      const newFiles = await Promise.all(
        otherFiles.map((file) => buildAttachmentFromDroppedFile(file, blobToBase64))
      );

      setAttachedFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;

    if (
      (!currentPrompt.trim() && pastedImages.length === 0 && attachedFiles.length === 0) ||
      !activeSessionId ||
      isSubmitting
    )
      return;

    setIsSubmitting(true);
    try {
      const trimmedPrompt = currentPrompt.trim();
      const isSlashInput =
        pastedImages.length === 0 &&
        attachedFiles.length === 0 &&
        /^\/[\w-]+(?:\s+.*)?$/.test(trimmedPrompt);

      if (isSlashInput && window.electronAPI?.command?.execute) {
        const [, commandName = '', argString = ''] =
          trimmedPrompt.match(/^\/([\w-]+)(?:\s+(.*))?$/) || [];
        const args = argString ? argString.split(/\s+/).filter(Boolean) : [];
        const result = await window.electronAPI.command.execute(
          commandName,
          args,
          activeSessionId ?? undefined
        );

        if (result.action?.type === 'create_schedule' && result.action.createInput) {
          await window.electronAPI.schedule.create(
            toScheduleCreateInput(result.action.createInput, activeSession?.cwd || '')
          );
          setGlobalNotice({
            id: `schedule-created-${Date.now()}`,
            type: 'success',
            message: t('schedule.created'),
          });
          setPrompt('');
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
          return;
        }

        if (result.action?.type === 'open_schedule' && result.action.draft) {
          setScheduleDraft({
            ...result.action.draft,
            cwd: result.action.draft.cwd || activeSession?.cwd || undefined,
          });
          setSettingsTab('schedule');
          setShowSettings(true);
          setPrompt('');
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
          return;
        }

        // All remaining cases (engine output, prompt-forward, ui_effect,
        // toast/denied, error) are applied by the shared dispatcher. Schedule
        // actions above are kept inline because they use ChatView-local state.
        const handledLocally = applySlashCommandResult(result, {
          commandName,
          activeSessionId: activeSessionId ?? null,
          continueWithPrompt: (p) =>
            continueSession(activeSessionId, [{ type: 'text', text: p }]),
        });
        if (handledLocally) {
          setPrompt('');
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
          return;
        }
      }

      if (
        goalComposerActive &&
        pastedImages.length === 0 &&
        attachedFiles.length === 0 &&
        !isSlashInput &&
        window.electronAPI?.command?.execute
      ) {
        const args = trimmedPrompt.split(/\s+/).filter(Boolean);
        const result = await window.electronAPI.command.execute(
          'goal',
          args,
          activeSessionId ?? undefined
        );
        const handledLocally = applySlashCommandResult(result, {
          commandName: 'goal',
          activeSessionId: activeSessionId ?? null,
          continueWithPrompt: (p) =>
            continueSession(activeSessionId, [{ type: 'text', text: p }]),
        });
        if (handledLocally) {
          setGoalComposerActive(false);
          setPrompt('');
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
          return;
        }
      }

      // Build content blocks
      const contentBlocks = buildComposerContentBlocks(currentPrompt, attachedFiles, pastedImages);

      // Send message with content blocks
      await continueSession(activeSessionId, contentBlocks);

      // Clean up
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      pastedImages.forEach((img) => URL.revokeObjectURL(img.url));
      setPastedImages([]);
      setAttachedFiles([]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = () => {
    interruptSpeech('stop');
    if (activeSessionId) {
      stopSession(activeSessionId);
    }
  };

  // P1.1 — Edit a user message: prefill the textarea and focus it.
  // Non-destructive: original message stays in history; the user resubmits
  // a new turn with the edited text.
  const handleEditMessage = useCallback((_msg: Message, text: string) => {
    setPrompt(text);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.value = text;
        ta.focus();
        const end = text.length;
        ta.setSelectionRange(end, end);
      }
    });
  }, []);

  // P1.1 — Regenerate an assistant response by re-submitting the most
  // recent preceding user message verbatim via continueSession.
  // Non-destructive: appends a new turn rather than mutating history.
  const handleRegenerateMessage = useCallback(
    async (assistantMsg: Message) => {
      if (!activeSessionId || canStop) return;
      const idx = displayedMessages.findIndex((m) => m.id === assistantMsg.id);
      if (idx <= 0) return;
      let userMsg: Message | undefined;
      for (let i = idx - 1; i >= 0; i--) {
        if (displayedMessages[i].role === 'user') {
          userMsg = displayedMessages[i];
          break;
        }
      }
      if (!userMsg) return;
      const blocks = Array.isArray(userMsg.content)
        ? (userMsg.content as ContentBlock[])
        : [{ type: 'text' as const, text: String(userMsg.content ?? '') }];
      await continueSession(activeSessionId, blocks);
    },
    [activeSessionId, canStop, displayedMessages, continueSession]
  );

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span>{t('chat.loadingConversation')}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <ChatHeader />

      {/* Session search */}
      {searchActive && (
        <SessionSearch
          query={searchQuery}
          onQueryChange={(q) => useAppStore.getState().setSearchQuery(q)}
          onClose={() => useAppStore.getState().setSearchActive(false)}
          matchCount={searchMatches.length}
          currentMatch={visibleSearchMatchIndex}
          onNext={goToNextSearchMatch}
          onPrev={goToPreviousSearchMatch}
        />
      )}

      {/* Plan mode banner (Claude Cowork parity Phase 2) */}
      {permissionMode === 'plan' && (
        <div className="px-4 lg:px-8 py-2 bg-accent/10 border-b border-accent/30 flex items-center gap-2">
          <Eye size={14} className="text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-accent">{t('planMode.activeTitle')}</div>
            <div className="text-[11px] text-text-muted truncate">
              {t('planMode.activeDescription')}
            </div>
          </div>
          <button
            onClick={() => {
              window.electronAPI?.permission?.setMode('default');
              useAppStore.getState().setPermissionMode('default');
            }}
            className="text-[11px] text-accent hover:text-accent-hover underline"
          >
            {t('planMode.exit')}
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <ChatList
          displayedMessages={displayedMessages}
          searchMatches={searchMatches}
          activeSearchMatchId={activeSearchMatchId}
          hasActiveTurn={hasActiveTurn}
          partialMessage={partialMessage}
          partialThinking={partialThinking}
          liveElapsed={liveElapsed}
          timerActive={timerActive}
          messagesEndRef={messagesEndRef}
          onEditMessage={handleEditMessage}
          onRegenerateMessage={handleRegenerateMessage}
        />
      </div>

      {/* Input */}
      <div className="border-t border-border-muted bg-background/92 backdrop-blur-md">
        <div className="max-w-[920px] mx-auto px-5 lg:px-8 py-5">
          <form
            onSubmit={handleSubmit}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="relative w-full"
          >
            {/* Phase 3 step 15: full overlay while dragging */}
            {isDragging && (
              <div className="absolute inset-0 z-10 rounded-[2rem] border-2 border-dashed border-accent bg-accent/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                <span className="text-sm font-medium text-accent">
                  {t('chat.dropToAttach', 'Drop files to attach')}
                </span>
              </div>
            )}

            {/* Phase 3 step 3: vision model warning */}
            {pastedImages.length > 0 && modelSupportsVision === false && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning flex items-start gap-2">
                <span className="font-medium">{t('chat.visionWarningTitle')}</span>
                <span className="text-warning/80">{t('chat.visionWarningBody')}</span>
              </div>
            )}

            {/* Image previews */}
            {pastedImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
                {pastedImages.map((img, index) => (
                  <div key={img.url || `pasted-image-${index}`} className="relative group">
                    <img
                      src={img.url}
                      alt={t('common.pastedImageAlt', { index: index + 1 })}
                      className="w-full aspect-square object-cover rounded-lg border border-border block"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* File attachments (Phase 3 step 15: chips with preview) */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {attachedFiles.map((file, index) => (
                  <FileAttachmentChip
                    key={file.path || `attached-file-${index}`}
                    file={file}
                    onRemove={() => removeFile(index)}
                    onPreview={(f) => {
                      if (f.path) {
                        useAppStore.getState().setPreviewFilePath(f.path);
                      }
                    }}
                  />
                ))}
                {shouldShowDocumentWorkshopAction && (
                  <button
                    type="button"
                    onClick={applyDocumentWorkshopPrompt}
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

            {queuedIntents.length > 0 && (
              <div
                className="mb-3 space-y-1.5"
                data-testid="chat-queued-intents"
                aria-label={t('chat.queuedIntents', 'Queued messages')}
              >
                {queuedIntents.map((intent) => (
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
                      onClick={() => removeQueuedIntent(intent.sessionId, intent.id)}
                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                      title={t('common.delete', 'Delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditQueuedIntent(intent.id, intent.prompt)}
                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                      title={t('common.edit', 'Edit')}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSteerQueuedIntent(intent.id)}
                      disabled={!hasActiveTurn && !isSessionRunning}
                      className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title={t('chat.steerQueuedIntent', 'Steer current run')}
                    >
                      <Target className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Phase 2 step 17: inline memory editor */}
            {showMemoryEditor && (
              <div className="mb-3">
                <MemoryEditCard onClose={() => setShowMemoryEditor(false)} />
              </div>
            )}

            <div
              className={`flex items-end gap-2 p-3.5 rounded-[1.75rem] bg-background/88 border border-border-muted shadow-soft transition-colors ${
                isDragging ? 'ring-2 ring-accent bg-accent/5' : ''
              }`}
            >
              <button
                type="button"
                onClick={handleFileSelect}
                data-testid="chat-attach-files"
                className="w-9 h-9 rounded-2xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                title={t('welcome.attachFiles')}
              >
                <Plus className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!goalComposerDisabled) setGoalComposerActive((active) => !active);
                }}
                disabled={goalComposerDisabled}
                data-testid="chat-goal-mode-toggle"
                aria-pressed={goalComposerActive}
                className={`h-9 min-w-9 rounded-2xl inline-flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  goalComposerActive
                    ? 'border border-accent/35 bg-accent/10 text-accent hover:bg-accent/15'
                    : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                }`}
                title={
                  goalComposerActive
                    ? t('goalMode.composerActiveTitle', 'Goal mode active')
                    : t('goalMode.composerToggleTitle', 'Send as a standing goal')
                }
              >
                <Target className="w-4 h-4" />
                <span className="hidden sm:inline">{t('goalMode.composerLabel', 'Goal')}</span>
              </button>

              <textarea
                ref={textareaRef}
                data-testid="chat-prompt-input"
                value={prompt}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setPrompt(newValue);

                  // Detect @ mention trigger
                  const caretPos = e.target.selectionStart ?? newValue.length;
                  const textBeforeCaret = newValue.slice(0, caretPos);
                  const atMatch = textBeforeCaret.match(/(?:^|\s)@([^\s]*)$/);
                  if (atMatch) {
                    const startPos = caretPos - atMatch[1].length - 1;
                    const rect = e.target.getBoundingClientRect();
                    setMentionState({
                      prefix: atMatch[1],
                      startPos,
                      anchor: {
                        top: rect.top - 300,
                        left: rect.left + 20,
                      },
                    });
                  } else {
                    setMentionState(null);
                  }

                  // Detect slash command trigger — only at line start or
                  // after whitespace, and only when the slash is the first
                  // non-whitespace run ending at the caret.
                  const slashMatch = textBeforeCaret.match(/^\s*\/([\w-]*)$/);
                  if (slashMatch) {
                    const prefix = slashMatch[1];
                    const startPos = textBeforeCaret.lastIndexOf('/');
                    const rect = e.target.getBoundingClientRect();
                    setSlashState({
                      prefix,
                      startPos,
                      anchor: {
                        top: rect.top - 340,
                        left: rect.left + 20,
                      },
                    });
                  } else {
                    setSlashState(null);
                  }
                }}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  // Enter to send, Shift+Enter for new line
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
                      return;
                    }
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={
                  goalComposerActive
                    ? t('goalMode.promptPlaceholder', 'Describe the standing goal')
                    : t('chat.typeMessage')
                }
                disabled={isSubmitting}
                rows={1}
                className="flex-1 resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-[15px] py-2"
              />

              <div className="flex items-center gap-2">
                {/* Phase 8 — local voice transcription via faster-whisper.
                    Replaces the Web-Speech-API VoiceButton which required
                    network. MicButton appends the transcript to the
                    current prompt instead of overwriting it, so users
                    can dictate fragments. */}
                <MicButton
                  language="fr"
                  onTranscript={(text) => {
                    setPrompt((current) => (current ? `${current} ${text}` : text));
                    textareaRef.current?.focus();
                  }}
                />

                {/* Model display */}
                <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted">
                  {appConfig?.model || t('chat.noModel')}
                </span>

                {canStop && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="w-9 h-9 rounded-2xl flex items-center justify-center bg-error/10 text-error hover:bg-error/20 transition-colors"
                    title={
                      queuedIntents.length > 0
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
                    (!prompt.trim() &&
                      !textareaRef.current?.value.trim() &&
                      pastedImages.length === 0 &&
                      attachedFiles.length === 0) ||
                    isSubmitting
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
      </div>

      {/* @mention autocomplete dropdown (Claude Cowork parity) */}
      {mentionState && (
        <MentionAutocomplete
          prefix={mentionState.prefix}
          cwd={activeSession?.cwd}
          anchorPosition={mentionState.anchor}
          onSelect={(item: MentionItem) => {
            if (!mentionState || !textareaRef.current) return;
            const before = prompt.slice(0, mentionState.startPos);
            const afterCaret = prompt.slice(mentionState.startPos + mentionState.prefix.length + 1);
            const newValue = `${before}${item.value}${afterCaret}`;
            setPrompt(newValue);
            setMentionState(null);
            setTimeout(() => {
              const newCaret = before.length + item.value.length;
              textareaRef.current?.focus();
              textareaRef.current?.setSelectionRange(newCaret, newCaret);
            }, 0);
          }}
          onClose={() => setMentionState(null)}
        />
      )}

      {/* Slash command palette (Claude Cowork parity Phase 2) */}
      {slashState && (
        <SlashCommandPalette
          prefix={slashState.prefix}
          anchorPosition={slashState.anchor}
          onSelect={async (item: SlashCommandItem) => {
            if (!textareaRef.current) return;
            const api = window.electronAPI;
            if (!api?.command) {
              setSlashState(null);
              return;
            }

            // Execute command via bridge. If it resolves to a prompt, we
            // swap the slash text for the resolved prompt in the textarea.
            // If it's handled client-side (__TOKEN__), we fire the built-in
            // effect and clear the textarea.
            try {
              // Phase 2 step 17: intercept /memory to open the inline editor
              if (item.name === 'memory' || item.name.startsWith('memory')) {
                useAppStore.getState().setShowMemoryEditor(true);
                setPrompt('');
                setSlashState(null);
                return;
              }

              const result = await api.command.execute(item.name, [], activeSessionId ?? undefined);

              if (result.action?.type === 'create_schedule' && result.action.createInput) {
                await window.electronAPI.schedule.create(
                  toScheduleCreateInput(result.action.createInput, activeSession?.cwd || '')
                );
                useAppStore.getState().setGlobalNotice?.({
                  id: `schedule-created-${Date.now()}`,
                  type: 'success',
                  message: t('schedule.created'),
                });
                setPrompt('');
              } else if (result.action?.type === 'open_schedule' && result.action.draft) {
                setScheduleDraft({
                  ...result.action.draft,
                  cwd: result.action.draft.cwd || activeSession?.cwd || undefined,
                });
                setSettingsTab('schedule');
                setShowSettings(true);
                setPrompt('');
              } else {
                // Engine output, ui_effect, toast/denied and prompt-forward are
                // applied by the shared dispatcher. In the palette, a
                // prompt-resolving command fills the textarea for editing rather
                // than sending immediately, so we keep that UX in the callback.
                let promptFilled = false;
                applySlashCommandResult(result, {
                  commandName: item.name,
                  activeSessionId: activeSessionId ?? null,
                  continueWithPrompt: (p) => {
                    promptFilled = true;
                    setPrompt(p);
                    setTimeout(() => {
                      textareaRef.current?.focus();
                      textareaRef.current?.setSelectionRange(p.length, p.length);
                    }, 0);
                  },
                });
                if (!promptFilled) setPrompt('');
              }
            } catch (err) {
              console.error('[ChatView] Slash command execute failed:', err);
            } finally {
              setSlashState(null);
            }
          }}
          onClose={() => setSlashState(null)}
        />
      )}
    </div>
  );
}
