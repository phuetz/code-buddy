/**
 * Bridges the Cowork « Video Studio » to the CORE prompt→video engine
 * (`agent/film/video-studio.js` `produceVideoFromPrompt`), loaded from the
 * embedded engine via loadCoreModule. Streams the pipeline progress through an
 * injected callback so the panel can show a live status. The loader is injected
 * so this is unit-testable without the engine.
 */
import { homedir } from 'os';
import { loadCoreModule } from '../utils/core-loader.js';

export interface FilmProduceRequest {
  pitch: string;
  scenes?: number;
  resolution?: string;
  noMusic?: boolean;
  subtitles?: boolean;
  lang?: string;
  model?: string;
}

export interface FilmProgress {
  phase: string;
  scene?: number;
  total?: number;
  message?: string;
}

export interface FilmProduceResponse {
  ok: boolean;
  filmPath?: string;
  url?: string;
  sceneCount?: number;
  duration?: number;
  qualityPass?: boolean;
  warnings?: string[];
  error?: string;
}

interface CoreVideoStudioModule {
  produceVideoFromPrompt(
    pitch: string,
    options: Record<string, unknown>,
    deps: { onProgress?: (p: FilmProgress) => void }
  ): Promise<{
    success: boolean;
    filmPath?: string;
    sceneCount: number;
    probedDuration?: number;
    quality?: { pass: boolean };
    warnings: string[];
    error?: string;
  }>;
}

type CoreLoader = () => Promise<CoreVideoStudioModule | null>;

export class FilmService {
  private modPromise?: Promise<CoreVideoStudioModule | null>;

  constructor(
    private readonly loader: CoreLoader = () =>
      loadCoreModule<CoreVideoStudioModule>('agent/film/video-studio.js'),
    /** Where the film + work files land (should be the media-library working dir). */
    private readonly rootDir: string = homedir()
  ) {}

  async produceFromPrompt(
    req: FilmProduceRequest,
    onProgress?: (p: FilmProgress) => void
  ): Promise<FilmProduceResponse> {
    const pitch = (req?.pitch ?? '').trim();
    if (!pitch) return { ok: false, error: 'un sujet (pitch) est requis' };

    const mod = await (this.modPromise ??= this.loader());
    if (!mod?.produceVideoFromPrompt) {
      return { ok: false, error: 'moteur vidéo indisponible (moteur embarqué configuré ?)' };
    }

    try {
      const res = await mod.produceVideoFromPrompt(
        pitch,
        {
          ...(req.scenes ? { count: req.scenes } : {}),
          ...(req.resolution ? { resolution: req.resolution } : {}),
          ...(req.noMusic ? { noMusic: true } : {}),
          subtitles: req.subtitles !== false,
          ...(req.lang ? { lang: req.lang } : {}),
          ...(req.model ? { model: req.model } : {}),
          rootDir: this.rootDir,
        },
        { ...(onProgress ? { onProgress } : {}) }
      );
      if (!res.success || !res.filmPath) {
        return { ok: false, error: res.error ?? 'production échouée', warnings: res.warnings };
      }
      return {
        ok: true,
        filmPath: res.filmPath,
        url: `file://${res.filmPath}`,
        sceneCount: res.sceneCount,
        ...(res.probedDuration !== undefined ? { duration: res.probedDuration } : {}),
        ...(res.quality ? { qualityPass: res.quality.pass } : {}),
        warnings: res.warnings,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
