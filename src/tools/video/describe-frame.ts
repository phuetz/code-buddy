/**
 * Frame describer — turns a single keyframe into text, local-first ($0).
 *
 * Reuses the same local-VLM path as the sensory vision reaction
 * (`loadImageFromFile` + `buildMultimodalContent` + `CodeBuddyClient.chat` against
 * Ollama, `CODEBUDDY_VISION_MODEL`, default moondream). For **code on screen** an
 * optional OCR pass (`OcrTool`, tesseract) is layered in — OCR reads source code far
 * more faithfully than a vision description does, so when `withOcr` is on the OCR
 * text is prepended as literal evidence and the VLM prose follows as context.
 *
 * The VLM call and the OCR call are both injectable so the orchestrator's fusion is
 * fully unit-testable without a real Ollama/tesseract. Never throws — any failure
 * degrades to whatever partial text we have (possibly `''`).
 *
 * @module tools/video/describe-frame
 */

import { logger } from '../../utils/logger.js';

export interface DescribeFrameDeps {
  /** Injectable VLM describer (default: local Ollama vision model). */
  analyze?: (imagePath: string, prompt: string) => Promise<string>;
  /** Injectable OCR (default: `OcrTool`/tesseract). */
  ocr?: (imagePath: string, language: string) => Promise<string>;
  /** Also run OCR and prepend the on-screen text (best for code screencasts). */
  withOcr?: boolean;
  /** OCR language code when `withOcr` is on (default 'eng'). */
  ocrLanguage?: string;
  /** Override the vision model id (default `CODEBUDDY_VISION_MODEL` / moondream). */
  visionModel?: string;
  /** Override the vision base URL (default `CODEBUDDY_VISION_BASE_URL` / local Ollama). */
  visionBaseURL?: string;
}

const DEFAULT_PROMPT =
  "Décris précisément ce qui est montré à l'écran en une à deux phrases : s'il s'agit d'un éditeur de code, d'un terminal, d'un navigateur, d'un diagramme, et ce qui y apparaît d'important.";

/** Default VLM describer — mirrors `sensory/vision-reaction.ts::defaultAnalyze`. */
async function defaultAnalyze(
  imagePath: string,
  prompt: string,
  visionModel?: string,
  visionBaseURL?: string,
): Promise<string> {
  try {
    const { loadImageFromFile, buildMultimodalContent } = await import('../image-input.js');
    const { CodeBuddyClient } = await import('../../codebuddy/client.js');
    const img = await loadImageFromFile(imagePath);
    const content = buildMultimodalContent(prompt, [img]);
    const model = visionModel || process.env.CODEBUDDY_VISION_MODEL || 'moondream';
    const baseURL = visionBaseURL || process.env.CODEBUDDY_VISION_BASE_URL || 'http://127.0.0.1:11434/v1';
    const client = new CodeBuddyClient(process.env.OLLAMA_API_KEY || 'ollama', model, baseURL);
    const resp = await client.chat([{ role: 'user', content } as never], []);
    return (resp?.choices?.[0]?.message?.content ?? '').trim();
  } catch (err) {
    logger.warn(`[video] frame VLM describe failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/** Default OCR — lazy `OcrTool` (tesseract). Returns `''` on any failure. */
async function defaultOcr(imagePath: string, language: string): Promise<string> {
  try {
    const { OcrTool } = await import('../vision/ocr-tool.js');
    const text = await OcrTool.getInstance().extractText(imagePath, language);
    return text.trim();
  } catch (err) {
    logger.debug(`[video] frame OCR failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/**
 * Describe one keyframe → a compact text of what is SHOWN. Runs the VLM, and when
 * `withOcr` is set also runs OCR and prepends the on-screen text as literal evidence.
 * Never throws; returns `''` when nothing could be produced.
 */
export async function describeFrame(
  imagePath: string,
  prompt: string = DEFAULT_PROMPT,
  deps: DescribeFrameDeps = {},
): Promise<string> {
  const analyze = deps.analyze ?? ((p: string, q: string) => defaultAnalyze(p, q, deps.visionModel, deps.visionBaseURL));
  const ocrLanguage = deps.ocrLanguage ?? 'eng';

  const [desc, ocrText] = await Promise.all([
    analyze(imagePath, prompt).catch(() => ''),
    deps.withOcr ? (deps.ocr ?? defaultOcr)(imagePath, ocrLanguage).catch(() => '') : Promise.resolve(''),
  ]);

  const parts: string[] = [];
  if (ocrText) parts.push(`Texte à l'écran (OCR):\n${ocrText}`);
  if (desc) parts.push(deps.withOcr && ocrText ? `Description: ${desc}` : desc);
  return parts.join('\n\n').trim();
}
