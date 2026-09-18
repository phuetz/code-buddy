/**
 * Render a Markdown model to a .pptx file with pptxgenjs (MIT).
 *
 * @module main/office-export/pptx-export
 */

import * as fs from 'fs';
import * as path from 'path';
import PptxGenJS from 'pptxgenjs';
import { fitImageBox, loadLocalImage } from './images';
import { documentToSlides, FALLBACK_TITLE, type MdDocument } from './markdown-model';
import { sanitizeXmlText } from './sanitize';

export interface PptxExportResult {
  warnings: string[];
  slideCount: number;
}

export async function writePptxFile(
  docModel: MdDocument,
  outputPath: string,
  baseDir: string
): Promise<PptxExportResult> {
  const warnings: string[] = [];
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'LAYOUT_WIDE', width: 13.333, height: 7.5 });
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = sanitizeXmlText(docModel.title || FALLBACK_TITLE);
  pptx.author = 'Code Buddy Cowork';

  const slides = documentToSlides(docModel, warnings);
  for (const model of slides) {
    const slide = pptx.addSlide();
    slide.addText(sanitizeXmlText(model.title || FALLBACK_TITLE), {
      x: 0.6,
      y: 0.35,
      w: 12.1,
      h: 0.7,
      fontSize: 28,
      bold: true,
      color: '0F172A',
      fontFace: 'Arial',
      margin: 0,
    });

    const hasImage = Boolean(model.image);
    const bulletW = hasImage ? 7.4 : 12.1;
    const bullets = model.bullets.map((text) => ({
      text: sanitizeXmlText(text),
      options: { bullet: true, breakLine: true, fontSize: 18, color: '1E293B', fontFace: 'Arial' },
    }));
    if (bullets.length > 0) {
      slide.addText(bullets, {
        x: 0.6,
        y: 1.2,
        w: bulletW,
        h: 5.6,
        valign: 'top',
      });
    }

    if (model.image) {
      const loaded = loadLocalImage(model.image.src, baseDir);
      if (loaded.warning) warnings.push(loaded.warning);
      if (loaded.image) {
        const box = fitImageBox(loaded.image, 420, 300);
        const mime = loaded.image.type === 'jpg' ? 'image/jpeg' : `image/${loaded.image.type}`;
        const inchesW = box.width / 96;
        const inchesH = box.height / 96;
        slide.addImage({
          data: `${mime};base64,${loaded.image.data.toString('base64')}`,
          x: 8.4,
          y: 1.3,
          w: inchesW,
          h: inchesH,
          altText: model.image.alt || 'image',
        });
      } else {
        slide.addText(sanitizeXmlText(`[Image manquante : ${model.image.alt || model.image.src}]`), {
          x: 8.4,
          y: 1.3,
          w: 4.3,
          h: 1.2,
          fontSize: 12,
          italic: true,
          color: '64748B',
        });
      }
    }

    if (model.notes.trim()) {
      slide.addNotes(sanitizeXmlText(model.notes));
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await pptx.writeFile({ fileName: outputPath });
  return { warnings, slideCount: slides.length };
}
