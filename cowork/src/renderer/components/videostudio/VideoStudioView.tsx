import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clapperboard, Download, FilePlus2, FlaskConical, Image as ImageIcon, Loader2, Play, Video } from 'lucide-react';
import { ComfyLabPanel } from './ComfyLabPanel';
import type { AvatarBibleFlowAsset } from './AvatarBiblePanel';
import { assessEditorialQuality } from '../../../shared/editorial-quality';
import { FlowEditorialGate } from './FlowEditorialGate';
import { FlowIngredientRail } from './FlowIngredientRail';
import { FlowInspector } from './FlowInspector';
import { FlowSceneTimeline } from './FlowSceneTimeline';
import {
  buildFlowPrompt,
  createFlowScene,
  extendFlowScene,
  insertIngredientReference,
  removeIngredientReference,
  sourceVideoClips,
  type FlowCameraMove,
  type FlowIngredient,
  type FlowMediaMode,
  type FlowReferenceMode,
  type FlowScene,
} from './flow-studio-model';
import { activateFlowProject, listFlowProjects, loadFlowProject, saveFlowProject, type FlowProjectSnapshot } from './flow-project-store';
import { FLOW_STUDIO_PRESETS, findFlowPreset, type FlowPresetId } from './flow-studio-presets';

interface Progress { phase: string; scene?: number; total?: number; message?: string }
interface GenerationResult { ok: boolean; url?: string; path?: string; error?: string }
interface MediaCapabilities {
  imageGeneration: boolean;
  imageReferences: boolean;
  videoGeneration: boolean;
  videoReferences: boolean;
  firstFrame: boolean;
  lastFrame: boolean;
  audio: boolean;
  provider: string;
  model: string;
}

function initialScenes(): FlowScene[] {
  return [1, 2, 3, 4].map((index) => createFlowScene(index));
}

