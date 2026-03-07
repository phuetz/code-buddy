/**
 * Optical Character Recognition (OCR) Tool
 *
 * Uses tesseract.js for extracting text from images.
 */

import { createWorker } from 'tesseract.js';
import { logger } from '../../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

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

    try {
      this.isInitializing = true;
      logger.debug(`Initializing OCR worker for language: ${language}`);
      const worker = await createWorker(language);
      
      logger.debug(`Starting OCR on image: ${imagePath}`);
      const { data: { text } } = await worker.recognize(imagePath);
      
      await worker.terminate();
      logger.debug(`OCR completed on image: ${imagePath}`);
      
      return text.trim();
    } catch (error) {
       logger.error('OCR extraction failed', { error, imagePath });
       throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
       this.isInitializing = false;
    }
  }
}
