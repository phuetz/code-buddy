/**
 * Optical Character Recognition (OCR) Tool
 *
 * Uses tesseract.js for extracting text from images.
 */

import { createWorker } from 'tesseract.js';
import { logger } from '../../utils/logger.js';
import * as fs from 'fs';

export class OcrTool {
  private static instance: OcrTool | null = null;
  private isInitializing = false;

  private constructor() {}

  static getInstance(): OcrTool {
    if (!OcrTool.instance) {
      OcrTool.instance = new OcrTool();
    }
    return OcrTool.instance;
  }

  async extractText(imagePath: string, language: string = 'eng'): Promise<string> {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    const timeoutMs = 30_000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      this.isInitializing = true;
      logger.debug(`Initializing OCR worker for language: ${language}`);
      const creating = createWorker(language);
      let creationTimedOut = false;
      void creating.then(async (created) => {
        if (creationTimedOut) await created.terminate();
      }).catch(() => {});
      worker = await Promise.race([
        creating,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            creationTimedOut = true;
            reject(new Error(`OCR timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      
      logger.debug(`Starting OCR on image: ${imagePath}`);
      const { data: { text } } = await Promise.race([
        worker.recognize(imagePath),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`OCR timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      logger.debug(`OCR completed on image: ${imagePath}`);
      
      return text.trim();
    } catch (error) {
       logger.error('OCR extraction failed', { error, imagePath });
       throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
       if (timeout) clearTimeout(timeout);
       if (worker) await worker.terminate().catch(() => {});
       this.isInitializing = false;
    }
  }
}
