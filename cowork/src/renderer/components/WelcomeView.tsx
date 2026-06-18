import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { getInitialSessionTitle } from '../../shared/session-title';
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
  Wrench,
  Bug,
  Search,
  TestTube,
  ShieldCheck,
  ArrowRight,
  History,
  X,
  Paperclip,
  Brain,
  FileSearch,
  FolderOpen,
} from 'lucide-react';
import { ProjectSelector } from './ProjectSelector';
import { Tooltip } from './Tooltip';
import { FileAttachmentChip } from './FileAttachmentChip';
import { APP_NAME } from '../brand';

import welcomeLogoSrc from '../assets/logo.png';

export function WelcomeView() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isComposingRef = useRef(false);
  const [pastedImages, setPastedImages] = useState<
    Array<{ url: string; base64: string; mediaType: string }>
  >([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { startSession, changeWorkingDir, isElectron } = useIPC();
  const workingDir = useAppStore((state) => state.workingDir);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const setGlobalNotice = useAppStore((state) => state.setGlobalNotice);
  const isConfigured = useAppStore((state) => state.isConfigured);
  const sessions = useAppStore((state) => state.sessions);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const setShowResumeChooser = useAppStore((state) => state.setShowResumeChooser);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setPreviewFilePath = useAppStore((state) => state.setPreviewFilePath);
  const canSubmit = prompt.trim().length > 0 || pastedImages.length > 0 || attachedFiles.length > 0;
  const shouldShowDocumentWorkshopAction =
    attachedFiles.some(hasDocumentWorkshopAttachment) && prompt.trim().length === 0;

  const handleSelectFolder = async () => {
    try {
      const result = await changeWorkingDir(undefined, workingDir || undefined);
      if (!result.success && result.error && result.error !== 'User cancelled') {
        setGlobalNotice({
          id: `notice-workdir-select-${Date.now()}`,
          type: 'warning',
          message: `${t('welcome.selectWorkingFolderFailed')}: ${result.error}`,
        });
      }
    } catch (error) {
      setGlobalNotice({
        id: `notice-workdir-select-${Date.now()}`,
        type: 'error',
        message:
          error instanceof Error && error.message
            ? `${t('welcome.selectWorkingFolderFailed')}: ${error.message}`
            : t('welcome.selectWorkingFolderFailed'),
      });
    }
  };

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
          mediaType: resizedBlob.type,
        });
      } catch (err) {
        console.error('Failed to process pasted image:', err);
      }
    }

    setPastedImages((prev) => [...prev, ...newImages]);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
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
                if (
                  compressedBlob.size > MAX_BLOB_SIZE &&
                  (currentQuality > 0.5 || currentScale > 0.3)
                ) {
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

  const handleFileSelect = async () => {
    if (!isElectron || !window.electronAPI) {
      console.log('[WelcomeView] Not in Electron, file selection not available');
      return;
    }

    try {
      const filePaths = await window.electronAPI.selectFiles();
      if (filePaths.length === 0) return;

      const newFiles = filePaths.map(buildAttachmentFromPath);
      setAttachedFiles((prev) => [...prev, ...newFiles]);
    } catch (error) {
      console.error('[WelcomeView] Error selecting files:', error);
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
          console.error('Failed to process dropped image:', err);
        }
      }

      setPastedImages((prev) => [...prev, ...newImages]);
    }

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
      isSubmitting
    )
      return;

    // Build content blocks
    const contentBlocks = buildComposerContentBlocks(currentPrompt, attachedFiles, pastedImages);

    // Use the global working directory (always available after app startup)
    setIsSubmitting(true);
    try {
      const sessionTitle = getInitialSessionTitle(currentPrompt, attachedFiles[0]?.name);
      const session = await startSession(
        sessionTitle,
        contentBlocks,
        workingDir || undefined,
        activeProjectId ?? undefined,
        memoryEnabled
      );
      if (session) {
        setPrompt('');
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        pastedImages.forEach((img) => URL.revokeObjectURL(img.url));
        setPastedImages([]);
        setAttachedFiles([]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTagClick = (tag: string, tagPrompt: string) => {
    setSelectedTag(tag === selectedTag ? null : tag);
    if (tag !== selectedTag) {
      setPrompt(tagPrompt);
      if (textareaRef.current) {
        textareaRef.current.value = tagPrompt;
        // Trigger height adjustment
        adjustTextareaHeight();
      }
    }
  };

  // Auto-adjust textarea height based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set max height to 200px (about 8 lines), then scroll
      const maxHeight = 200;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
      // Show scrollbar if content exceeds max height
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  };

  const applyDocumentWorkshopPrompt = () => {
    const workshopPrompt = buildDocumentWorkshopPrompt(attachedFiles);
    setPrompt(workshopPrompt);
    if (textareaRef.current) {
      textareaRef.current.value = workshopPrompt;
      textareaRef.current.focus();
      requestAnimationFrame(() => {
        const end = workshopPrompt.length;
        textareaRef.current?.setSelectionRange(end, end);
        adjustTextareaHeight();
      });
    }
  };

  // Adjust height when prompt changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [prompt]);

  const quickTags = [
    {
      id: 'refactor',
      label: t('welcome.refactorCode'),
      icon: Wrench,
      prompt: t('welcome.quickPromptRefactor'),
    },
    {
      id: 'bug',
      label: t('welcome.fixBug'),
      icon: Bug,
      prompt: t('welcome.quickPromptBug'),
    },
    {
      id: 'explain',
      label: t('welcome.explainCode'),
      icon: Search,
      prompt: t('welcome.quickPromptExplain'),
    },
    {
      id: 'tests',
      label: t('welcome.writeTests'),
      icon: TestTube,
      prompt: t('welcome.quickPromptTests'),
    },
    {
      id: 'review',
      label: t('welcome.codeReview'),
      icon: ShieldCheck,
      prompt: t('welcome.quickPromptReview'),
    },
  ];

  return (
    <div
      className="relative flex-1 flex flex-col items-center justify-center overflow-hidden px-5 py-10 md:px-8 md:py-14"
      data-testid="welcome-view"
    >
      {/* Soft accent glow (theme-adaptive sparkle) */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-20 h-72 w-72 -translate-x-1/2 rounded-full bg-accent/10 blur-[110px]"
      />
      <div className="relative max-w-[840px] w-full space-y-7 animate-fade-in">
        <div className="space-y-4 text-center">
          <div className="flex items-center justify-center gap-4">
            <img
              src={welcomeLogoSrc}
              alt={t('welcome.logoAlt', { appName: APP_NAME })}
              className="w-16 h-16 md:w-20 md:h-20 rounded-[1.4rem] object-cover border border-border-subtle bg-background/60 shadow-soft"
            />
            <div className="text-left">
              <h1 className="text-[2.35rem] md:text-[3.1rem] leading-none font-semibold tracking-[-0.05em] bg-gradient-to-br from-text-primary via-text-primary to-accent bg-clip-text text-transparent">
                {APP_NAME}
              </h1>
            </div>
          </div>
          <p className="heading-serif text-[1.15rem] md:text-[1.45rem] font-medium tracking-[-0.02em] text-text-secondary text-center">
            {t('welcome.title')}
          </p>
        </div>

        {/* API Not Configured Hint */}
        {!isConfigured && (
          <p className="text-sm text-text-muted text-center">
            {t('welcome.apiNotConfigured')}{' '}
            <button
              type="button"
              onClick={() => {
                setSettingsTab('api');
                setShowSettings(true);
              }}
              data-testid="welcome-api-settings-cta"
              className="inline-flex items-center gap-1 text-accent hover:text-accent-hover transition-colors"
            >
              {t('welcome.goToSettings')}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </p>
        )}

        {/* Quick Action Tags */}
        <div className="max-w-[320px] mx-auto">
          <ProjectSelector />
        </div>

        <div className="flex justify-center px-3">
          <button
            type="button"
            onClick={() => setShowResumeChooser(true)}
            className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-background/65 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
            data-testid="welcome-resume-session"
          >
            <History className="w-4 h-4 text-text-muted" />
            <span>
              {t('sessionResume.resumeCta', {
                count: sessions.length,
                defaultValue: 'Resume session',
              })}
            </span>
          </button>
        </div>

        {/* Quick-action cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 px-3 max-w-2xl mx-auto w-full">
          {quickTags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => handleTagClick(tag.id, tag.prompt)}
              className={`group/card flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
                selectedTag === tag.id
                  ? 'border-accent/40 bg-accent-muted text-accent'
                  : 'border-border-subtle bg-background/70 text-text-secondary hover:border-accent/30 hover:text-text-primary'
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  selectedTag === tag.id
                    ? 'bg-accent/15 text-accent'
                    : 'bg-surface-hover/70 text-text-muted group-hover/card:text-accent'
                }`}
              >
                <tag.icon className="w-4 h-4" />
              </span>
              <span className="text-sm font-medium">{tag.label}</span>
            </button>
          ))}
        </div>

        {/* Main Input Card - Right aligned */}
        <form
          onSubmit={handleSubmit}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-[1.9rem] border border-border-muted bg-background/85 shadow-soft px-5 py-5 space-y-4 transition-colors ${
            isDragging ? 'ring-2 ring-accent bg-accent/5' : ''
          }`}
        >
          {/* Image previews */}
          {pastedImages.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 pb-2 border-b border-border w-full">
              {pastedImages.map((img, index) => (
                <div key={index} className="relative group">
                  <img
                    src={img.url}
                    alt={t('welcome.pastedImageAlt', { index: index + 1 })}
                    className="w-full aspect-square object-cover rounded-lg border border-border"
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

          {/* File attachments */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {attachedFiles.map((file, index) => (
                <FileAttachmentChip
                  key={file.path || `welcome-attached-file-${index}`}
                  file={file}
                  onRemove={() => removeFile(index)}
                  onPreview={(candidate) => {
                    if (candidate.path) {
                      setPreviewFilePath(candidate.path);
                    }
                  }}
                />
              ))}
              {shouldShowDocumentWorkshopAction && (
                <Tooltip label={t('welcome.documentWorkshopActionTitle', 'Prepare a Word workshop prompt')} side="top">
                  <button
                    type="button"
                    onClick={applyDocumentWorkshopPrompt}
                    data-testid="welcome-document-workshop-action"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-accent/35 bg-accent/10 text-xs font-medium text-accent hover:bg-accent/15 transition-colors"
                  >
                    <FileSearch className="w-3.5 h-3.5" />
                    <span>{t('welcome.documentWorkshopAction', 'Atelier Word')}</span>
                  </button>
                </Tooltip>
              )}
            </div>
          )}

          {/* Text Input - Auto-resizing */}
          <textarea
            ref={textareaRef}
            data-testid="welcome-prompt-input"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              adjustTextareaHeight();
            }}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onPaste={handlePaste}
            placeholder={t('welcome.placeholder')}
            rows={1}
            style={{ minHeight: '72px', maxHeight: '200px' }}
            className="w-full resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-base leading-relaxed overflow-hidden"
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
          />

          {/* Bottom Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-border-muted">
            <div className="flex items-center gap-3">
              <Tooltip label={t('welcome.toggleMemory', 'Toggle cross-session memory')} side="top">
                <button
                  type="button"
                  onClick={() => setMemoryEnabled(!memoryEnabled)}
                  className={`flex items-center gap-2 text-sm transition-colors ${
                    memoryEnabled
                      ? 'text-accent hover:text-accent-hover'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Brain className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {memoryEnabled
                      ? t('welcome.memoryEnabled', 'Memory On')
                      : t('welcome.memoryDisabled', 'Memory Off')}
                  </span>
                </button>
              </Tooltip>

              <Tooltip label={workingDir || t('welcome.selectWorkingFolder')} side="top">
                <button
                  type="button"
                  onClick={handleSelectFolder}
                  className={`flex items-center gap-2 text-sm transition-colors ${
                    workingDir
                      ? 'text-text-secondary hover:text-text-primary'
                      : 'text-accent hover:text-accent-hover'
                  }`}
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>
                    {workingDir ? workingDir.split(/[/\\]/).pop() : t('welcome.selectWorkingFolder')}
                  </span>
                </button>
              </Tooltip>

              {isElectron && (
                <button
                  type="button"
                  onClick={handleFileSelect}
                  data-testid="welcome-attach-files"
                  className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Paperclip className="w-4 h-4" />
                  <span>{t('welcome.attachFiles')}</span>
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="btn btn-primary px-5 py-2.5 rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isSubmitting ? t('welcome.starting') : t('welcome.letsGo')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
