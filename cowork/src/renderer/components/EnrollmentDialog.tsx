/**
 * EnrollmentDialog — capture 5 face samples and persist a new identity.
 *
 * Flow:
 *   1. User opens the dialog, allows webcam access.
 *   2. The component initialises `FaceDetector` (MediaPipe BlazeFace) and
 *      starts a render loop on the live `<video>` stream.
 *   3. The user types a name + optional aliases (comma-separated).
 *   4. The user clicks "Capture" five times — each click crops the
 *      current largest detected face to 112×112 RGB, ships it to main
 *      via `presence.encode`, and stages the embedding locally.
 *   5. On the 5th sample, the component calls `presence.enroll` with
 *      the first sample (the rest are added via `presence.addSample`,
 *      so the rolling-average store stays consistent).
 *
 * Minimal V0 UX: no avatar preview, no auto-capture, no quality scoring.
 * Just "name, capture, save". The polished flow can iterate later.
 *
 * @module cowork/renderer/components/EnrollmentDialog
 */

import { useEffect, useRef, useState } from 'react';
import {
  FaceDetector,
  createFaceDetector,
} from '../services/presence/face-detector';
import {
  cropFaceToRgbBytes,
  largestFace,
} from '../services/presence/face-utils';
import type { FaceDetection } from '../../shared/presence/types';
import { useAppStore } from '../store';
import { useTranslation } from 'react-i18next';
import { dialogA11yProps, trapFocus } from '../utils/a11y';

/**
 * Substring used to detect that the main process raised the
 * "Buffalo_S model not found" error from face-recognizer.ts. We don't
 * have a structured error code over IPC, so this is the contract.
 */
const MODEL_MISSING_ERROR_HINT = 'model not found';

const SAMPLES_REQUIRED = 5;

// Window.electronAPI.presence is declared in cowork/src/preload/index.ts
// (the canonical declaration also lives there for every other API surface
// — keeping the contract in one file avoids duplicate-declaration errors).

export interface EnrollmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onEnrolled?: (personId: string) => void;
}

