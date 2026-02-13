/**
 * Browser Screenshot Annotator
 *
 * Overlays numeric reference badges on browser screenshots,
 * matching the desktop's smart-snapshot annotation pattern.
 * Uses Sharp SVG composite for image manipulation.
 */

import type { WebElement } from './types.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface AnnotationOptions {
  /** Badge style */
  style?: 'circle' | 'pill';
  /** Badge background color */
  color?: string;
  /** Text color */
  textColor?: string;
  /** Font size */
  fontSize?: number;
}

const DEFAULT_OPTIONS: Required<AnnotationOptions> = {
  style: 'circle',
  color: '#FF6B6B',
  textColor: '#FFFFFF',
  fontSize: 12,
};

// ============================================================================
// Annotator
// ============================================================================

/**
 * Annotate a browser screenshot with numbered reference badges
 * for each interactive element in the snapshot.
 */
export async function annotateScreenshot(
  buffer: Buffer,
  elements: WebElement[],
  options?: AnnotationOptions
): Promise<Buffer> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let sharpFn: typeof import('sharp');
  try {
    const mod = await import('sharp');
    // CJS `export =` becomes `{ default: sharp }` at runtime under ESM interop
    sharpFn = (mod as Record<string, unknown>).default as typeof import('sharp') ?? mod;
  } catch {
    logger.warn('Sharp not available for screenshot annotation; returning raw screenshot');
    return buffer;
  }

  const metadata = await sharpFn(buffer).metadata();
  const imgWidth = metadata.width || 1280;
  const imgHeight = metadata.height || 720;

  // Build SVG overlay with badges
  const badges = elements
    .filter(el => el.visible && el.boundingBox)
    .map(el => {
      const x = Math.min(Math.max(el.boundingBox.x, 0), imgWidth - 30);
      const y = Math.min(Math.max(el.boundingBox.y - 10, 0), imgHeight - 20);
      const label = String(el.ref);

      if (opts.style === 'pill') {
        const pillWidth = Math.max(24, label.length * 10 + 12);
        return `
          <rect x="${x}" y="${y}" width="${pillWidth}" height="20" rx="10" ry="10"
                fill="${opts.color}" opacity="0.9"/>
          <text x="${x + pillWidth / 2}" y="${y + 14}" text-anchor="middle"
                font-family="Arial,sans-serif" font-size="${opts.fontSize}" font-weight="bold"
                fill="${opts.textColor}">${label}</text>
        `;
      }

      // Circle style (default)
      const radius = Math.max(12, label.length * 5 + 6);
      return `
        <circle cx="${x + radius}" cy="${y + radius}" r="${radius}"
                fill="${opts.color}" opacity="0.9"/>
        <text x="${x + radius}" y="${y + radius + 4}" text-anchor="middle"
              font-family="Arial,sans-serif" font-size="${opts.fontSize}" font-weight="bold"
              fill="${opts.textColor}">${label}</text>
      `;
    })
    .join('\n');

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">
      ${badges}
    </svg>
  `;

  try {
    const annotated = await sharpFn(buffer)
      .composite([{
        input: Buffer.from(svg),
        top: 0,
        left: 0,
      }])
      .png()
      .toBuffer();

    return annotated;
  } catch (error) {
    logger.warn('Failed to annotate screenshot', { error });
    return buffer;
  }
}
