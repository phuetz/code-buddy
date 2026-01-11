import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import path from 'path';
import { ToolResult, getErrorMessage } from '../types/index.js';

export interface ImageInput {
  type: 'base64' | 'url' | 'file';
  data: string;
  mediaType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

export interface ProcessedImage {
  base64: string;
  mediaType: string;
  source: string;
}

/**
 * Image Tool for processing and preparing images for vision models
 */
export class ImageTool {
  private readonly supportedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  private readonly maxFileSizeMB = 20; // 20MB max
  private vfs = UnifiedVfsRouter.Instance;

  /**
   * Process an image from various sources
   */
  async processImage(input: ImageInput): Promise<ToolResult> {
    try {
      let processed: ProcessedImage;

      switch (input.type) {
        case 'file':
          processed = await this.processFileImage(input.data);
          break;
        case 'base64':
          processed = this.processBase64Image(input.data, input.mediaType || 'image/png');
          break;
        case 'url':
          processed = await this.processUrlImage(input.data);
          break;
        default:
          return {
            success: false,
            error: `Unknown image input type: ${input.type}`
          };
      }

      return {
        success: true,
        output: `Image processed successfully from ${processed.source}`,
        data: processed
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to process image: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Process an image from a file path
   */
  private async processFileImage(filePath: string): Promise<ProcessedImage> {
    const resolvedPath = path.resolve(process.cwd(), filePath);

    // Check file existence asynchronously
    if (!await this.vfs.exists(resolvedPath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!this.supportedExtensions.includes(ext)) {
      throw new Error(`Unsupported image format: ${ext}. Supported: ${this.supportedExtensions.join(', ')}`);
    }

    const stats = await this.vfs.stat(resolvedPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > this.maxFileSizeMB) {
      throw new Error(`Image file too large: ${fileSizeMB.toFixed(2)}MB. Max: ${this.maxFileSizeMB}MB`);
    }

    const buffer = await this.vfs.readFileBuffer(resolvedPath);
    const base64 = buffer.toString('base64');
    const mediaType = this.getMediaType(ext);

    return {
      base64,
      mediaType,
      source: `file:${filePath}`
    };
  }

  /**
   * Process a base64 encoded image
   */
  private processBase64Image(base64: string, mediaType: string): ProcessedImage {
    // Remove data URL prefix if present
    const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '');

    return {
      base64: cleanBase64,
      mediaType,
      source: 'base64'
    };
  }

  /**
   * Process an image from a URL
   */
  private async processUrlImage(url: string): Promise<ProcessedImage> {
    const axios = (await import('axios')).default;

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: this.maxFileSizeMB * 1024 * 1024,
      headers: {
        'User-Agent': 'CodeBuddyCLI/1.0'
      }
    });

    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString('base64');

    // Try to determine media type from headers or URL
    const contentType = response.headers['content-type'] || 'image/png';
    const mediaType = contentType.split(';')[0].trim();

    return {
      base64,
      mediaType,
      source: `url:${url}`
    };
  }

  /**
   * Get media type from file extension
   */
  private getMediaType(ext: string): string {
    const mediaTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    return mediaTypes[ext] || 'image/png';
  }

  /**
   * List images in a directory
   */
  async listImages(dirPath: string = '.'): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(process.cwd(), dirPath);

      if (!await this.vfs.exists(resolvedPath)) {
        return {
          success: false,
          error: `Directory not found: ${dirPath}`
        };
      }

      const entries = await this.vfs.readDirectory(resolvedPath);
      const images = entries.filter(e => {
        if (!e.isFile) return false;
        const ext = path.extname(e.name).toLowerCase();
        return this.supportedExtensions.includes(ext);
      });

      if (images.length === 0) {
        return {
          success: true,
          output: `No images found in ${dirPath}`
        };
      }

      const imageListPromises = images.map(async img => {
        const fullPath = path.join(resolvedPath, img.name);
        const stats = await this.vfs.stat(fullPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        return `  ${img.name} (${sizeMB}MB)`;
      });

      const imageList = (await Promise.all(imageListPromises)).join('\n');

      return {
        success: true,
        output: `Images in ${dirPath}:\n${imageList}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list images: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Format image for CodeBuddy API message content
   */
  formatForApi(processed: ProcessedImage): object {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${processed.mediaType};base64,${processed.base64}`
      }
    };
  }

  /**
   * Check if a file is an image
   */
  isImage(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }
}
