/**
 * Image Input Support - Vision Models (Inspired by Codex CLI, Copilot CLI, Aider)
 *
 * Allows users to include images in prompts for vision-enabled models.
 * Supports:
 * - File paths: grok "Implement this" --image screenshot.png
 * - URLs: grok "Analyze this" --image https://example.com/image.png
 * - Clipboard paste (when supported)
 * - Base64 encoded images
 */

import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import path from 'path';
import https from 'https';
import http from 'http';

export interface ImageInput {
  type: 'base64' | 'url';
  data: string;
  mimeType: string;
  source: string; // Original path/URL for reference
}

export interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

/**
 * Supported image MIME types
 */
const SUPPORTED_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Check if a file is a supported image
 */
export function isSupportedImage(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext in SUPPORTED_MIME_TYPES;
}

/**
 * Get MIME type from file extension
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Check if a string is a URL
 */
export function isUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Check if a string is base64 encoded
 */
export function isBase64(input: string): boolean {
  // Check for data URL format
  if (input.startsWith('data:image/')) {
    return true;
  }
  // Check for raw base64 (basic validation)
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(input) && input.length > 100;
}

/**
 * Load image from file path
 */
export async function loadImageFromFile(filePath: string): Promise<ImageInput> {
  const absolutePath = path.resolve(filePath);

  if (!(await UnifiedVfsRouter.Instance.exists(absolutePath))) {
    throw new Error(`Image file not found: ${filePath}`);
  }

  const mimeType = getMimeType(absolutePath);
  const buffer = await UnifiedVfsRouter.Instance.readFileBuffer(absolutePath);
  const base64 = buffer.toString('base64');

  return {
    type: 'base64',
    data: `data:${mimeType};base64,${base64}`,
    mimeType,
    source: filePath,
  };
}

/**
 * Load image from URL
 */
export async function loadImageFromUrl(url: string): Promise<ImageInput> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to fetch image: HTTP ${response.statusCode}`));
        return;
      }

      const contentType = response.headers['content-type'] || 'image/png';
      const chunks: Buffer[] = [];

      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');

        resolve({
          type: 'base64',
          data: `data:${contentType};base64,${base64}`,
          mimeType: contentType,
          source: url,
        });
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Parse image input (file path, URL, or base64)
 */
export async function parseImageInput(input: string): Promise<ImageInput> {
  // Already base64 data URL
  if (input.startsWith('data:image/')) {
    const mimeMatch = input.match(/data:(image\/[^;]+);/);
    return {
      type: 'base64',
      data: input,
      mimeType: mimeMatch ? mimeMatch[1] : 'image/png',
      source: 'base64',
    };
  }

  // URL
  if (isUrl(input)) {
    return loadImageFromUrl(input);
  }

  // File path
  return loadImageFromFile(input);
}

/**
 * Convert ImageInput to OpenAI-compatible format
 */
export function toOpenAIImageContent(image: ImageInput, detail: 'low' | 'high' | 'auto' = 'auto'): ImageContent {
  return {
    type: 'image_url',
    image_url: {
      url: image.data,
      detail,
    },
  };
}

/**
 * Build multimodal message content (text + images)
 */
export function buildMultimodalContent(
  text: string,
  images: ImageInput[],
  detail: 'low' | 'high' | 'auto' = 'auto'
): Array<{ type: 'text'; text: string } | ImageContent> {
  const content: Array<{ type: 'text'; text: string } | ImageContent> = [];

  // Add text first
  content.push({ type: 'text', text });

  // Add images
  for (const image of images) {
    content.push(toOpenAIImageContent(image, detail));
  }

  return content;
}

/**
 * Extract image references from text (e.g., @image.png, @https://...)
 */
export function extractImageReferences(text: string): { cleanText: string; imagePaths: string[] } {
  const imagePaths: string[] = [];

  // Match @path/to/image.png or @https://...
  const imageRegex = /@((?:https?:\/\/[^\s]+)|(?:[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg)))/gi;

  const cleanText = text.replace(imageRegex, (match, path) => {
    imagePaths.push(path);
    return ''; // Remove from text
  }).trim();

  return { cleanText, imagePaths };
}

/**
 * Check if model supports vision
 */
export function supportsVision(modelName: string): boolean {
  const visionModels = [
    'gpt-4-vision', 'gpt-4o', 'gpt-4-turbo',
    'claude-3', 'claude-4',
    'gemini-pro-vision', 'gemini-1.5', 'gemini-2',
    'grok-vision', 'grok-2',
    'llava', 'bakllava',
  ];

  const lower = modelName.toLowerCase();
  return visionModels.some(vm => lower.includes(vm.toLowerCase()));
}

/**
 * Format image summary for display
 */
export function formatImageSummary(images: ImageInput[]): string {
  if (images.length === 0) return '';

  const lines = images.map((img, i) => {
    const size = Math.round(img.data.length / 1024);
    return `  ${i + 1}. ${img.source} (${img.mimeType}, ~${size}KB)`;
  });

  return `Images attached:\n${lines.join('\n')}`;
}
