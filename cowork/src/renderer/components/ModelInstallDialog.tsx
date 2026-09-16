/**
 * ModelInstallDialog — guides the user through installing the Buffalo_S
 * ONNX face-recognition model required by the presence feature.
 *
 * V0 UX (Phase 1): file-picker only. The user downloads buffalo_s.onnx
 * manually (~13 MB from InsightFace's model zoo), then clicks "Choose
 * file…" to point Cowork at it. The main process validates magic bytes
 * + size and copies it to <userData>/models/buffalo_s.onnx.
 *
 * The dialog is mounted from App.tsx but stays hidden until a trigger
 * sets `showModelInstallDialog`. First-run chat must not be blocked by a
 * face-recognition model the user never asked for.
 *
 * Trigger surfaces:
 *   - User clicks "Enroll" → EnrollmentDialog tries presence.encode →
 *     gets "model not found" error → dispatches setShowModelInstallDialog.
 *   - User explicitly opens the dialog from settings (V0.5+).
 *
 * @module cowork/renderer/components/ModelInstallDialog
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { Cpu, X, FolderOpen, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type DialogStatus = 'idle' | 'checking' | 'installing' | 'downloading' | 'success' | 'error';

/**
 * Default download URL — InsightFace's model zoo doesn't expose a stable
 * direct .onnx, so we point at the most popular community mirror
 * (Immich's mirror of buffalo_s, used by their face-recognition feature).
 *
 * The Buffalo_S "model pack" is actually a zip with several ONNX files
 * (detection, recognition, gender-age…). For face recognition we only
 * need the recognition stream (`recognition/model.onnx`, ~13 MB). The
 * Immich mirror exposes it directly — no zip to extract.
 *
 * The field is editable so the user can paste another mirror if this
 * one goes away — we never silently fetch from a hardcoded URL.
 */
const DEFAULT_DOWNLOAD_URL =
  'https://huggingface.co/immich-app/buffalo_s/resolve/main/recognition/model.onnx';

