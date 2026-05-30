import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

import { OcrTool } from './ocr-tool.js';

export type VisionAnalysisSource = 'image' | 'browser_screenshot';

export interface VisionAnalysisOptions {
  rootDir?: string;
  includeOcr?: boolean;
  ocrLanguage?: string;
  source?: VisionAnalysisSource;
  sourceUrl?: string;
  reportPrefix?: string;
  now?: () => Date;
  createId?: () => string;
}

export interface VisionAnalysisResult {
  kind: 'vision_analyze_result';
  ok: boolean;
  source: VisionAnalysisSource;
  imagePath: string;
  reportPath: string;
  sourceUrl?: string;
  generatedAt: string;
  metadata: {
    width: number;
    height: number;
    format: string;
    sizeBytes: number;
    channels?: number;
    hasAlpha?: boolean;
    density?: number;
  };
  colors: {
    dominant: { r: number; g: number; b: number };
    isOpaque: boolean;
  };
  labels: string[];
  ocr?: {
    attempted: boolean;
    ok: boolean;
    language: string;
    text?: string;
    error?: string;
  };
  error?: string;
}

const SUPPORTED_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'tif', 'tiff', 'svg']);

export async function analyzeVisionImage(
  imagePathInput: string,
  options: VisionAnalysisOptions = {},
): Promise<VisionAnalysisResult> {
  if (!imagePathInput.trim()) {
    throw new Error('image_path is required');
  }

  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const imagePath = path.resolve(rootDir, imagePathInput);
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  if (!SUPPORTED_FORMATS.has(ext)) {
    throw new Error(`Unsupported image format: ${path.extname(imagePath)}`);
  }

  const stat = await fs.stat(imagePath);
  const metadata = await sharp(imagePath).metadata();
  const stats = await sharp(imagePath).stats();
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const reportDir = path.join(rootDir, '.codebuddy', 'vision-analysis');
  const reportId = sanitizeId(options.createId?.() ?? randomUUID());
  const reportPath = path.join(reportDir, `${options.reportPrefix ?? 'vision'}-${reportId}.json`);
  const dominant = stats.dominant;

  const result: VisionAnalysisResult = {
    kind: 'vision_analyze_result',
    ok: true,
    source: options.source ?? 'image',
    imagePath,
    reportPath,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    generatedAt,
    metadata: {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format ?? ext,
      sizeBytes: stat.size,
      ...(metadata.channels !== undefined ? { channels: metadata.channels } : {}),
      ...(metadata.hasAlpha !== undefined ? { hasAlpha: metadata.hasAlpha } : {}),
      ...(metadata.density !== undefined ? { density: metadata.density } : {}),
    },
    colors: {
      dominant: {
        r: dominant.r,
        g: dominant.g,
        b: dominant.b,
      },
      isOpaque: metadata.hasAlpha !== true,
    },
    labels: buildLabels(metadata.format ?? ext, metadata.width ?? 0, metadata.height ?? 0, metadata.hasAlpha),
  };

  if (options.includeOcr) {
    result.ocr = await runOptionalOcr(imagePath, options.ocrLanguage ?? 'eng');
  }

  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function buildLabels(format: string, width: number, height: number, hasAlpha: boolean | undefined): string[] {
  const labels = ['image', format];
  if (width > height) labels.push('landscape');
  else if (height > width) labels.push('portrait');
  else if (width === height && width > 0) labels.push('square');
  if (hasAlpha) labels.push('transparent');
  if (width >= 1280 || height >= 720) labels.push('large');
  return [...new Set(labels)];
}

async function runOptionalOcr(imagePath: string, language: string): Promise<VisionAnalysisResult['ocr']> {
  try {
    const text = await OcrTool.getInstance().extractText(imagePath, language);
    return {
      attempted: true,
      ok: true,
      language,
      text,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      language,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sanitizeId(id: string): string {
  const sanitized = id.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || randomUUID();
}