export function EnrollmentDialog({ isOpen, onClose, onEnrolled }: EnrollmentDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [aliasesInput, setAliasesInput] = useState('');
  const [samplesCaught, setSamplesCaught] = useState(0);
  const [status, setStatus] = useState<'idle' | 'starting' | 'ready' | 'capturing' | 'saving' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [latestDetection, setLatestDetection] = useState<FaceDetection | null>(null);
  const setShowModelInstallDialog = useAppStore((s) => s.setShowModelInstallDialog);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stagedEmbeddings = useRef<number[][]>([]);
  const personIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const setShowModelInstallDialogRef = useRef(setShowModelInstallDialog);

  useEffect(() => {
    onCloseRef.current = onClose;
    setShowModelInstallDialogRef.current = setShowModelInstallDialog;
  }, [onClose, setShowModelInstallDialog]);

  // Bootstrap: webcam + detector. Tear down on close/unmount.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setStatus('starting');
    setErrorMsg(null);

    const start = async () => {
      try {
        // Phase (d).21 ship 2 — proactive model check.
        // If the Buffalo_S model isn't installed, open ModelInstallDialog
        // and abort the enrollment bootstrap *before* taking the camera.
        // The reactive fallback at the encode call site stays as a safety
        // net for races where hasModel() lies.
        const hm = await window.electronAPI?.presence?.hasModel();
        if (cancelled) return;
        if (hm && !hm.installed) {
          setShowModelInstallDialogRef.current(true);
          onCloseRef.current();
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = createFaceDetector({ runningMode: 'VIDEO', delegate: 'GPU' });
        await detector.initialize();
        if (cancelled) {
          detector.close();
          return;
        }
        detectorRef.current = detector;
        setStatus('ready');
        loop();
      } catch (err) {
        if (!cancelled) {
          setErrorMsg((err as Error).message);
          setStatus('error');
        }
      }
    };

    const loop = async () => {
      if (cancelled || !detectorRef.current || !videoRef.current) return;
      try {
        const detections = await detectorRef.current.detect(videoRef.current);
        if (detections.length > 0) {
          setLatestDetection(largestFace(detections));
        } else {
          setLatestDetection(null);
        }
      } catch {
        // Detection occasionally throws on resolution mismatches — skip frame.
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    void start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      detectorRef.current?.close();
      detectorRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      stagedEmbeddings.current = [];
      personIdRef.current = null;
      setSamplesCaught(0);
      setStatus('idle');
      setLatestDetection(null);
    };
  }, [isOpen]);

  // Trap focus inside the modal while it is open.
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    return trapFocus(dialogRef.current);
  }, [isOpen]);

  const handleCapture = async () => {
    if (!latestDetection || !videoRef.current || !window.electronAPI) {
      setErrorMsg(
        t('enrollment.noFaceDetected', 'No face detected. Face the camera squarely and retry.')
      );
      return;
    }
    setStatus('capturing');
    try {
      const rgbBytes = cropFaceToRgbBytes(videoRef.current, latestDetection);
      const embedding = await window.electronAPI.presence.encode({
        rgbBytes: Array.from(rgbBytes),
      });
      stagedEmbeddings.current.push(embedding);
      setSamplesCaught(stagedEmbeddings.current.length);

      if (stagedEmbeddings.current.length >= SAMPLES_REQUIRED) {
        setStatus('saving');
        await persistAll();
        setStatus('done');
        onEnrolled?.(personIdRef.current ?? '');
      } else {
        setStatus('ready');
      }
    } catch (err) {
      const msg = (err as Error).message;
      // Buffalo_S model not installed yet — pop the install dialog so the
      // user can browse to their downloaded .onnx instead of staring at a
      // raw error stack.
      if (msg.toLowerCase().includes(MODEL_MISSING_ERROR_HINT)) {
        setShowModelInstallDialog(true);
        setErrorMsg(t('enrollment.modelMissing', 'Buffalo_S model missing. Installation required.'));
      } else {
        setErrorMsg(msg);
      }
      setStatus('error');
    }
  };

  const persistAll = async () => {
    if (!window.electronAPI) throw new Error('electronAPI unavailable');
    const aliases = aliasesInput
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const [first, ...rest] = stagedEmbeddings.current;

    const enrolled = (await window.electronAPI.presence.enroll({
      name: name.trim(),
      aliases,
      embedding: first,
    })) as { id: string };
    personIdRef.current = enrolled.id;

    for (const emb of rest) {
      await window.electronAPI.presence.addSample({
        personId: enrolled.id,
        embedding: emb,
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        ref={dialogRef}
        className="w-[640px] max-w-[90vw] rounded-lg bg-surface p-6 shadow-xl text-text-primary"
        {...dialogA11yProps(t('enrollment.title', 'Register a face'))}
      >
        <h2 className="text-lg font-semibold mb-4">
          {t('enrollment.title', 'Register a face')}
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm">
              {t('enrollment.nameLabel', 'Name')}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('enrollment.namePlaceholder', 'Patrice')}
                className="block w-full rounded border border-border bg-surface px-2 py-1 text-text-primary"
              />
            </label>
            <label className="text-sm">
              {t('enrollment.aliasesLabel', 'Aliases (comma-separated)')}
              <input
                type="text"
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                placeholder={t('enrollment.aliasesPlaceholder', 'boss, teammate')}
                className="block w-full rounded border border-border bg-surface px-2 py-1 text-text-primary"
              />
            </label>
            <p className="text-xs text-text-muted">
              {t(
                'enrollment.aliasesHelp',
                'Aliases are optional names the AI can use to greet you depending on context.'
              )}
            </p>

            <div className="text-sm">
              {t('enrollment.samplesLabel', 'Samples:')}{' '}
              <strong>{samplesCaught} / {SAMPLES_REQUIRED}</strong>
            </div>

            {status === 'error' && errorMsg && (
              <div className="text-sm text-error">
                {t('enrollment.errorLabel', 'Error:')} {errorMsg}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCapture}
                disabled={
                  status !== 'ready' ||
                  !latestDetection ||
                  !name.trim() ||
                  samplesCaught >= SAMPLES_REQUIRED
                }
                className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50"
              >
                {t('enrollment.capture', 'Capture')}
              </button>
              <button
                onClick={onClose}
                className="rounded border border-border px-3 py-1 text-text-primary"
              >
                {status === 'done' ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
              </button>
            </div>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            {latestDetection && (
              <div
                className="pointer-events-none absolute border-2 border-cyan-400"
                style={{
                  left: `${(latestDetection.boundingBox.x / 640) * 100}%`,
                  top: `${(latestDetection.boundingBox.y / 480) * 100}%`,
                  width: `${(latestDetection.boundingBox.width / 640) * 100}%`,
                  height: `${(latestDetection.boundingBox.height / 480) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// `largestFace` and `cropFaceToRgbBytes` moved to
// `cowork/src/renderer/services/presence/face-utils.ts` so PresenceService
// can share the same crop pipeline.