export function ModelInstallDialog() {
  const { t } = useTranslation();
  const showModelInstallDialog = useAppStore((s) => s.showModelInstallDialog);
  const setShowModelInstallDialog = useAppStore((s) => s.setShowModelInstallDialog);

  const [installed, setInstalled] = useState<boolean | null>(null);
  const [dismissedForSession, setDismissedForSession] = useState(false);
  const [modelPath, setModelPath] = useState<string>('');
  const [status, setStatus] = useState<DialogStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string>(DEFAULT_DOWNLOAD_URL);
  const [progress, setProgress] = useState<{ bytes: number; total: number | null } | null>(null);
  const unsubProgressRef = useRef<(() => void) | null>(null);

  // Probe the model on mount AND when the user explicitly opens the
  // dialog from elsewhere — that way after enrollment fails we can
  // refresh the "installed" state.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      setStatus('checking');
      try {
        const res = await window.electronAPI?.presence?.hasModel();
        if (cancelled) return;
        if (res) {
          setInstalled(res.installed);
          setModelPath(res.path);
        }
        setStatus('idle');
      } catch (err) {
        if (cancelled) return;
        setErrorMsg((err as Error).message);
        setStatus('error');
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [showModelInstallDialog]);

  useEffect(() => {
    if (showModelInstallDialog) {
      setDismissedForSession(false);
    }
  }, [showModelInstallDialog]);

  // Tear down the progress listener whenever the dialog unmounts or
  // a new download starts. MUST be declared BEFORE any early-return
  // so the hook order is stable across renders (React Rules of Hooks).
  // Previously this lived after the `installed === true && !showDialog`
  // early-returns, which caused React error #185 in production builds
  // when `installed` flipped from null → false (the dialog suddenly
  // ran 7 hooks instead of 6 between renders).
  useEffect(() => {
    return () => {
      unsubProgressRef.current?.();
      unsubProgressRef.current = null;
    };
  }, []);

  // Never auto-popup. A missing Buffalo_S model is optional companion
  // vision, not a prerequisite for chat / settings / onboarding.
  if (!showModelInstallDialog) {
    return null;
  }

  const handleClose = () => {
    setShowModelInstallDialog(false);
    setDismissedForSession(true);
    setStatus('idle');
    setErrorMsg(null);
    setProgress(null);
    unsubProgressRef.current?.();
    unsubProgressRef.current = null;
  };

  const handleDownload = async () => {
    setErrorMsg(null);
    setProgress({ bytes: 0, total: null });
    setStatus('downloading');

    unsubProgressRef.current?.();
    unsubProgressRef.current =
      window.electronAPI?.presence?.onDownloadProgress((p) => {
        setProgress(p);
      }) ?? null;

    try {
      const res = await window.electronAPI?.presence?.downloadModel({ url: downloadUrl });
      if (!res || !res.ok) {
        setErrorMsg(res?.error ?? t('modelInstall.downloadFailed', 'Download failed.'));
        setStatus('error');
        return;
      }
      setInstalled(true);
      setModelPath(res.installedPath ?? modelPath);
      setStatus('success');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    } finally {
      unsubProgressRef.current?.();
      unsubProgressRef.current = null;
    }
  };

  const handlePickFile = async () => {
    setErrorMsg(null);
    try {
      const sourcePath = await window.electronAPI?.presence?.selectModelFile();
      if (!sourcePath) return; // user cancelled
      setStatus('installing');
      const res = await window.electronAPI?.presence?.installModelFromPath({ sourcePath });
      if (!res || !res.ok) {
        setErrorMsg(res?.error ?? t('modelInstall.installFailed', 'Installation failed.'));
        setStatus('error');
        return;
      }
      setInstalled(true);
      setModelPath(res.installedPath ?? modelPath);
      setStatus('success');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      data-testid="model-install-dialog"
    >
      <div className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Cpu className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                {t('modelInstall.title', 'Buffalo_S model required')}
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                {t('modelInstall.subtitle', 'Face recognition (~13 MB, ONNX)')}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-surface text-text-secondary"
            aria-label={t('common.close', 'Close')}
            title={t('common.close', 'Close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {installed ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/5 border border-green-500/20 mb-4">
            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
            <div className="text-xs text-text-secondary">
              {t('modelInstall.installedPrefix', 'Model installed at')}{' '}
              <code className="text-text-primary">{modelPath}</code>.{' '}
              {t('modelInstall.installedSuffix', 'You can close this dialog; face recognition is ready.')}
            </div>
          </div>
        ) : (
          <div className="text-sm text-text-secondary space-y-3 mb-4">
            <p>
              {t(
                'modelInstall.body',
                'Cowork needs Buffalo_S (ArcFace, 13 MB) to recognize faces. You can let Cowork download it from a public mirror or choose an already downloaded .onnx file.'
              )}
            </p>
            <p className="text-xs">
              {t('modelInstall.targetPath', 'Install target:')}{' '}
              <code className="text-text-primary">
                {modelPath || t('modelInstall.detecting', '(detecting...)')}
              </code>
            </p>
          </div>
        )}

        {!installed && (
          <div className="border border-border rounded-lg p-3 mb-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-text-primary">
              <Download className="w-3.5 h-3.5" />
              {t('modelInstall.autoDownload', 'Automatic download')}
            </div>
            <input
              type="url"
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://…/buffalo_s.onnx"
              spellCheck={false}
              disabled={status === 'downloading'}
              className="w-full text-xs px-2 py-1 rounded border border-border bg-surface text-text-primary disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary">
              {t(
                'modelInstall.mirrorHint',
                'Default mirror: HuggingFace (immich-app/buffalo_s). You can paste another public .onnx URL if this mirror is unavailable.'
              )}
            </p>

            {progress && status === 'downloading' && (
              <div className="space-y-1">
                <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-[width] duration-150"
                    style={{
                      width:
                        progress.total && progress.total > 0
                          ? `${Math.min(100, (progress.bytes / progress.total) * 100)}%`
                          : '50%',
                    }}
                  />
                </div>
                <div className="text-[11px] text-text-secondary tabular-nums">
                  {(progress.bytes / (1024 * 1024)).toFixed(1)}{' '}
                  {t('modelInstall.sizeUnit', 'MB')}
                  {progress.total
                    ? ` / ${(progress.total / (1024 * 1024)).toFixed(1)} ${t('modelInstall.sizeUnit', 'MB')}`
                    : ` ${t('modelInstall.unknownSize', '(unknown size)')}`}
                </div>
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={
                status === 'downloading' ||
                status === 'installing' ||
                downloadUrl.trim().length === 0
              }
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              {status === 'downloading'
                ? t('modelInstall.downloading', 'Downloading...')
                : t('modelInstall.download', 'Download')}
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="text-xs text-red-500">{errorMsg}</div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <a
            href="https://github.com/deepinsight/insightface/tree/master/python-package"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-text-secondary hover:text-blue-500 hover:underline"
          >
            {t('modelInstall.learnMore', 'Learn more about Buffalo_S')}
          </a>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              data-testid="model-install-close"
              className="px-3 py-1.5 text-xs rounded-md text-text-secondary hover:bg-surface"
            >
              {t('common.close', 'Close')}
            </button>
            <button
              onClick={handlePickFile}
              disabled={status === 'installing' || status === 'checking' || status === 'downloading'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-text-primary hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {status === 'installing'
                ? t('modelInstall.installing', 'Installing...')
                : installed
                  ? t('modelInstall.replaceFile', 'Replace file...')
                  : t('modelInstall.localFile', 'Local file...')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
