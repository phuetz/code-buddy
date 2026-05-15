/**
 * Image Processor Tool
 *
 * Uses sharp for native image manipulation, resizing, and analysis.
 */

import sharp from 'sharp';
import { logger } from '../../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface ImageAnalysisResult {
  description: string;
  labels: string[];
  dimensions?: { width: number; height: number };
  format?: string;
  size?: number;
  channels?: number;
}

export interface ResizeOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
}

// ============================================================================
// ImageProcessorTool
// ============================================================================

const SUPPORTED_FORMATS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'tiff', 'svg'];

export class ImageProcessorTool {
  private static instance: ImageProcessorTool | null = null;

  private constructor() {}

  static getInstance(): ImageProcessorTool {
    if (!ImageProcessorTool.instance) {
      ImageProcessorTool.instance = new ImageProcessorTool();
    }
    return ImageProcessorTool.instance;
  }

  async analyze(imagePath: string): Promise<ImageAnalysisResult> {
    if (!this.isValidImage(imagePath)) {
      throw new Error(`Unsupported image format: ${path.extname(imagePath)}`);
    }

    try {
      const metadata = await sharp(imagePath).metadata();
      const stat = fs.statSync(imagePath);
      
      const labels = ['image', metadata.format || 'unknown'];
      if (metadata.hasAlpha) labels.push('transparent');

      logger.debug('Image analyzed', { imagePath, format: metadata.format });

      return {
        description: `Image analysis of ${path.basename(imagePath)} (${metadata.width}x${metadata.height})`,
        labels,
        dimensions: {
            width: metadata.width || 0,
            height: metadata.height || 0
        },
        format: metadata.format,
        size: stat.size,
        channels: metadata.channels
      };
    } catch (error) {
      logger.error('Failed to analyze image', { imagePath, error });
      throw new Error(`Failed to analyze image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async resize(imagePath: string, options: ResizeOptions, outputPath?: string): Promise<string> {
    if (!this.isValidImage(imagePath)) {
        throw new Error(`Unsupported image format: ${path.extname(imagePath)}`);
    }

    const outPath = outputPath || this.generateOutputPath(imagePath, `resized-${options.width || 'auto'}x${options.height || 'auto'}`);

    try {
        await sharp(imagePath)
            .resize({
                width: options.width,
                height: options.height,
                fit: options.fit || 'contain',
                withoutEnlargement: true
            })
            .toFile(outPath);
            
        logger.debug('Image resized', { imagePath, outPath, options });
        return outPath;
    } catch (error) {
         logger.error('Failed to resize image', { imagePath, error });
         throw new Error(`Failed to resize image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async convert(imagePath: string, format: 'jpeg' | 'png' | 'webp' | 'avif', outputPath?: string): Promise<string> {
      if (!this.isValidImage(imagePath)) {
          throw new Error(`Unsupported image format: ${path.extname(imagePath)}`);
      }
      
      const outPath = outputPath || this.generateOutputPath(imagePath, 'converted', `.${format}`);
      
      try {
          const image = sharp(imagePath);
          switch(format) {
              case 'jpeg': await image.jpeg().toFile(outPath); break;
              case 'png': await image.png().toFile(outPath); break;
              case 'webp': await image.webp().toFile(outPath); break;
              case 'avif': await image.avif().toFile(outPath); break;
          }
          
          logger.debug('Image converted', { imagePath, outPath, format });
          return outPath;
      } catch (error) {
          logger.error('Failed to convert image', { imagePath, error });
          throw new Error(`Failed to convert image: ${error instanceof Error ? error.message : String(error)}`);
      }
  }

  // Pixel comparison using sharp. Images are normalized to a shared thumbnail so
  // different dimensions can still be compared without pulling in pixelmatch.
  async compare(path1: string, path2: string): Promise<{ similarity: number; description: string; sameDimensions: boolean }> {
      const meta1 = await sharp(path1).metadata();
      const meta2 = await sharp(path2).metadata();

      if (!meta1.width || !meta1.height || !meta2.width || !meta2.height) {
          throw new Error('Cannot compare images without dimensions');
      }

      const sameDimensions = meta1.width === meta2.width && meta1.height === meta2.height;
      const targetWidth = Math.max(1, Math.min(256, meta1.width, meta2.width));
      const targetHeight = Math.max(1, Math.min(256, meta1.height, meta2.height));
      const [img1, img2] = await Promise.all([
          sharp(path1)
              .resize(targetWidth, targetHeight, { fit: 'fill' })
              .toColourspace('srgb')
              .removeAlpha()
              .raw()
              .toBuffer(),
          sharp(path2)
              .resize(targetWidth, targetHeight, { fit: 'fill' })
              .toColourspace('srgb')
              .removeAlpha()
              .raw()
              .toBuffer(),
      ]);

      const length = Math.min(img1.length, img2.length);
      if (length === 0) {
          throw new Error('Cannot compare empty image buffers');
      }

      let totalDifference = 0;
      for (let i = 0; i < length; i++) {
          totalDifference += Math.abs(img1[i] - img2[i]);
      }

      const averageDifference = totalDifference / length / 255;
      const similarity = Math.max(0, Math.min(1, 1 - averageDifference));

      return {
          similarity: Number(similarity.toFixed(4)),
          description: `Pixel comparison of ${path.basename(path1)} (${meta1.width}x${meta1.height}) and ${path.basename(path2)} (${meta2.width}x${meta2.height})`,
          sameDimensions
      }
  }

  getSupportedFormats(): string[] {
    return [...SUPPORTED_FORMATS];
  }

  isValidImage(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    return SUPPORTED_FORMATS.includes(ext);
  }
  
  private generateOutputPath(originalPath: string, suffix: string, forceExtension?: string): string {
      const ext = forceExtension || path.extname(originalPath);
      const base = path.basename(originalPath, path.extname(originalPath));
      const dir = path.dirname(originalPath);
      return path.join(dir, `${base}-${suffix}${ext}`);
  }
}
