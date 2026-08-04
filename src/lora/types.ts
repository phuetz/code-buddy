/**
 * Krea 2 LoRA training types (cloud fal + local plan).
 */

export type LoraAutoCaptioning = 'Off' | 'Object/Character' | 'Style' | 'Custom';

export interface LoraProjectMeta {
  name: string;
  triggerPhrase: string;
  createdAt: string;
  /** Optional character tag for companion use (e.g. lisa). */
  character?: string;
  notes?: string;
}

export interface LoraDatasetValidation {
  ok: boolean;
  imageCount: number;
  captionCount: number;
  missingCaptions: string[];
  images: string[];
  errors: string[];
  warnings: string[];
  /** Present when validate --quality ran. */
  quality?: {
    kept: number;
    reject: number;
    issues: Array<{ path: string; kind: string; detail: string }>;
  };
}

export interface LoraTrainCloudOptions {
  imagesDataUrl: string;
  triggerPhrase?: string;
  autoCaptioning?: LoraAutoCaptioning;
  steps?: number;
  learningRate?: number;
  resolution?: 768 | 1024;
  debugDataset?: boolean;
  /** Injectable fetch (tests). */
  fetch?: typeof fetch;
  apiKey?: string;
  /** Poll interval ms (default 5000). */
  pollMs?: number;
  /** Max wait ms (default 2h). */
  timeoutMs?: number;
  onStatus?: (status: string, detail?: string) => void;
  signal?: AbortSignal;
}

export interface LoraTrainCloudResult {
  success: boolean;
  requestId?: string;
  loraUrl?: string;
  configUrl?: string;
  loraPath?: string;
  configPath?: string;
  error?: string;
  raw?: unknown;
}

export interface LoraLocalPlan {
  projectDir: string;
  configPath: string;
  readmePath: string;
  scriptPath: string;
  steps: string[];
}
