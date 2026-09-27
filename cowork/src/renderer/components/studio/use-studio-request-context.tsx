/**
 * Ce que l'utilisateur joint à sa prochaine demande dans App Studio, câblé de
 * bout en bout (IPC → UI → prompt) :
 * - élément cliqué dans l'aperçu → fichier et lignes sources (`studio.preview.*`) ;
 * - console du navigateur (poussée par le processus principal, déjà masquée)
 *   et journaux du serveur de dev (interrogés, déjà masqués) ;
 * - image de référence (modèles multimodaux seulement) ;
 * - fichiers inclus / exclus du contexte, avec estimation en jetons ;
 * - noms des secrets du projet (jamais leurs valeurs).
 *
 * @module renderer/components/studio/use-studio-request-context
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContentBlock } from '../../types';
import { buildIterationPrompt, type IterationMode } from './iteration-prompt.js';
import {
  buildContextBlock,
  cycleContextState,
  elementLabel,
  estimateTokens,
  IMAGE_TOKEN_ESTIMATE,
  pickLogLines,
  type AttachedLogs,
  type ContextState,
  type ElementDescriptor,
  type LogSource,
  type RequestContext,
  type TargetElement,
} from './request-context.js';
import type { BrowserConsoleEntry, StudioConsolePaneProps } from './StudioConsolePane.js';
import { StudioContextPanel, type ContextCandidate } from './StudioContextPanel.js';
import type { StudioChatAttachment } from '../studio-iterate/StudioChatPanel.js';

const INSPECTOR_SOURCE = 'codebuddy-studio-inspector';
const MAX_BROWSER_ENTRIES = 300;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export interface AttachedImage {
  name: string;
  mediaType: ImageType;
  data: string;
}

export interface UseStudioRequestContextOptions {
  root: string;
  previewUrl: string | null;
  previewRunning: boolean;
  devPid: number | null;
  /** Modèle de la session (pour savoir s'il lit les images). */
  model: string;
  lockedFiles: () => string[];
  /** Déclenche une demande de correction immédiate (journaux joints). */
  onFixWithLogs?: (text: string, logs: AttachedLogs) => void;
  /** Incrémenté en fin de tour : la liste des fichiers du contexte est relue. */
  refreshKey?: number;
}

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('lecture impossible'));
    reader.readAsDataURL(file);
  });
}

