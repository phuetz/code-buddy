/**
 * MicButton — push-to-talk voice capture for ChatView.
 *
 * Uses MediaRecorder (webm/opus) to capture audio while the user holds
 * the button. Releasing sends the recording to the main process for
 * faster-whisper transcription. Hard-cap at 60 s to avoid runaway
 * recordings.
 *
 * @module renderer/components/MicButton
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mic, MicOff } from 'lucide-react';

interface MicButtonProps {
  onTranscript: (text: string) => void;
  language?: string;
  /** Hard cap in ms — recording auto-stops after this delay. */
  maxDurationMs?: number;
}

type Status = 'idle' | 'recording' | 'transcribing' | 'unsupported' | 'error';

export const MicButton: React.FC<MicButtonProps> = ({
  onTranscript,
  language = 'fr',
  maxDurationMs = 60000,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopAllStreams();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAllStreams = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    stopTimerRef.current = null;
    tickRef.current = null;
  };

  const startRecording = async () => {
    if (status !== 'idle') return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setErrorMsg('mediaDevices unavailable');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // The browser picks the best supported mime; the main bridge
      // hands the bytes to ffmpeg/av (faster-whisper) which handles
      // webm, ogg, mp4, raw — all codec-agnostic.
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stopAllStreams();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];
        if (blob.size === 0) {
          setStatus('idle');
          return;
        }
        await transcribe(blob);
      };
      recorder.start();
      startTimeRef.current = Date.now();
      setElapsedSec(0);
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);
      stopTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, maxDurationMs);
      setStatus('recording');
      setErrorMsg(null);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
      stopAllStreams();
    }
  };

  const stopRecording = () => {
    if (status !== 'recording') return;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      setStatus('transcribing');
    } else {
      setStatus('idle');
    }
  };

  const transcribe = async (blob: Blob) => {
    try {
      setStatus('transcribing');
      const arrayBuf = await blob.arrayBuffer();
      const api = window.electronAPI?.voice;
      if (!api?.transcribe) {
        setStatus('error');
        setErrorMsg('voice bridge unavailable');
        return;
      }
      const result = await api.transcribe(arrayBuf, { language });
      if (result.ok && result.text) {
        onTranscript(result.text);
        setStatus('idle');
        setErrorMsg(null);
      } else {
        setStatus('error');
        setErrorMsg(result.error ?? 'transcription failed');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const onClick = () => {
    if (status === 'recording') {
      stopRecording();
    } else if (status === 'idle' || status === 'error') {
      void startRecording();
    }
  };

  const isBusy = status === 'transcribing';
  const isRecording = status === 'recording';
  const isError = status === 'error' || status === 'unsupported';

  const title = isRecording
    ? t('voice.stop', 'Click to stop & transcribe ({{elapsed}}s)', { elapsed: elapsedSec })
    : isBusy
      ? t('voice.transcribing', 'Transcribing…')
      : isError
        ? t('voice.error', 'Voice error: {{msg}}', { msg: errorMsg ?? 'unknown' })
        : t('voice.start', 'Hold to record (FR)');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      className={`relative w-9 h-9 rounded-2xl flex items-center justify-center transition-colors ${
        isRecording
          ? 'bg-error/15 text-error animate-pulse'
          : isError
            ? 'bg-warning/10 text-warning hover:bg-warning/20'
            : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
      title={title}
      aria-label={title}
      data-testid="mic-button"
    >
      {isBusy ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isError ? (
        <MicOff className="w-4 h-4" />
      ) : (
        <Mic className="w-4 h-4" />
      )}
      {isRecording && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-[14px] px-1 rounded-full bg-error text-[9px] font-bold text-white flex items-center justify-center tabular-nums">
          {elapsedSec}s
        </span>
      )}
    </button>
  );
};
