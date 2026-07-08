/**
 * Multimodal Tool Adapters
 *
 * ITool-compliant adapters for multimodal tools: audio, video, PDF, OCR,
 * QR code, clipboard, diagram, document, export, and archive.
 *
 * Each adapter lazy-loads the underlying tool and dispatches based on
 * the `operation` parameter from the OpenAI function-calling schema.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType, IToolExecutionContext } from './types.js';
import {
  synthesizeTextToSpeech,
  type TextToSpeechOptions,
  type TextToSpeechProvider,
} from '../text-to-speech-tool.js';
import {
  generateImage,
  generateVideo,
  type MediaGenerationRuntime,
} from '../media-generation-tool.js';
import {
  analyzeVideoWithModel,
} from '../video-analysis-tool.js';
import {
  understandVideo,
  isUnderstandOk,
} from '../video/video-understanding.js';
import {
  assembleFilm,
  type TransitionEngine,
  type TransitionSpec,
  type AssembleFilmDeps,
} from '../video/film-assemble.js';

// ============================================================================
// Lazy-loaded tool instances
// ============================================================================

let audioInstance: InstanceType<typeof import('../audio-tool.js').AudioTool> | null = null;
let videoInstance: InstanceType<typeof import('../video-tool.js').VideoTool> | null = null;
let pdfInstance: InstanceType<typeof import('../pdf-tool.js').PDFTool> | null = null;
let ocrInstance: InstanceType<typeof import('../ocr-tool.js').OCRTool> | null = null;
let qrInstance: InstanceType<typeof import('../qr-tool.js').QRTool> | null = null;
let clipboardInstance: InstanceType<typeof import('../clipboard-tool.js').ClipboardTool> | null = null;
let diagramInstance: InstanceType<typeof import('../diagram-tool.js').DiagramTool> | null = null;
let documentInstance: InstanceType<typeof import('../document-tool.js').DocumentTool> | null = null;
let exportInstance: InstanceType<typeof import('../export-tool.js').ExportTool> | null = null;
let archiveInstance: InstanceType<typeof import('../archive-tool.js').ArchiveTool> | null = null;

async function getAudio() {
  if (!audioInstance) {
    const { AudioTool } = await import('../audio-tool.js');
    audioInstance = new AudioTool();
  }
  return audioInstance;
}

async function getVideo() {
  if (!videoInstance) {
    const { VideoTool } = await import('../video-tool.js');
    videoInstance = new VideoTool();
  }
  return videoInstance;
}

async function getPDF() {
  if (!pdfInstance) {
    const { PDFTool } = await import('../pdf-tool.js');
    pdfInstance = new PDFTool();
  }
  return pdfInstance;
}

async function getOCR() {
  if (!ocrInstance) {
    const { OCRTool } = await import('../ocr-tool.js');
    ocrInstance = new OCRTool();
  }
  return ocrInstance;
}

async function getQR() {
  if (!qrInstance) {
    const { QRTool } = await import('../qr-tool.js');
    qrInstance = new QRTool();
  }
  return qrInstance;
}

async function getClipboard() {
  if (!clipboardInstance) {
    const { ClipboardTool } = await import('../clipboard-tool.js');
    clipboardInstance = new ClipboardTool();
  }
  return clipboardInstance;
}

async function getDiagram() {
  if (!diagramInstance) {
    const { DiagramTool } = await import('../diagram-tool.js');
    diagramInstance = new DiagramTool();
  }
  return diagramInstance;
}

async function getDocument() {
  if (!documentInstance) {
    const { DocumentTool } = await import('../document-tool.js');
    documentInstance = new DocumentTool();
  }
  return documentInstance;
}

async function getExport() {
  if (!exportInstance) {
    const { ExportTool } = await import('../export-tool.js');
    exportInstance = new ExportTool();
  }
  return exportInstance;
}

async function getArchive() {
  if (!archiveInstance) {
    const { ArchiveTool } = await import('../archive-tool.js');
    archiveInstance = new ArchiveTool();
  }
  return archiveInstance;
}

/**
 * Reset all shared instances (for testing)
 */
export function resetMultimodalInstances(): void {
  audioInstance = null;
  videoInstance = null;
  pdfInstance = null;
  ocrInstance = null;
  qrInstance = null;
  clipboardInstance = null;
  diagramInstance = null;
  documentInstance = null;
  exportInstance = null;
  archiveInstance = null;
}