function nextProjectId(): string {
  return `flow-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function VideoStudioView() {
  const [restoredProject] = useState(loadFlowProject);
  const [projectId, setProjectId] = useState(restoredProject?.id ?? nextProjectId);
  const [projectCatalog, setProjectCatalog] = useState(listFlowProjects);
  const [projectName, setProjectName] = useState(restoredProject?.name ?? 'Projet sans titre');
  const [mode, setMode] = useState<FlowMediaMode>(restoredProject?.mode ?? 'video');
  const [referenceMode, setReferenceMode] = useState<FlowReferenceMode>(restoredProject?.referenceMode ?? 'text');
  const [ingredients, setIngredients] = useState<FlowIngredient[]>(restoredProject?.ingredients ?? []);
  const [selectedIngredientIds, setSelectedIngredientIds] = useState<string[]>(restoredProject?.selectedIngredientIds ?? []);
  const [activeIngredientId, setActiveIngredientId] = useState<string>();
  const [scenes, setScenes] = useState<FlowScene[]>(restoredProject?.scenes.length ? restoredProject.scenes : initialScenes);
  const [selectedSceneId, setSelectedSceneId] = useState(() => restoredProject?.selectedSceneId ?? scenes[0]?.id ?? '');
  const [prompt, setPrompt] = useState(restoredProject?.prompt ?? '');
  const [aspect, setAspect] = useState<'1:1' | '16:9' | '9:16'>(restoredProject?.aspect ?? '16:9');
  const [duration, setDuration] = useState(restoredProject?.duration ?? 6);
  const [outputs, setOutputs] = useState(restoredProject?.outputs ?? 1);
  const [camera, setCamera] = useState<FlowCameraMove>(restoredProject?.camera ?? 'static');
  const [audioEnabled, setAudioEnabled] = useState(restoredProject?.audioEnabled ?? true);
  const [voiceEnabled, setVoiceEnabled] = useState(restoredProject?.voiceEnabled ?? false);
  const [narration, setNarration] = useState(restoredProject?.narration ?? 'Bonjour, je suis heureuse de partager ce moment avec toi.');
  const [voiceLocale, setVoiceLocale] = useState(restoredProject?.voiceLocale ?? 'fr-FR');
  const [voiceProfileId, setVoiceProfileId] = useState(restoredProject?.voiceProfileId ?? '');
  const [presetId, setPresetId] = useState<FlowPresetId | undefined>(restoredProject?.presetId);
  const [publication, setPublication] = useState(restoredProject?.publication ?? false);
  const [editorialTitle, setEditorialTitle] = useState(restoredProject?.editorialTitle ?? '');
  const [editorialDescription, setEditorialDescription] = useState(restoredProject?.editorialDescription ?? '');
  const [seriesName, setSeriesName] = useState(restoredProject?.seriesName ?? '');
  const [syntheticMediaDisclosure, setSyntheticMediaDisclosure] = useState(restoredProject?.syntheticMediaDisclosure ?? true);
  const [startFrameId, setStartFrameId] = useState<string | undefined>(restoredProject?.startFrameId);
  const [endFrameId, setEndFrameId] = useState<string | undefined>(restoredProject?.endFrameId);
  const [capabilities, setCapabilities] = useState<MediaCapabilities>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string>();
  const [showComfyLab, setShowComfyLab] = useState(false);
  const [gpuJobId, setGpuJobId] = useState<string>();
  const gpuJobIdRef = useRef<string | undefined>(undefined);
  const gpuCancelRequestedRef = useRef(false);
  const offRef = useRef<(() => void) | null>(null);

  const setActiveGpuJob = useCallback((jobId?: string) => {
    gpuJobIdRef.current = jobId;
    setGpuJobId(jobId);
  }, []);

  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0];
  const selectedIngredients = useMemo(
    () => ingredients.filter((ingredient) => selectedIngredientIds.includes(ingredient.id)),
    [ingredients, selectedIngredientIds],
  );
  const activeIngredient = ingredients.find((ingredient) => ingredient.id === activeIngredientId);
  const startFrame = ingredients.find((ingredient) => ingredient.id === startFrameId);
  const endFrame = ingredients.find((ingredient) => ingredient.id === endFrameId);
  const previousPrompts = useMemo(
    () => projectCatalog.filter((project) => project.id !== projectId).map((project) => project.prompt),
    [projectCatalog, projectId],
  );
  const editorialReport = useMemo(() => assessEditorialQuality({
    publication,
    title: editorialTitle,
    description: editorialDescription,
    prompt,
    aspect,
    duration,
    syntheticMediaDisclosure,
    selectedAssets: selectedIngredients,
    scenes,
    previousPrompts,
  }), [aspect, duration, editorialDescription, editorialTitle, previousPrompts, prompt, publication, scenes, selectedIngredients, syntheticMediaDisclosure]);
  const projectSnapshot = useMemo<FlowProjectSnapshot>(() => ({
    version: 1,
    id: projectId,
    name: projectName,
    mode,
    referenceMode,
    ingredients,
    selectedIngredientIds,
    scenes,
    selectedSceneId,
    prompt,
    aspect,
    duration,
    outputs,
    camera,
    audioEnabled,
    voiceEnabled,
    narration,
    voiceLocale,
    voiceProfileId,
    presetId,
    publication,
    editorialTitle,
    editorialDescription,
    seriesName,
    syntheticMediaDisclosure,
    startFrameId,
    endFrameId,
    savedAt: Date.now(),
  }), [aspect, audioEnabled, camera, duration, editorialDescription, editorialTitle, endFrameId, ingredients, mode, narration, outputs, presetId, projectId, projectName, prompt, publication, referenceMode, scenes, selectedIngredientIds, selectedSceneId, seriesName, startFrameId, syntheticMediaDisclosure, voiceEnabled, voiceLocale, voiceProfileId]);

  useEffect(() => {
    let alive = true;
    void window.electronAPI?.creativeAssets?.list?.({ kind: 'image', contentTier: 'safe', limit: 200 }).then((result) => {
      if (!alive) return;
      const library = (result?.assets ?? []).map((item): FlowIngredient => ({
        id: item.id,
        assetId: item.id,
        name: item.name,
        kind: item.source === 'mysoulmate' || item.source === 'avatar-bible' ? 'character' : 'style',
        url: item.url,
        source: item.source,
        contentTier: item.contentTier,
        qaStatus: item.qaStatus,
        companionId: item.companionId,
      }));
      setIngredients((current) => {
        const known = new Set(current.map((item) => item.assetId ?? item.id));
        return [...current, ...library.filter((item) => !known.has(item.assetId ?? item.id))];
      });
    }).catch(() => undefined);
    void window.electronAPI?.media?.capabilities?.().then(setCapabilities).catch(() => undefined);
    const film = window.electronAPI?.film;
    if (film?.onProgress) offRef.current = film.onProgress(setProgress);
    return () => {
      alive = false;
      offRef.current?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveFlowProject(projectSnapshot);
      setProjectCatalog(listFlowProjects());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [projectSnapshot]);

  const updatePrompt = useCallback((value: string) => {
    setPrompt(value);
    setScenes((current) => current.map((scene) => scene.id === selectedSceneId ? { ...scene, prompt: value } : scene));
  }, [selectedSceneId]);

  const selectScene = useCallback((id: string) => {
    const scene = scenes.find((candidate) => candidate.id === id);
    setSelectedSceneId(id);
    setPrompt(scene?.prompt ?? '');
    if (scene) setDuration(scene.durationSeconds);
  }, [scenes]);

  const addIngredients = useCallback(async () => {
    const result = await window.electronAPI?.creativeAssets?.importImages?.();
    const additions = (result?.assets ?? []).map((asset): FlowIngredient => ({
      id: asset.id,
      assetId: asset.id,
      name: asset.name,
      kind: 'object',
      url: asset.url,
      source: asset.source,
      contentTier: asset.contentTier,
      qaStatus: asset.qaStatus,
    }));
    setIngredients((current) => {
      const known = new Set(current.map((item) => item.assetId ?? item.id));
      return [...current, ...additions.filter((item) => !known.has(item.assetId ?? item.id))];
    });
  }, []);

  const toggleIngredient = useCallback((ingredient: FlowIngredient) => {
    setActiveIngredientId(ingredient.id);
    const selected = selectedIngredientIds.includes(ingredient.id);
    setSelectedIngredientIds((current) => selected
      ? current.filter((id) => id !== ingredient.id)
      : [...current, ingredient.id]);
    updatePrompt(selected
      ? removeIngredientReference(prompt, ingredient)
      : insertIngredientReference(prompt, ingredient));
  }, [prompt, selectedIngredientIds, updatePrompt]);

  const useAvatarInFlow = useCallback((asset: AvatarBibleFlowAsset) => {
    const id = `avatar-bible-${asset.id}`;
    const ingredient: FlowIngredient = {
      id,
      name: asset.name,
      kind: 'character',
      path: asset.path,
      url: asset.url,
      avatarBibleId: asset.id,
    };
    setIngredients((current) => current.some((item) => item.avatarBibleId === asset.id)
      ? current.map((item) => item.avatarBibleId === asset.id ? ingredient : item)
      : [...current, ingredient]);
    setSelectedIngredientIds((current) => current.includes(id) ? current : [...current, id]);
    setActiveIngredientId(id);
    setReferenceMode('ingredients');
    setPrompt((current) => insertIngredientReference(current, ingredient));
    setScenes((current) => current.map((scene) => scene.id === selectedSceneId
      ? { ...scene, prompt: insertIngredientReference(scene.prompt, ingredient) }
      : scene));
    setShowComfyLab(false);
    setNotice(`« ${asset.name} » est sélectionné comme personnage de référence.`);
  }, [selectedSceneId]);

  const addScene = useCallback(() => {
    setScenes((current) => [...current, createFlowScene(current.length + 1, duration)]);
  }, [duration]);

  const extendScene = useCallback(() => {
    if (!selectedScene) return;
    const extension = extendFlowScene(selectedScene, scenes.length + 1);
    setScenes((current) => [...current, extension]);
    setSelectedSceneId(extension.id);
    setPrompt(extension.prompt);
  }, [scenes.length, selectedScene]);

  const applyProject = useCallback((project: FlowProjectSnapshot) => {
    setProjectId(project.id);
    setProjectName(project.name);
    setMode(project.mode);
    setReferenceMode(project.referenceMode);
    setIngredients(project.ingredients);
    setSelectedIngredientIds(project.selectedIngredientIds);
    setActiveIngredientId(undefined);
    setScenes(project.scenes);
    setSelectedSceneId(project.selectedSceneId);
    setPrompt(project.prompt);
    setAspect(project.aspect);
    setDuration(project.duration);
    setOutputs(project.outputs);
    setCamera(project.camera);
    setAudioEnabled(project.audioEnabled);
    setVoiceEnabled(project.voiceEnabled);
    setNarration(project.narration ?? '');
    setVoiceLocale(project.voiceLocale ?? 'fr-FR');
    setVoiceProfileId(project.voiceProfileId ?? '');
    setPresetId(project.presetId);
    setPublication(project.publication ?? false);
    setEditorialTitle(project.editorialTitle ?? '');
    setEditorialDescription(project.editorialDescription ?? '');
    setSeriesName(project.seriesName ?? '');
    setSyntheticMediaDisclosure(project.syntheticMediaDisclosure ?? true);
    setStartFrameId(project.startFrameId);
    setEndFrameId(project.endFrameId);
  }, []);

  const newProject = useCallback(() => {
    saveFlowProject(projectSnapshot);
    const freshScenes = initialScenes();
    const firstSceneId = freshScenes[0]?.id ?? '';
    const fresh: FlowProjectSnapshot = {
      version: 1,
      id: nextProjectId(),
      name: 'Projet sans titre',
      mode: 'video',
      referenceMode: 'text',
      ingredients: [],
      selectedIngredientIds: [],
      scenes: freshScenes,
      selectedSceneId: firstSceneId,
      prompt: '',
      aspect: '16:9',
      duration: 6,
      outputs: 1,
      camera: 'static',
      audioEnabled: true,
      voiceEnabled: false,
      narration: '',
      voiceLocale: 'fr-FR',
      voiceProfileId: '',
      publication: false,
      editorialTitle: '',
      editorialDescription: '',
      seriesName: '',
      syntheticMediaDisclosure: true,
      savedAt: Date.now(),
    };
    saveFlowProject(fresh);
    applyProject(fresh);
    setProjectCatalog(listFlowProjects());
    setNotice('Nouveau projet créé.');
  }, [applyProject, projectSnapshot]);

  const applyPreset = useCallback((id: string) => {
    const preset = findFlowPreset(id);
    if (!preset) return;
    setPresetId(preset.id);
    setMode(preset.mode);
    setAspect(preset.aspect);
    setDuration(preset.duration);
    setCamera(preset.camera);
    setAudioEnabled(preset.audio);
    setVoiceEnabled(preset.voice);
    setPublication(preset.publication);
    setEditorialTitle(preset.editorial?.title ?? '');
    setEditorialDescription(preset.editorial?.description ?? '');
    setSeriesName(preset.editorial?.series ?? '');
    setSyntheticMediaDisclosure(preset.publication);
    updatePrompt(preset.prompt);
    setOutputs(1);
    setNotice(`Preset « ${preset.label} » appliqué. Assets safe et validés requis avant publication.`);
  }, [updatePrompt]);

  const switchProject = useCallback((id: string) => {
    saveFlowProject(projectSnapshot);
    const project = activateFlowProject(id);
    if (!project) return;
    applyProject(project);
    setProjectCatalog(listFlowProjects());
    setNotice(`Projet « ${project.name} » restauré.`);
  }, [applyProject, projectSnapshot]);

  const exportSelected = useCallback(async () => {
    if (!selectedScene?.path) return;
    const paths = [selectedScene.path, selectedScene.youtubeMetadataPath].filter((path): path is string => Boolean(path));
    const result = paths.length > 1
      ? await window.electronAPI?.media?.exportMany?.(paths)
      : await window.electronAPI?.media?.export?.(selectedScene.path);
    if (result?.ok) {
      const destination = (result as { savedTo?: string; destDir?: string }).savedTo
        ?? (result as { savedTo?: string; destDir?: string }).destDir;
      setNotice(`Plan${paths.length > 1 ? ' et métadonnées' : ''} exporté vers ${destination ?? 'le dossier choisi'}.`);
    }
    else if (!result?.canceled) setNotice(result?.error ?? 'Échec de l’export.');
  }, [selectedScene]);

  const exportAll = useCallback(async () => {
    const paths = scenes.flatMap((scene) => [scene.path, scene.youtubeMetadataPath].filter((path): path is string => Boolean(path)));
    if (!paths.length) return;
    const result = await window.electronAPI?.media?.exportMany?.(paths);
    if (result?.ok) setNotice(`${result.copied ?? paths.length} média(s) exporté(s) vers ${result.destDir ?? 'le dossier choisi'}.`);
    else if (!result?.canceled) setNotice(result?.error ?? 'Échec de l’export.');
  }, [scenes]);

  const assembleTimeline = useCallback(async () => {
    const clips = sourceVideoClips(scenes);
    if (clips.length < 2) return;
    setBusy(true);
    setNotice('Montage de la timeline…');
    try {
      const result = await window.electronAPI?.media?.assembleVideo?.({
        clips,
        aspect,
        name: projectName,
        ...(publication ? {
          editorial: {
            title: editorialTitle,
            description: editorialDescription,
            series: seriesName,
            syntheticMediaDisclosure,
            prompt,
            assetIds: selectedIngredients.flatMap((ingredient) => ingredient.assetId ? [ingredient.assetId] : []),
            previousPrompts,
          },
        } : {}),
      });
      if (!result?.ok || !result.outputPath || !result.url) {
        setNotice(result?.error ?? 'Échec du montage.');
        return;
      }
      const film: FlowScene = {
        ...createFlowScene(scenes.length + 1, Math.max(1, Math.round(result.duration ?? clips.length * duration))),
        title: 'Film final',
        prompt: `Montage ${projectName}`,
        status: 'done',
        mediaType: 'video',
        path: result.outputPath,
        youtubeMetadataPath: result.metadataPath,
        url: result.url,
      };
      setScenes((current) => [...current, film]);
      setSelectedSceneId(film.id);
      setPrompt(film.prompt);
      setNotice(`Film final assemblé à partir de ${clips.length} clips${result.metadataPath ? ', avec sa fiche YouTube privée à relire' : ''}.`);
    } finally {
      setBusy(false);
    }
  }, [aspect, duration, editorialDescription, editorialTitle, previousPrompts, projectName, prompt, publication, scenes, selectedIngredients, seriesName, syntheticMediaDisclosure]);

  const generateImage = useCallback(async (generationPrompt: string): Promise<GenerationResult> => {
    const avatarReference = selectedIngredients.find((ingredient) => ingredient.avatarBibleId);
    if (avatarReference && capabilities?.imageReferences) {
      const edited = await window.electronAPI?.media?.editImage?.({
        prompt: generationPrompt,
        ...(avatarReference.assetId ? { imageAssetId: avatarReference.assetId } : { imagePath: avatarReference.path }),
      });
      return edited?.ok && edited.url
        ? { ok: true, url: edited.url, path: edited.outputPath }
        : { ok: false, error: edited?.error ?? 'Génération avec référence avatar indisponible' };
    }
    const result = await window.electronAPI?.media?.generateImage?.({ prompt: generationPrompt, aspect });
    return result?.ok && result.url ? { ok: true, url: result.url, path: result.outputPath } : { ok: false, error: result?.error ?? 'Générateur d’images indisponible' };
  }, [aspect, capabilities?.imageReferences, selectedIngredients]);

  const generateVideo = useCallback(async (generationPrompt: string): Promise<GenerationResult> => {
    if (gpuCancelRequestedRef.current) return { ok: false, error: 'Lot de génération annulé.' };
    const avatar = selectedIngredients.find((ingredient) => ingredient.kind === 'character' && ingredient.assetId);
    if (voiceEnabled && narration.trim() && avatar?.assetId) {
      if (!voiceProfileId.trim() || !voiceLocale.trim()) {
        return { ok: false, error: 'Sélectionne une locale et un profil vocal commercial validé.' };
      }
      let longCatAttempted = false;
      try {
        const gpu = window.electronAPI?.gpuMedia;
        const available = await gpu?.capabilities();
        if (gpu && available?.jobs.includes('avatar_video_render')) {
          longCatAttempted = true;
          let job = await gpu.submitAvatar({
            turnId: `flow-${Date.now()}`,
            referenceAssetId: avatar.assetId,
            narration: narration.trim(),
            prompt: generationPrompt,
            locale: voiceLocale.trim(),
            voiceProfileId: voiceProfileId.trim(),
          });
          setActiveGpuJob(job.id);
          while (job.status === 'queued' || job.status === 'running') {
            setProgress({ phase: 'longcat', message: job.progressMessage ?? `LongCat sur Darkstar · ${Math.round((job.progress ?? 0) * 100)} %` });
            await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 1_500));
            job = await gpu.status(job.id);
          }
          setActiveGpuJob(undefined);
          if (gpuCancelRequestedRef.current || job.status === 'cancelled') {
            return { ok: false, error: 'Génération LongCat annulée.' };
          }
          if (job.status === 'succeeded') {
            const local = await gpu.materialize(job.id);
            if (local.ok && local.url) return { ok: true, url: local.url, path: local.path };
            return { ok: false, error: local.error ?? 'Matérialisation LongCat impossible.' };
          }
          return { ok: false, error: job.error ?? `LongCat terminé avec le statut ${job.status}.` };
        }
      } catch (error) {
        setActiveGpuJob(undefined);
        if (longCatAttempted) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Échec LongCat après soumission.',
          };
        }
        // No LongCat submission was attempted; another configured provider may be used.
      }
    }
    const cinematic = await window.electronAPI?.media?.generateVideo?.({
      prompt: generationPrompt,
      aspect,
      duration,
      audio: audioEnabled,
      ...(startFrame?.assetId ? { imageAssetId: startFrame.assetId } : startFrame?.path ? { imagePath: startFrame.path } : {}),
      referenceAssetIds: selectedIngredients.flatMap((ingredient) => ingredient.assetId ? [ingredient.assetId] : []),
      referenceImagePaths: selectedIngredients.flatMap((ingredient) => ingredient.assetId || !ingredient.path ? [] : [ingredient.path]),
    });
    if (cinematic?.ok && cinematic.url) return { ok: true, url: cinematic.url, path: cinematic.outputPath };
    return { ok: false, error: cinematic?.error ?? 'Générateur vidéo indisponible' };
  }, [aspect, audioEnabled, duration, narration, selectedIngredients, setActiveGpuJob, startFrame, voiceEnabled, voiceLocale, voiceProfileId]);

  const cancelGpuJob = useCallback(async () => {
    const jobId = gpuJobIdRef.current;
    if (!jobId) return;
    gpuCancelRequestedRef.current = true;
    try {
      await window.electronAPI?.gpuMedia?.cancel(jobId);
      setNotice('Annulation LongCat demandée. Aucun fallback ne sera lancé.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Annulation LongCat impossible.');
    }
  }, []);

  const generate = useCallback(async () => {
    if (!selectedScene || !prompt.trim() || busy) return;
    const generationPrompt = buildFlowPrompt({
      prompt,
      ingredients: selectedIngredients,
      camera,
      startFrame,
      endFrame,
      audioEnabled: mode === 'video' && audioEnabled,
      voiceEnabled: mode === 'video' && voiceEnabled,
      publication,
    });
    setBusy(true);
    gpuCancelRequestedRef.current = false;
    setNotice(undefined);
    setProgress(mode === 'video' ? { phase: 'planning' } : { phase: 'image' });
    setScenes((current) => current.map((scene) => scene.id === selectedScene.id ? { ...scene, status: 'generating' } : scene));
    try {
      const results: GenerationResult[] = [];
      for (let index = 0; index < outputs; index += 1) {
        if (gpuCancelRequestedRef.current) break;
        setProgress({ phase: mode, scene: index + 1, total: outputs, message: `Variante ${index + 1}/${outputs}…` });
        const variantPrompt = outputs > 1 ? `${generationPrompt}\nVariante ${index + 1}/${outputs} : conserver le même contrat visuel, varier légèrement la composition.` : generationPrompt;
        results.push(await (mode === 'image' ? generateImage(variantPrompt) : generateVideo(variantPrompt)));
        if (gpuCancelRequestedRef.current) break;
      }
      const successes = results.filter((result): result is GenerationResult & { url: string } => result.ok && Boolean(result.url));
      const primary = successes[0];
      setScenes((current) => {
        const updated = current.map((scene) => scene.id === selectedScene.id
          ? primary ? { ...scene, status: 'done' as const, url: primary.url, path: primary.path, mediaType: mode, prompt } : { ...scene, status: 'error' as const }
          : scene);
        const variants = successes.slice(1).map((result, index): FlowScene => ({
          ...createFlowScene(updated.length + index + 1, duration),
          title: `Variante ${index + 2}`,
          prompt,
          status: 'done',
          url: result.url,
          path: result.path,
          mediaType: mode,
          parentSceneId: selectedScene.id,
        }));
        return [...updated, ...variants];
      });
      setNotice(gpuCancelRequestedRef.current
        ? 'Lot de génération annulé. Aucune variante supplémentaire ne sera lancée.'
        : primary ? `${successes.length} variante${successes.length > 1 ? 's' : ''} prête${successes.length > 1 ? 's' : ''}.` : results[0]?.error ?? 'Échec de la génération.');
    } catch (error) {
      setScenes((current) => current.map((scene) => scene.id === selectedScene.id ? { ...scene, status: 'error' } : scene));
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [audioEnabled, busy, camera, duration, endFrame, generateImage, generateVideo, mode, outputs, prompt, publication, selectedIngredients, selectedScene, startFrame, voiceEnabled]);

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="video-studio-view">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 lg:gap-3 lg:px-4">
        <Clapperboard className="h-4 w-4 text-orange-500" aria-hidden="true" />
        <h1 className="text-sm font-semibold">Atelier Flow</h1>
        <select value={projectId} onChange={(event) => switchProject(event.target.value)} className="max-w-40 rounded-md border border-border bg-background px-2 py-1 text-[10px] outline-none" aria-label="Projet Flow actif" data-testid="flow-project-picker">
          {projectCatalog.length ? projectCatalog.map((project) => <option key={project.id} value={project.id}>{project.name}</option>) : <option value={projectId}>{projectName}</option>}
        </select>
        <input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="w-44 rounded-md border border-transparent bg-transparent px-2 py-1 text-[11px] text-muted-foreground outline-none hover:border-border focus:border-orange-500 focus:text-foreground" aria-label="Nom du projet Flow" />
        <button type="button" onClick={newProject} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground" data-testid="flow-new-project"><FilePlus2 className="h-3 w-3" /> Nouveau</button>
        <select value={presetId ?? ''} onChange={(event) => applyPreset(event.target.value)} className="max-w-44 rounded-md border border-border bg-background px-2 py-1 text-[10px] outline-none" aria-label="Preset éditorial Flow" data-testid="flow-preset-picker">
          <option value="">Preset éditorial…</option>
          {FLOW_STUDIO_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
        {gpuJobId ? <button type="button" onClick={() => void cancelGpuJob()} className="rounded-md border border-rose-500/40 px-2 py-1 text-[10px] text-rose-600" data-testid="flow-cancel-longcat">Annuler LongCat</button> : null}
        <button
          type="button"
          onClick={() => setShowComfyLab((current) => !current)}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${showComfyLab ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-border text-muted-foreground hover:bg-background hover:text-foreground'}`}
          aria-pressed={showComfyLab}
          data-testid="flow-comfy-lab-toggle"
        >
          <FlaskConical className="h-3 w-3" /> Laboratoire ComfyUI
        </button>
        <span className="ml-auto inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Type de création">
          <button type="button" onClick={() => { setMode('image'); setOutputs(Math.min(outputs, 4)); }} className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] ${mode === 'image' ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:bg-background'}`} aria-pressed={mode === 'image'} data-testid="flow-mode-image"><ImageIcon className="h-3.5 w-3.5" /> Image</button>
          <button type="button" onClick={() => { setMode('video'); setOutputs(Math.min(outputs, 2)); }} className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] ${mode === 'video' ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:bg-background'}`} aria-pressed={mode === 'video'} data-testid="flow-mode-video"><Video className="h-3.5 w-3.5" /> Vidéo</button>
        </span>
      </header>

      {showComfyLab ? (
        <ComfyLabPanel onClose={() => setShowComfyLab(false)} onUseAvatar={useAvatarInFlow} />
      ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <FlowIngredientRail ingredients={ingredients} selectedIds={selectedIngredientIds} onToggle={toggleIngredient} onAdd={() => void addIngredients()} />
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-[420px] flex-1 flex-col bg-background p-3 lg:min-h-0 lg:p-4">
            <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2"><h2 className="text-xs font-semibold">{selectedScene?.title ?? 'Plan'}</h2>{selectedScene?.status === 'done' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : null}</div><div className="flex items-center gap-2"><span className="text-[10px] text-muted-foreground">{aspect} · {mode === 'video' ? `${duration}s` : 'image fixe'}</span><button type="button" onClick={() => void exportSelected()} disabled={!selectedScene?.path} className="rounded border border-border p-1 text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-30" title="Exporter ce plan" aria-label="Exporter ce plan" data-testid="flow-export-selected"><Download className="h-3.5 w-3.5" /></button></div></div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-slate-950" data-testid="flow-canvas">
              {selectedScene?.url ? (selectedScene.mediaType === 'video' ? <video src={selectedScene.url} controls autoPlay loop muted className="h-full w-full object-contain" data-testid="flow-video-preview" /> : <img src={selectedScene.url} alt="Résultat généré" className="h-full w-full object-contain" data-testid="flow-image-preview" />) : <div className="max-w-md px-8 text-center text-slate-300"><Play className="mx-auto mb-4 h-10 w-10 text-slate-500" /><p className="text-sm font-medium">Compose ton prochain plan</p><p className="mt-2 text-xs leading-relaxed text-slate-500">Ajoute des ingrédients, référence-les avec @, puis génère des variations cohérentes.</p></div>}
              {busy ? <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-white" role="status" aria-live="polite" data-testid="flow-progress"><Loader2 className="mb-3 h-6 w-6 animate-spin" /><span className="text-xs">{progress?.message ?? (mode === 'image' ? 'Création des variantes…' : 'Construction des scènes…')}</span></div> : null}
            </div>
            {notice ? <div className="mt-2 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground" role="status" aria-live="polite" data-testid="flow-notice">{notice}</div> : null}
            {publication ? <FlowEditorialGate
              report={editorialReport}
              title={editorialTitle}
              description={editorialDescription}
              series={seriesName}
              disclosure={syntheticMediaDisclosure}
              onTitle={setEditorialTitle}
              onDescription={setEditorialDescription}
              onSeries={setSeriesName}
              onDisclosure={setSyntheticMediaDisclosure}
            /> : null}
          </div>
          <FlowSceneTimeline scenes={scenes} selectedId={selectedSceneId} onSelect={selectScene} onAdd={addScene} onExtend={extendScene} onExportAll={() => void exportAll()} onAssemble={() => void assembleTimeline()} />
        </section>
        <FlowInspector
          mode={mode}
          referenceMode={referenceMode}
          prompt={prompt}
          aspect={aspect}
          duration={duration}
          outputs={outputs}
          camera={camera}
          audioEnabled={audioEnabled}
          voiceEnabled={voiceEnabled}
          narration={narration}
          voiceLocale={voiceLocale}
          voiceProfileId={voiceProfileId}
          selectedIngredient={activeIngredient}
          startFrame={startFrame}
          endFrame={endFrame}
          busy={busy}
          capabilities={capabilities}
          onReferenceMode={setReferenceMode}
          onPrompt={updatePrompt}
          onAspect={setAspect}
          onDuration={(value) => { setDuration(value); setScenes((current) => current.map((scene) => scene.id === selectedSceneId ? { ...scene, durationSeconds: value } : scene)); }}
          onOutputs={setOutputs}
          onCamera={setCamera}
          onAudio={setAudioEnabled}
          onVoice={setVoiceEnabled}
          onNarration={setNarration}
          onVoiceLocale={setVoiceLocale}
          onVoiceProfileId={setVoiceProfileId}
          onStartFrame={() => setStartFrameId(activeIngredient?.id)}
          onEndFrame={() => setEndFrameId(activeIngredient?.id)}
          onGenerate={() => void generate()}
        />
      </div>
      )}
    </main>
  );
}