export function useStudioRequestContext(options: UseStudioRequestContextOptions) {
  const { root, previewUrl, previewRunning, devPid, model, lockedFiles, onFixWithLogs, refreshKey = 0 } = options;
  const previewApi = window.electronAPI?.studio?.preview;
  const contextApi = window.electronAPI?.studio?.context;
  const secretsApi = window.electronAPI?.studio?.secrets;
  const devServerApi = window.electronAPI?.studio?.devServer;

  const [selecting, setSelecting] = useState(false);
  const [target, setTarget] = useState<TargetElement | null>(null);
  const [browser, setBrowser] = useState<BrowserConsoleEntry[]>([]);
  const [server, setServer] = useState<string[]>([]);
  const serverClearedRef = useRef<string | null>(null);
  const [logs, setLogs] = useState<AttachedLogs[]>([]);
  const [image, setImage] = useState<AttachedImage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ContextCandidate[]>([]);
  const [states, setStates] = useState<Record<string, ContextState>>({});
  const [secretNames, setSecretNames] = useState<string[]>([]);

  // Nouveau projet : tout repart de zéro.
  useEffect(() => {
    setSelecting(false);
    setTarget(null);
    setBrowser([]);
    setServer([]);
    setLogs([]);
    setImage(null);
    setNotice(null);
    setStates({});
    serverClearedRef.current = null;
  }, [root]);

  // L'aperçu affiché est annoncé au processus principal (console de CETTE frame).
  const origin = originOf(previewUrl);
  useEffect(() => {
    setBrowser([]);
    if (!previewApi?.watch) return;
    // Sans aperçu : l'URL vide retire la surveillance (plus de console d'une ancienne origine).
    void previewApi.watch({ url: previewUrl && root ? previewUrl : '', root }).catch(() => undefined);
  }, [previewUrl, root, previewApi]);

  useEffect(() => {
    if (!previewApi?.onConsole) return;
    return previewApi.onConsole((entry) => {
      setBrowser((prev) => [...prev, entry].slice(-MAX_BROWSER_ENTRIES));
    });
  }, [previewApi]);

  // Journaux du serveur de dev (déjà masqués par le processus principal).
  useEffect(() => {
    if (devPid === null || !previewRunning || !devServerApi) return;
    let alive = true;
    const poll = async () => {
      const res = (await devServerApi.logs(devPid, 200).catch(() => null)) as { ok?: boolean; data?: { lines?: string[] } } | null;
      if (!alive || !res?.ok || !res.data?.lines) return;
      const lines = res.data.lines;
      const marker = serverClearedRef.current;
      const idx = marker === null ? -1 : lines.lastIndexOf(marker);
      setServer(idx >= 0 ? lines.slice(idx + 1) : marker === null ? lines : lines.slice(-20));
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [devPid, previewRunning, devServerApi]);

  // Élément cliqué : message de la frame de l'aperçu, origine vérifiée.
  useEffect(() => {
    if (!origin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = event.data as { source?: unknown; kind?: unknown; element?: unknown } | null;
      if (!data || data.source !== INSPECTOR_SOURCE) return;
      setSelecting(false);
      if (data.kind !== 'select' || !data.element || typeof data.element !== 'object') return;
      const element = data.element as ElementDescriptor;
      if (typeof element.tag !== 'string') return;
      setTarget({ element, location: null });
      if (!root || !previewApi?.locate) return;
      void previewApi
        .locate(root, element)
        .then((res) => {
          if (res?.ok) setTarget({ element, location: res.data });
        })
        .catch(() => undefined);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, root, previewApi]);

  const toggleSelect = useCallback(() => {
    if (!previewUrl || !previewApi?.inspect) return;
    const enable = !selecting;
    void previewApi.inspect({ url: previewUrl, enable }).then((res) => {
      if (res.ok) {
        setSelecting(enable);
        setNotice(null);
      } else setNotice(`Sélection impossible : ${res.error ?? 'aperçu introuvable'}`);
    });
  }, [previewUrl, previewApi, selecting]);

  // Une frame rechargée perd le script de sélection.
  const onFrameLoad = useCallback(() => setSelecting(false), []);

  // Fichiers candidats au contexte.
  const loadCandidates = useCallback(() => {
    if (!root || !contextApi) return;
    void contextApi
      .candidates(root)
      .then((res) => {
        if (res.ok) setCandidates(res.data);
      })
      .catch(() => undefined);
  }, [root, contextApi]);
  useEffect(() => loadCandidates(), [loadCandidates, refreshKey]);

  // Noms des secrets (les valeurs ne quittent jamais le processus principal).
  useEffect(() => {
    setSecretNames([]);
    if (!root || !secretsApi) return;
    void secretsApi
      .list(root)
      .then((res) => {
        if (res.ok) setSecretNames(res.data.map((e) => e.key));
      })
      .catch(() => undefined);
  }, [root, secretsApi]);

  const attachLogs = useCallback(
    (source: LogSource, onlyProblems: boolean) => {
      const lines = source === 'navigateur' ? pickLogLines(browser, onlyProblems) : server.slice(-60);
      if (lines.length === 0) return;
      setLogs((prev) => [...prev.filter((l) => l.source !== source), { source, lines }]);
    },
    [browser, server],
  );

  const fixWithLogs = useCallback(
    (source: LogSource) => {
      const lines = source === 'navigateur' ? pickLogLines(browser, browser.some((e) => e.level === 'error' || e.level === 'warning')) : server.slice(-60);
      if (lines.length === 0 || !onFixWithLogs) return;
      onFixWithLogs(
        source === 'navigateur'
          ? "Corrige les erreurs de la console du navigateur jointes ci-dessus (cause racine, modification ciblée)."
          : 'Corrige les erreurs du serveur de dev jointes ci-dessus (cause racine, modification ciblée).',
        { source, lines },
      );
    },
    [browser, server, onFixWithLogs],
  );

  const clearLogs = useCallback((source: LogSource) => {
    if (source === 'navigateur') setBrowser([]);
    else {
      setServer((prev) => {
        if (prev.length > 0) serverClearedRef.current = prev[prev.length - 1] ?? null;
        return [];
      });
    }
  }, []);

  const attachImage = useCallback(
    async (file: File) => {
      if (!IMAGE_TYPES.includes(file.type as ImageType)) {
        setNotice('Image refusée : formats acceptés PNG, JPEG, WebP ou GIF.');
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setNotice('Image refusée : 5 Mo au plus.');
        return;
      }
      const caps = model && window.electronAPI?.model?.capabilities ? await window.electronAPI.model.capabilities(model).catch(() => null) : null;
      if (!caps?.supportsVision) {
        setImage(null);
        setNotice(
          `Le modèle « ${model || 'inconnu'} » ne lit pas les images : l'image n'est pas jointe. ` +
            'Choisissez un modèle multimodal (vision) dans les réglages pour donner une maquette au modèle.',
        );
        return;
      }
      const data = await readAsBase64(file).catch(() => null);
      if (!data) {
        setNotice("Lecture de l'image impossible.");
        return;
      }
      setNotice(null);
      setImage({ name: file.name || 'image', mediaType: file.type as ImageType, data });
    },
    [model],
  );

  const included = useMemo(() => candidates.filter((c) => states[c.path] === 'inclus'), [candidates, states]);
  const excluded = useMemo(() => candidates.filter((c) => states[c.path] === 'exclu').map((c) => c.path), [candidates, states]);

  const baseContext = useCallback(
    (): RequestContext => ({
      target,
      logs,
      excluded,
      secretNames,
      image: Boolean(image),
    }),
    [target, logs, excluded, secretNames, image],
  );

  /** Estimation (jetons) de la demande qui partirait avec ce brouillon. */
  const estimate = useCallback(
    (draft: string, mode: IterationMode) => {
      const prompt = buildIterationPrompt(draft || '…', {
        lockedFiles: lockedFiles(),
        mode,
        context: buildContextBlock(baseContext()),
      });
      return estimateTokens(prompt) + included.reduce((s, c) => s + c.tokens, 0) + (image ? IMAGE_TOKEN_ESTIMATE : 0);
    },
    [baseContext, included, image, lockedFiles],
  );

  /**
   * Construit le message final (texte seul, ou texte + image) et vide les
   * pièces jointes « à usage unique » (cible, journaux, image). La sélection
   * de fichiers reste pour les demandes suivantes.
   */
  const compose = useCallback(
    async (text: string, mode: IterationMode, extra?: { logs?: AttachedLogs }): Promise<string | ContentBlock[]> => {
      let files: { path: string; content: string }[] = [];
      if (included.length > 0 && root && contextApi) {
        const res = await contextApi.read(root, included.map((c) => c.path)).catch(() => null);
        if (res?.ok) files = res.data.map((f) => ({ path: f.path, content: f.content }));
      }
      const ctx: RequestContext = { ...baseContext(), files, logs: extra?.logs ? [...logs.filter((l) => l.source !== extra.logs?.source), extra.logs] : logs };
      const prompt = buildIterationPrompt(text, { lockedFiles: lockedFiles(), mode, context: buildContextBlock(ctx) });
      const sentImage = image;
      setTarget(null);
      setLogs([]);
      setImage(null);
      if (!sentImage) return prompt;
      return [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'base64', media_type: sentImage.mediaType, data: sentImage.data } },
      ];
    },
    [included, root, contextApi, baseContext, logs, lockedFiles, image],
  );

  const attachments: StudioChatAttachment[] = [];
  if (target) {
    attachments.push({
      id: 'cible',
      kind: 'cible',
      label: target.location
        ? `${elementLabel(target.element)} — ${target.location.file}:${target.location.startLine}-${target.location.endLine}`
        : `${elementLabel(target.element)} — source en cours de localisation…`,
      ...(target.element.component ? { detail: `Composant ${target.element.component}` } : {}),
      onRemove: () => setTarget(null),
    });
  }
  for (const l of logs) {
    attachments.push({
      id: `journaux-${l.source}`,
      kind: 'journaux',
      label: `${l.lines.length} ligne(s) — ${l.source === 'navigateur' ? 'console du navigateur' : 'serveur de dev'}`,
      onRemove: () => setLogs((prev) => prev.filter((x) => x.source !== l.source)),
    });
  }
  if (image) attachments.push({ id: 'image', kind: 'image', label: image.name, onRemove: () => setImage(null) });

  const consoleProps: Omit<StudioConsolePaneProps, 'busy'> = {
    browser,
    server,
    onAttach: attachLogs,
    onFix: fixWithLogs,
    onClear: clearLogs,
  };

  const contextPanel = (mode: IterationMode, draftTokens: number) => (
    <StudioContextPanel
      candidates={candidates}
      states={states}
      onCycle={(p) =>
        setStates((prev) => {
          const next = { ...prev };
          const value = cycleContextState(prev[p]);
          if (value) next[p] = value;
          else delete next[p];
          return next;
        })
      }
      onRefresh={loadCandidates}
      totalTokens={draftTokens || estimate('', mode)}
    />
  );

  return {
    selecting,
    toggleSelect,
    onFrameLoad,
    target,
    attachments,
    notice,
    attachImage: (file: File) => void attachImage(file),
    consoleProps,
    contextPanel,
    estimate,
    compose,
    setSecretNames,
    secretNames,
    browser,
    server,
  };
}