// ============================================================================
// AudioExecuteTool
// ============================================================================

export class AudioExecuteTool implements ITool {
  readonly name = 'audio';
  readonly description = 'Process and transcribe audio files. Supports info extraction, transcription (via Whisper API), and format conversion.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getAudio();
    const op = input.operation as string;
    const filePath = input.path as string;

    switch (op) {
      case 'info':
        return tool.getInfo(filePath);
      case 'transcribe':
        return tool.transcribe(filePath, {
          language: input.language as string | undefined,
          prompt: input.prompt as string | undefined,
        });
      case 'list':
        return tool.listAudioFiles(filePath);
      case 'to_base64':
        return tool.toBase64(filePath);
      default:
        return { success: false, error: `Unknown audio operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['info', 'transcribe', 'list', 'to_base64'], description: 'Operation to perform' },
          path: { type: 'string', description: 'Path to audio file or directory' },
          language: { type: 'string', description: 'Language code for transcription' },
          prompt: { type: 'string', description: 'Optional prompt to guide transcription' },
        },
        required: ['operation', 'path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (typeof d.path !== 'string') return { valid: false, errors: ['path is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['audio', 'transcribe', 'whisper', 'sound', 'music'], priority: 3, modifiesFiles: false, makesNetworkRequests: true };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// TextToSpeechTool
// ============================================================================

export class TextToSpeechTool implements ITool {
  readonly name = 'text_to_speech';
  readonly description = 'Convert text to a local speech audio file using the configured or detected TTS provider.';

  constructor(private readonly options: TextToSpeechOptions = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const result = await synthesizeTextToSpeech({
        text: requiredString(input, 'text'),
        outputPath: optionalString(input, 'output_path'),
        provider: optionalProvider(input.provider),
        voice: optionalString(input, 'voice'),
        language: optionalString(input, 'language'),
        format: optionalFormat(input.format),
        rate: optionalNumber(input, 'rate'),
        volume: optionalNumber(input, 'volume'),
        timeoutMs: optionalNumber(input, 'timeout_ms'),
      }, {
        ...this.options,
        rootDir: this.options.rootDir ?? context?.cwd,
      });
      return {
        success: true,
        output: JSON.stringify(result, null, 2),
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to convert to speech audio.',
          },
          output_path: {
            type: 'string',
            description: 'Optional absolute or workspace-relative output path. Defaults to .codebuddy/tts/tts-<id>.<format>.',
          },
          provider: {
            type: 'string',
            enum: ['auto', 'system', 'edge-tts', 'espeak', 'say', 'audioreader', 'piper'],
            description: 'TTS provider. auto detects a local provider (piper first when CODEBUDDY_TTS_VOICE is set); system uses Windows SAPI.',
          },
          voice: {
            type: 'string',
            description: 'Optional provider-specific voice name.',
          },
          language: {
            type: 'string',
            description: 'Optional language code for providers such as espeak.',
          },
          format: {
            type: 'string',
            enum: ['wav', 'mp3', 'aiff'],
            description: 'Output audio format. Defaults by provider.',
          },
          rate: {
            type: 'number',
            description: 'Optional provider-specific speech rate; Windows system clamps to -10..10.',
          },
          volume: {
            type: 'number',
            description: 'Optional provider-specific volume; Windows system clamps to 0..100.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Provider timeout in milliseconds. Default 120000.',
          },
        },
        required: ['text'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.text !== 'string' || !d.text.trim()) return { valid: false, errors: ['text is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['tts', 'speech', 'audio', 'voice', 'hermes', 'text_to_speech'],
      priority: 7,
      modifiesFiles: true,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ImageGenerateTool
// ============================================================================

export class ImageGenerateTool implements ITool {
  readonly name = 'image_generate';
  readonly description = 'Generate an image from a text prompt through the configured image backend.';

  constructor(private readonly options: MediaGenerationRuntime = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const result = await generateImage({
        prompt: requiredString(input, 'prompt'),
        aspectRatio: optionalString(input, 'aspect_ratio'),
      }, {
        ...this.options,
        rootDir: this.options.rootDir ?? context?.cwd,
      });
      return {
        success: true,
        output: JSON.stringify(result, null, 2),
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text prompt describing the desired image.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['landscape', 'square', 'portrait'],
            description: 'Output aspect ratio: landscape, square, or portrait. Default landscape.',
          },
        },
        required: ['prompt'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const data = input as Record<string, unknown>;
    if (typeof data.prompt !== 'string' || !data.prompt.trim()) return { valid: false, errors: ['prompt is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['image', 'generate', 'media', 'openai', 'xai', 'hermes'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// VideoAnalyzeTool
// ============================================================================

export class VideoAnalyzeTool implements ITool {
  readonly name = 'video_analyze';
  readonly description = 'Analyze a video from a URL or local file path using a configured video-capable model.';

  constructor(private readonly options: MediaGenerationRuntime = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const result = await analyzeVideoWithModel({
        videoUrl: requiredString(input, 'video_url'),
        question: requiredString(input, 'question'),
      }, {
        ...this.options,
        rootDir: this.options.rootDir ?? context?.cwd,
      });
      return {
        success: true,
        output: JSON.stringify(result, null, 2),
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            description: 'HTTP/HTTPS URL, file:// URL, or local file path to the video.',
          },
          question: {
            type: 'string',
            description: 'Specific question to answer about the video.',
          },
        },
        required: ['video_url', 'question'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const data = input as Record<string, unknown>;
    if (typeof data.video_url !== 'string' || !data.video_url.trim()) return { valid: false, errors: ['video_url is required'] };
    if (typeof data.question !== 'string' || !data.question.trim()) return { valid: false, errors: ['question is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['video', 'analyze', 'vision', 'gemini', 'openai', 'hermes'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// UnderstandVideoTool
// ============================================================================

export class UnderstandVideoTool implements ITool {
  readonly name = 'understand_video';
  readonly description = 'Understand a video (YouTube/URL/local file): timestamped transcript of what is said, and optionally (visual:true) what is shown on screen. Local-first and $0.';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const result = await understandVideo({
        source: requiredString(input, 'source'),
        question: optionalString(input, 'question'),
        language: optionalString(input, 'language'),
        ...(optionalBoolean(input.visual) !== undefined ? { visual: optionalBoolean(input.visual) } : {}),
        ...(optionalBoolean(input.ocr) !== undefined ? { ocr: optionalBoolean(input.ocr) } : {}),
        ...(optionalBoolean(input.cloud) !== undefined ? { cloud: optionalBoolean(input.cloud) } : {}),
      }, {
        ...(context?.cwd ? { cwd: context.cwd } : {}),
      });
      if (!isUnderstandOk(result)) {
        return { success: false, error: result.error };
      }
      return {
        success: true,
        output: result.output,
        data: {
          segments: result.segments,
          transcriptPath: result.transcriptPath,
          source: result.source,
          method: result.method,
          ...(result.cloud ? { cloud: result.cloud } : {}),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'YouTube URL, direct media URL, or local video/audio file path.',
          },
          question: {
            type: 'string',
            description: 'Optional question to answer about the video (recorded with the transcript).',
          },
          language: {
            type: 'string',
            description: "Optional preferred language code (e.g. 'en', 'fr').",
          },
          visual: {
            type: 'boolean',
            description: 'Also analyze what is SHOWN on screen (frames → local vision model). Default false.',
          },
          ocr: {
            type: 'boolean',
            description: 'With visual:true, also OCR each keyframe (best for on-screen code). Default false.',
          },
          cloud: {
            type: 'boolean',
            description: 'OPT-IN: also send the video/URL to a cloud model (Gemini) for a joint audio+visual, timestamped answer. Sends data to Google — public/non-sensitive videos only. Needs GEMINI_API_KEY; degrades to the local transcript on any failure. Default false.',
          },
        },
        required: ['source'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const data = input as Record<string, unknown>;
    if (typeof data.source !== 'string' || !data.source.trim()) return { valid: false, errors: ['source is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['video', 'youtube', 'transcribe', 'transcript', 'captions', 'subtitles', 'summarize', 'watch', 'visual', 'screencast', 'frames', 'ocr', 'on-screen', 'cloud', 'gemini'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// VideoGenerateTool
// ============================================================================

export class VideoGenerateTool implements ITool {
  readonly name = 'video_generate';
  readonly description = 'Generate a video from text or animate an image through the configured video backend.';

  constructor(private readonly options: MediaGenerationRuntime = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const result = await generateVideo({
        prompt: requiredString(input, 'prompt'),
        imageUrl: optionalString(input, 'image_url'),
        referenceImageUrls: optionalStringList(input.reference_image_urls),
        duration: optionalNumber(input, 'duration'),
        aspectRatio: optionalString(input, 'aspect_ratio'),
        resolution: optionalString(input, 'resolution'),
        negativePrompt: optionalString(input, 'negative_prompt'),
        audio: optionalBoolean(input.audio),
        seed: optionalNumber(input, 'seed'),
        model: optionalString(input, 'model'),
      }, {
        ...this.options,
        rootDir: this.options.rootDir ?? context?.cwd,
      });
      return {
        success: true,
        output: JSON.stringify(result, null, 2),
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text instruction describing the desired video.' },
          image_url: { type: 'string', description: 'Optional image URL for image-to-video.' },
          reference_image_urls: { type: 'array', items: { type: 'string' }, description: 'Optional reference image URLs.' },
          duration: { type: 'number', description: 'Desired duration in seconds.' },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'], description: 'Output aspect ratio.' },
          resolution: { type: 'string', enum: ['360p', '480p', '540p', '720p', '1080p', '4k'], description: 'Output resolution.' },
          negative_prompt: { type: 'string', description: 'Optional negative prompt.' },
          audio: { type: 'boolean', description: 'Optional native audio generation toggle.' },
          seed: { type: 'number', description: 'Optional seed.' },
          model: { type: 'string', description: 'Optional configured model/family override for the active backend.' },
        },
        required: ['prompt'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const data = input as Record<string, unknown>;
    if (typeof data.prompt !== 'string' || !data.prompt.trim()) return { valid: false, errors: ['prompt is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['video', 'generate', 'xai', 'fal', 'media', 'hermes'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// VideoStitchTool — chain clips into a longer film with transitions
// ============================================================================

/** Parse the `transitions`/`transition` inputs into what assembleFilm expects. */
function parseStitchTransitions(
  input: Record<string, unknown>,
  defaultDuration: number,
): string | TransitionSpec[] | undefined {
  const arr = input.transitions;
  if (Array.isArray(arr) && arr.length > 0) {
    const specs = arr.map((t): TransitionSpec => {
      if (typeof t === 'string') return { type: t.trim() || 'fade', duration: defaultDuration };
      if (t && typeof t === 'object') {
        const o = t as Record<string, unknown>;
        const type = typeof o.type === 'string' && o.type.trim() ? o.type.trim() : 'fade';
        const duration =
          typeof o.duration === 'number' && Number.isFinite(o.duration) ? o.duration : defaultDuration;
        return { type, duration };
      }
      return { type: 'fade', duration: defaultDuration };
    });
    return specs;
  }
  return optionalString(input, 'transition');
}

export class VideoStitchTool implements ITool {
  readonly name = 'video_stitch';
  readonly description = 'Chain multiple video clips into one longer film with transitions, optional music (ducked) and voiceover. Requires ffmpeg.';

  constructor(private readonly options: { rootDir?: string; deps?: AssembleFilmDeps } = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const engineRaw = optionalString(input, 'engine');
      const engine: TransitionEngine | undefined =
        engineRaw === 'gl' ? 'gl' : engineRaw === 'xfade' ? 'xfade' : undefined;
      const defaultDuration = optionalNumber(input, 'transition_duration') ?? 1;

      const result = await assembleFilm({
        clips: optionalStringList(input.clips) ?? [],
        transitions: parseStitchTransitions(input, defaultDuration),
        transitionDuration: optionalNumber(input, 'transition_duration'),
        engine,
        resolution: optionalString(input, 'resolution'),
        aspectRatio: optionalString(input, 'aspect_ratio'),
        fps: optionalNumber(input, 'fps'),
        music: optionalString(input, 'music'),
        musicVolume: optionalNumber(input, 'music_volume'),
        ducking: optionalBoolean(input.ducking),
        voiceover: optionalString(input, 'voiceover'),
        name: optionalString(input, 'name'),
        output: optionalString(input, 'output'),
        rootDir: this.options.rootDir ?? context?.cwd,
      }, this.options.deps ?? {});
      return {
        success: result.success,
        output: JSON.stringify(result, null, 2),
        data: result,
        error: result.success ? undefined : result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          clips: { type: 'array', items: { type: 'string' }, description: 'Ordered local video paths to weld together.' },
          transition: { type: 'string', description: "Single transition applied at every boundary (fade, wipeleft, dissolve, circleopen, 'cut'…). Default 'fade'." },
          transitions: { type: 'array', items: { type: 'object' }, description: 'Optional per-boundary transitions ({type, duration}), length clips.length−1.' },
          transition_duration: { type: 'number', description: 'Default transition duration in seconds (default 1).' },
          engine: { type: 'string', enum: ['xfade', 'gl'], description: "Transition engine ('xfade' default, 'gl' falls back to xfade)." },
          resolution: { type: 'string', description: "Preset ('720p','1080p','4k'…) or 'WxH'. Defaults to the first clip." },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'], description: 'Aspect ratio for a resolution preset. Default 16:9.' },
          fps: { type: 'number', description: 'Output frame rate. Defaults to the first clip, else 30.' },
          music: { type: 'string', description: 'Optional background music path (looped, ducked).' },
          music_volume: { type: 'number', description: 'Music volume 0..1 (default 0.25).' },
          ducking: { type: 'boolean', description: 'Duck music under dialogue/voiceover (default true).' },
          voiceover: { type: 'string', description: 'Optional full-length narration audio path.' },
          name: { type: 'string', description: 'Optional film name (output filename + sidecar).' },
          output: { type: 'string', description: 'Optional explicit output path.' },
        },
        required: ['clips'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const data = input as Record<string, unknown>;
    const clips = optionalStringList(data.clips);
    if (!clips || clips.length === 0) return { valid: false, errors: ['clips (a non-empty array of video paths) is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['video', 'stitch', 'montage', 'film', 'concatenate', 'transition', 'xfade', 'enchainer', 'assembler', 'media'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// VideoExecuteTool
// ============================================================================

export class VideoExecuteTool implements ITool {
  readonly name = 'video';
  readonly description = 'Process video files: get info, extract frames, create thumbnails, extract audio. Requires ffmpeg.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getVideo();
    const op = input.operation as string;
    const filePath = input.path as string;

    switch (op) {
      case 'info':
        return tool.getInfo(filePath);
      case 'extract_frames':
        return tool.extractFrames(filePath, {
          interval: input.interval as number | undefined,
          count: input.count as number | undefined,
          timestamps: input.timestamps as number[] | undefined,
          outputDir: input.output_dir as string | undefined,
        });
      case 'thumbnail':
        return tool.createThumbnail(filePath, undefined, input.output_dir as string | undefined);
      case 'extract_audio':
        return tool.extractAudio(filePath, input.output_dir as string | undefined);
      case 'list':
        return tool.listVideos(filePath);
      default:
        return { success: false, error: `Unknown video operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['info', 'extract_frames', 'thumbnail', 'extract_audio', 'list'], description: 'Operation to perform' },
          path: { type: 'string', description: 'Path to video file or directory' },
          interval: { type: 'number', description: 'Seconds between frames for frame extraction' },
          count: { type: 'number', description: 'Number of frames to extract' },
          timestamps: { type: 'array', items: { type: 'number' }, description: 'Specific timestamps to extract frames from' },
          output_dir: { type: 'string', description: 'Output directory for extracted content' },
        },
        required: ['operation', 'path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (typeof d.path !== 'string') return { valid: false, errors: ['path is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['video', 'ffmpeg', 'frames', 'thumbnail', 'extract'], priority: 3, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// PDFExecuteTool
// ============================================================================

export class PDFExecuteTool implements ITool {
  readonly name = 'pdf';
  readonly description = 'Read and extract content from PDF files. Supports text extraction, metadata reading, and page-specific extraction.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getPDF();
    const op = input.operation as string;
    const filePath = input.path as string;

    switch (op) {
      case 'extract':
        return tool.extractText(filePath, {
          pages: input.pages as number[] | undefined,
          maxPages: input.max_pages as number | undefined,
        });
      case 'info':
        return tool.getInfo(filePath);
      case 'list':
        return tool.listPDFs(filePath);
      case 'to_base64':
        return tool.toBase64(filePath);
      default:
        return { success: false, error: `Unknown PDF operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['extract', 'info', 'list', 'to_base64'], description: 'Operation to perform' },
          path: { type: 'string', description: 'Path to PDF file or directory' },
          pages: { type: 'array', items: { type: 'number' }, description: 'Specific page numbers to extract' },
          max_pages: { type: 'number', description: 'Maximum pages to extract' },
        },
        required: ['operation', 'path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (typeof d.path !== 'string') return { valid: false, errors: ['path is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['pdf', 'document', 'extract', 'text', 'pages'], priority: 4, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// OCRExecuteTool
// ============================================================================

export class OCRExecuteTool implements ITool {
  readonly name = 'ocr';
  readonly description = 'Extract text from images using OCR. Uses Tesseract if available, or vision API as fallback.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getOCR();
    const op = input.operation as string;

    switch (op) {
      case 'extract':
        return tool.extractText(input.path as string, {
          language: input.language as string | undefined,
        });
      case 'extract_region':
        return tool.extractRegion(
          input.path as string,
          input.region as { x: number; y: number; width: number; height: number },
          { language: input.language as string | undefined },
        );
      case 'list_languages':
        return tool.listLanguages();
      case 'batch':
        return tool.batchOCR(
          input.paths as string[],
          { language: input.language as string | undefined },
        );
      default:
        return { success: false, error: `Unknown OCR operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['extract', 'extract_region', 'list_languages', 'batch'], description: 'OCR operation to perform' },
          path: { type: 'string', description: 'Path to image file' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Array of image paths for batch OCR' },
          language: { type: 'string', description: "OCR language code (e.g., 'eng', 'fra')" },
          region: { type: 'object', description: 'Region to OCR: { x, y, width, height }' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['ocr', 'image', 'text', 'tesseract', 'recognition'], priority: 3, modifiesFiles: false, makesNetworkRequests: true };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// QRExecuteTool
// ============================================================================

export class QRExecuteTool implements ITool {
  readonly name = 'qr';
  readonly description = 'Generate and read QR codes. Supports URL, WiFi, vCard, and custom data.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getQR();
    const op = input.operation as string;

    switch (op) {
      case 'generate':
        return tool.generate(input.data as string, {
          format: input.format as 'png' | 'svg' | 'ascii' | 'utf8' | undefined,
        });
      case 'generate_url':
        return tool.generateURL(input.url as string, {
          format: input.format as 'png' | 'svg' | 'ascii' | 'utf8' | undefined,
        });
      case 'generate_wifi':
        return tool.generateWiFi(
          input.ssid as string,
          (input.password as string) || '',
          (input.wifi_type as 'WPA' | 'WEP' | 'nopass') || 'WPA',
        );
      case 'generate_vcard':
        return tool.generateVCard(input.contact as any);
      case 'decode':
        return tool.decode(input.path as string);
      case 'list':
        return tool.listQRCodes();
      default:
        return { success: false, error: `Unknown QR operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['generate', 'generate_url', 'generate_wifi', 'generate_vcard', 'decode', 'list'], description: 'QR code operation' },
          data: { type: 'string', description: 'Data to encode' },
          url: { type: 'string', description: 'URL for generate_url' },
          ssid: { type: 'string', description: 'WiFi SSID' },
          password: { type: 'string', description: 'WiFi password' },
          wifi_type: { type: 'string', enum: ['WPA', 'WEP', 'nopass'], description: 'WiFi security type' },
          contact: { type: 'object', description: 'Contact info for vCard' },
          path: { type: 'string', description: 'Path to QR code image for decode' },
          format: { type: 'string', enum: ['ascii', 'utf8', 'svg', 'png'], description: 'Output format' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['qr', 'qrcode', 'barcode', 'generate', 'decode'], priority: 3, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ClipboardExecuteTool
// ============================================================================

export class ClipboardExecuteTool implements ITool {
  readonly name = 'clipboard';
  readonly description = 'Read and write to system clipboard. Supports text, images, and HTML content.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getClipboard();
    const op = input.operation as string;

    switch (op) {
      case 'read_text':
        return tool.readText();
      case 'write_text':
        return tool.writeText(input.text as string);
      case 'read_image':
        return tool.readImage(input.path as string | undefined);
      case 'write_image':
        return tool.writeImage(input.path as string);
      case 'read_html':
        return tool.readHtml();
      case 'copy_file_path':
        return tool.copyFilePath(input.path as string);
      case 'copy_file_content':
        return tool.copyFileContent(input.path as string);
      case 'get_type':
        return tool.getContentType();
      case 'clear':
        return tool.clear();
      default:
        return { success: false, error: `Unknown clipboard operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['read_text', 'write_text', 'read_image', 'write_image', 'read_html', 'copy_file_path', 'copy_file_content', 'get_type', 'clear'], description: 'Clipboard operation' },
          text: { type: 'string', description: 'Text to write (for write_text)' },
          path: { type: 'string', description: 'File path (for image ops or copy_file_*)' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['clipboard', 'copy', 'paste', 'text', 'image'], priority: 4, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// DiagramExecuteTool
// ============================================================================

export class DiagramExecuteTool implements ITool {
  readonly name = 'diagram';
  readonly description = 'Generate diagrams: flowcharts, sequence diagrams, class diagrams, pie charts, Gantt charts, and ASCII art.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getDiagram();
    const op = input.operation as string;
    const opts = { outputFormat: input.format as 'svg' | 'png' | 'ascii' | undefined };

    switch (op) {
      case 'mermaid':
        return tool.generateFromMermaid(input.code as string, opts);
      case 'flowchart':
        return tool.generateFlowchart(
          input.nodes as any,
          input.connections as any,
          { title: input.title as string | undefined, ...opts },
        );
      case 'sequence':
        return tool.generateSequenceDiagram(
          input.participants as string[],
          input.messages as any,
          { title: input.title as string | undefined, ...opts },
        );
      case 'class':
        return tool.generateClassDiagram(
          input.classes as any,
          input.relationships as any,
          { title: input.title as string | undefined, ...opts },
        );
      case 'pie':
        return tool.generatePieChart(
          (input.title as string) || 'Chart',
          input.data as Array<{ label: string; value: number }>,
          opts,
        );
      case 'gantt':
        return tool.generateGanttChart(
          (input.title as string) || 'Timeline',
          input.sections as any,
          opts,
        );
      case 'list':
        return tool.listDiagrams();
      default:
        return { success: false, error: `Unknown diagram operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['mermaid', 'flowchart', 'sequence', 'class', 'pie', 'gantt', 'list'], description: 'Type of diagram to generate' },
          code: { type: 'string', description: 'Mermaid code for mermaid operation' },
          title: { type: 'string', description: 'Title for the diagram' },
          nodes: { type: 'array', description: 'Nodes for flowchart' },
          connections: { type: 'array', description: 'Connections between nodes' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Participants for sequence diagram' },
          messages: { type: 'array', description: 'Messages for sequence diagram' },
          classes: { type: 'array', description: 'Classes for class diagram' },
          relationships: { type: 'array', description: 'Relationships for class diagram' },
          data: { type: 'array', description: 'Data points for pie chart' },
          sections: { type: 'array', description: 'Sections for Gantt chart' },
          format: { type: 'string', enum: ['svg', 'png', 'ascii', 'utf8'], description: 'Output format' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['diagram', 'flowchart', 'mermaid', 'sequence', 'class', 'gantt', 'chart'], priority: 3, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// DocumentExecuteTool
// ============================================================================

export class DocumentExecuteTool implements ITool {
  readonly name = 'document';
  readonly description = 'Read Office documents (DOCX, XLSX, PPTX, CSV, RTF). Extracts text, metadata, structure, and DOCX embedded images with Markdown references.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getDocument();
    const op = input.operation as string;
    const filePath = input.path as string;

    switch (op) {
      case 'read':
        return tool.readDocument(filePath);
      case 'list':
        return tool.listDocuments(filePath);
      case 'extract_images':
        return tool.extractEmbeddedImages(filePath, input.output_dir as string | undefined);
      default:
        return { success: false, error: `Unknown document operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['read', 'list', 'extract_images'], description: 'Operation to perform; extract_images returns output paths and Markdown image references for generate_document' },
          path: { type: 'string', description: 'Path to document or directory' },
          output_dir: { type: 'string', description: 'Directory where embedded DOCX images should be extracted; result data includes markdownRef values' },
        },
        required: ['operation', 'path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (!['read', 'list', 'extract_images'].includes(d.operation)) return { valid: false, errors: ['operation must be one of: read, list, extract_images'] };
    if (typeof d.path !== 'string') return { valid: false, errors: ['path is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['document', 'docx', 'xlsx', 'pptx', 'csv', 'office', 'embedded images', 'screenshots'], priority: 4, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ExportExecuteTool
// ============================================================================

export class ExportExecuteTool implements ITool {
  readonly name = 'export';
  readonly description = 'Export conversations to various formats: JSON, Markdown, HTML, plain text, or PDF.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getExport();
    const op = input.operation as string;

    switch (op) {
      case 'conversation':
        return tool.exportConversation(
          input.messages as any,
          {
            format: (input.format as 'json' | 'markdown' | 'html' | 'txt' | 'pdf') || 'markdown',
            outputPath: input.output_path as string | undefined,
            includeMetadata: input.include_metadata as boolean | undefined,
            includeTimestamps: input.include_timestamps as boolean | undefined,
          },
        );
      case 'csv':
        return tool.exportToCSV(
          input.data as Array<Record<string, unknown>>,
          input.output_path as string | undefined,
        );
      case 'code_snippets':
        return tool.exportCodeSnippets(
          input.messages as any,
          { outputDir: input.output_path as string | undefined },
        );
      case 'list':
        return tool.listExports();
      default:
        return { success: false, error: `Unknown export operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['conversation', 'csv', 'code_snippets', 'list'], description: 'Export operation' },
          format: { type: 'string', enum: ['json', 'markdown', 'html', 'txt', 'pdf'], description: 'Export format' },
          messages: { type: 'array', description: 'Messages to export' },
          data: { type: 'array', description: 'Data array for CSV export' },
          title: { type: 'string', description: 'Title for the export' },
          include_metadata: { type: 'boolean', description: 'Include metadata' },
          include_timestamps: { type: 'boolean', description: 'Include timestamps' },
          output_path: { type: 'string', description: 'Output file path' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['export', 'conversation', 'json', 'markdown', 'html', 'csv'], priority: 3, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ArchiveExecuteTool
// ============================================================================

export class ArchiveExecuteTool implements ITool {
  readonly name = 'archive';
  readonly description = 'Work with compressed archives: ZIP, TAR, TAR.GZ, 7Z, RAR. List, extract, and create archives.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getArchive();
    const op = input.operation as string;

    switch (op) {
      case 'list':
        return tool.list(input.path as string);
      case 'extract':
        return tool.extract(input.path as string, {
          outputDir: input.output_dir as string | undefined,
          files: input.files as string[] | undefined,
          overwrite: input.overwrite as boolean | undefined,
          password: input.password as string | undefined,
        });
      case 'create':
        return tool.create(
          input.sources as string[],
          {
            format: input.format as 'zip' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz' | undefined,
            outputPath: input.output_path as string | undefined,
          },
        );
      case 'list_archives':
        return tool.listArchives(input.path as string | undefined);
      default:
        return { success: false, error: `Unknown archive operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['list', 'extract', 'create', 'list_archives'], description: 'Archive operation' },
          path: { type: 'string', description: 'Path to archive file or directory' },
          sources: { type: 'array', items: { type: 'string' }, description: 'Source paths for creating archive' },
          output_dir: { type: 'string', description: 'Output directory for extraction' },
          output_path: { type: 'string', description: 'Output path for created archive' },
          format: { type: 'string', enum: ['zip', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz'], description: 'Archive format' },
          files: { type: 'array', items: { type: 'string' }, description: 'Specific files to extract' },
          password: { type: 'string', description: 'Password for encrypted archives' },
          overwrite: { type: 'boolean', description: 'Overwrite existing files' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['archive', 'zip', 'tar', 'compress', 'extract', '7z', 'rar'], priority: 3, requiresConfirmation: true, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all multimodal tool instances
 */
export function createMultimodalTools(): ITool[] {
  return [
    new AudioExecuteTool(),
    new TextToSpeechTool(),
    new ImageGenerateTool(),
    new VideoAnalyzeTool(),
    new UnderstandVideoTool(),
    new VideoGenerateTool(),
    new VideoStitchTool(),
    new VideoExecuteTool(),
    new PDFExecuteTool(),
    new OCRExecuteTool(),
    new QRExecuteTool(),
    new ClipboardExecuteTool(),
    new DiagramExecuteTool(),
    new DocumentExecuteTool(),
    new ExportExecuteTool(),
    new ArchiveExecuteTool(),
  ];
}

function requiredString(data: Record<string, unknown>, key: string): string {
  const value = optionalString(data, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
  return values.length > 0 ? values : undefined;
}

function optionalProvider(value: unknown): TextToSpeechProvider | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const provider = value.trim();
  if (['auto', 'system', 'edge-tts', 'espeak', 'say', 'audioreader', 'piper'].includes(provider)) {
    return provider as TextToSpeechProvider;
  }
  throw new Error(`Unsupported text_to_speech provider: ${provider}`);
}

function optionalFormat(value: unknown): 'wav' | 'mp3' | 'aiff' | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const format = value.trim();
  if (format === 'wav' || format === 'mp3' || format === 'aiff') {
    return format;
  }
  throw new Error(`Unsupported text_to_speech format: ${format}`);
}
