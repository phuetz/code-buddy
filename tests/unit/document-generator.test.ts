import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { executeGenerateDocument, generateDocument } from '../../src/tools/document-generator.js';
import { DocumentTool } from '../../src/tools/document-tool.js';

function invalidXmlCharacters(value: string): string[] {
  return Array.from(value).filter((char) => {
    const codePoint = char.codePointAt(0);
    return Boolean(
      codePoint !== undefined && (
        (codePoint >= 0x00 && codePoint <= 0x08) ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0xfffe ||
        codePoint === 0xffff
      )
    );
  });
}

describe('document generator DOCX output', () => {
  it('generates a Word-readable DOCX with tables and embedded-image notes', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-docx-generator-'));
    const outputPath = join(tempDir, 'workshop.docx');

    try {
      const result = await generateDocument({
        type: 'docx',
        title: 'Word workshop',
        outputPath,
        content: [
          '# Source context',
          '[Table]',
          'Question\tContext',
          'Q1\tScreen context before answer',
          '[Embedded image: media/screen-impact.png]',
        ].join('\n'),
      });

      expect(result).toEqual({ success: true, outputPath });

      const zip = new AdmZip(outputPath);
      const contentTypes = zip.readAsText('[Content_Types].xml');
      const documentXml = zip.readAsText('word/document.xml');

      expect(contentTypes).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
      );
      expect(documentXml).toContain('<w:tbl>');
      expect(documentXml).toContain('Question');
      expect(documentXml).toContain('Screen context before answer');
      expect(documentXml).toContain('Embedded image: media/screen-impact.png');
      expect(documentXml).not.toContain('[Table]');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('strips XML-invalid control characters from generated Word text', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-docx-generator-'));
    const outputPath = join(tempDir, 'sanitized.docx');

    try {
      const result = await executeGenerateDocument({
        type: 'docx',
        title: 'Invalid\u0000Title',
        outputPath,
        content: [
          '# Heading\u0008One',
          'Paragraph with vertical\u000btab, <xml> and & symbols.',
          '| Key | Value |',
          '| Bad\u0007cell | Clean |',
        ].join('\n'),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(`Created DOCX: ${outputPath}`);
      expect(result.output).toContain('DOCX validation:');

      const zip = new AdmZip(outputPath);
      const documentXml = zip.readAsText('word/document.xml');

      expect(invalidXmlCharacters(documentXml)).toEqual([]);
      expect(documentXml).toContain('InvalidTitle');
      expect(documentXml).toContain('HeadingOne');
      expect(documentXml).toContain('Paragraph with verticaltab');
      expect(documentXml).toContain('Badcell');
      expect(documentXml).toContain('&lt;xml&gt;');
      expect(documentXml).toContain('&amp;');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('renders markdown pipe tables as Word tables', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-docx-generator-'));
    const outputPath = join(tempDir, 'answers.docx');

    try {
      const result = await generateDocument({
        type: 'docx',
        title: 'Answers',
        outputPath,
        content: [
          '## Answers',
          '| Question | Answer |',
          '| --- | --- |',
          '| Q1 | Detailed answer |',
        ].join('\n'),
      });

      expect(result).toEqual({ success: true, outputPath });

      const zip = new AdmZip(outputPath);
      const documentXml = zip.readAsText('word/document.xml');

      expect(documentXml).toContain('<w:tbl>');
      expect(documentXml).toContain('Detailed answer');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('embeds local image references in generated Word documents', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-docx-generator-'));
    const outputPath = join(tempDir, 'with-image.docx');
    const imagePath = join(tempDir, 'screen.png');

    try {
      writeFileSync(
        imagePath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        )
      );

      const result = await generateDocument({
        type: 'docx',
        title: 'Answers with screenshot',
        outputPath,
        content: [
          '## Functional analysis',
          '![Impact screenshot](screen.png)',
          'The OCR confirms the impact context.',
        ].join('\n'),
      });

      expect(result).toMatchObject({ success: true, outputPath });
      expect(result.embeddedImages).toEqual([{
        path: imagePath,
        caption: 'Impact screenshot',
        width: 1,
        height: 1,
      }]);

      const zip = new AdmZip(outputPath);
      const entries = zip.getEntries().map(entry => entry.entryName);
      const documentXml = zip.readAsText('word/document.xml');
      const imageExtent = documentXml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);

      expect(entries.some(entry => entry.startsWith('word/media/') && entry.endsWith('.png'))).toBe(true);
      expect(documentXml).toContain('Figure - Impact screenshot');
      expect(imageExtent).not.toBeNull();
      expect(imageExtent?.[1]).toBe(imageExtent?.[2]);
      expect(documentXml).toContain('The OCR confirms the impact context.');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('can turn extracted DOCX images into embedded final-document screenshots', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-docx-workshop-'));
    const sourcePath = join(tempDir, 'source-questions.docx');
    const extractedDir = join(tempDir, 'screens');
    const outputPath = join(tempDir, 'final-deliverable.docx');
    const sourceZip = new AdmZip();
    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    try {
      sourceZip.addFile('word/document.xml', Buffer.from('<w:document><w:body /></w:document>'));
      sourceZip.addFile('word/media/screen.png', imageBytes);
      writeFileSync(sourcePath, sourceZip.toBuffer());

      const extraction = await new DocumentTool().extractEmbeddedImages(sourcePath, extractedDir);

      expect(extraction.success).toBe(true);
      expect(existsSync(join(extractedDir, 'screen.png'))).toBe(true);

      const result = await generateDocument({
        type: 'docx',
        title: 'Final deliverable',
        outputPath,
        content: [
          '## Functional analysis',
          '![Extracted source screenshot](screens/screen.png)',
          'OCR summary: source screen validates the impact context.',
        ].join('\n'),
      });

      expect(result).toMatchObject({ success: true, outputPath });
      expect(result.embeddedImages).toEqual([{
        path: join(extractedDir, 'screen.png'),
        caption: 'Extracted source screenshot',
        width: 1,
        height: 1,
      }]);

      const finalZip = new AdmZip(outputPath);
      const entries = finalZip.getEntries().map(entry => entry.entryName);
      const documentXml = finalZip.readAsText('word/document.xml');

      expect(entries.some(entry => entry.startsWith('word/media/') && entry.endsWith('.png'))).toBe(true);
      expect(documentXml).toContain('Figure - Extracted source screenshot');
      expect(documentXml).toContain('OCR summary: source screen validates the impact context.');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs the local Word-workshop flow from source DOCX to final deliverable', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-word-workshop-flow-'));
    const sourcePath = join(tempDir, 'questions-source.docx');
    const extractedDir = join(tempDir, 'questions-source-images');
    const outputPath = join(tempDir, 'questions-source-livrable.docx');
    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const sourceZip = new AdmZip();

    try {
      sourceZip.addFile(
        'word/document.xml',
        Buffer.from(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
            '<w:body>' +
            '<w:p><w:r><w:t>Analyse fonctionnelle avant questions</w:t></w:r></w:p>' +
            '<w:tbl>' +
            '<w:tr><w:tc><w:p><w:r><w:t>Question</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Contexte</w:t></w:r></w:p></w:tc></w:tr>' +
            '<w:tr><w:tc><w:p><w:r><w:t>Question 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Capture écran impact demande</w:t></w:r></w:p></w:tc></w:tr>' +
            '</w:tbl>' +
            '<w:p><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>' +
            '<w:p><w:r><w:t>Question 1: détailler le traitement attendu?</w:t></w:r></w:p>' +
            '</w:body>' +
            '</w:document>'
        )
      );
      sourceZip.addFile(
        'word/_rels/document.xml.rels',
        Buffer.from(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/screen-impact.png"/>' +
            '</Relationships>'
        )
      );
      sourceZip.addFile('word/media/screen-impact.png', imageBytes);
      writeFileSync(sourcePath, sourceZip.toBuffer());

      const documentTool = new DocumentTool();
      const readResult = await documentTool.readDocument(sourcePath);
      expect(readResult.success).toBe(true);
      expect(readResult.data).toMatchObject({
        text: expect.stringContaining('Analyse fonctionnelle avant questions'),
        metadata: {
          embeddedImageCount: 1,
        },
      });
      expect(String(readResult.data?.text)).toContain('Question\tContexte');
      expect(String(readResult.data?.text)).toContain('[Embedded image: media/screen-impact.png]');

      const extraction = await documentTool.extractEmbeddedImages(sourcePath, extractedDir);
      expect(extraction.success).toBe(true);
      const images = extraction.data?.images as Array<{ outputPath: string; markdownRef: string }>;
      expect(images).toHaveLength(1);
      expect(images[0].markdownRef).toBe(`![Source screenshot - screen-impact.png](${join(extractedDir, 'screen-impact.png').replace(/\\/g, '/')})`);

      const generation = await executeGenerateDocument({
        type: 'docx',
        title: 'Livrable questions source',
        outputPath,
        content: [
          '# Analyse fonctionnelle',
          'Contexte source: Analyse fonctionnelle avant questions.',
          '',
          '## Question 1',
          'Question: détailler le traitement attendu?',
          'Réponse: le traitement doit préserver le contexte de capture écran avant de conclure.',
          images[0].markdownRef,
        ].join('\n'),
      });

      expect(generation.success).toBe(true);
      expect(generation.output).toContain(`Created DOCX: ${outputPath}`);
      expect(generation.output).toContain('Embedded images:');
      expect(generation.output).toContain('DOCX validation:');
      expect(generation.data).toMatchObject({
        outputPath,
        embeddedImages: [{
          path: join(extractedDir, 'screen-impact.png').replace(/\\/g, '/'),
          caption: 'Source screenshot - screen-impact.png',
        }],
        docxValidation: {
          embeddedRelationshipCount: 1,
          mediaFileCount: expect.any(Number),
        },
      });
      const generationData = generation.data as {
        docxValidation?: { mediaFileCount: number };
      };
      expect(generationData.docxValidation?.mediaFileCount).toBeGreaterThanOrEqual(1);

      const finalZip = new AdmZip(outputPath);
      const documentXml = finalZip.readAsText('word/document.xml');
      const entries = finalZip.getEntries().map(entry => entry.entryName);

      expect(entries.some(entry => entry.startsWith('word/media/') && entry.endsWith('.png'))).toBe(true);
      expect(documentXml).toContain('Livrable questions source');
      expect(documentXml).toContain('Réponse: le traitement doit préserver le contexte');
      expect(documentXml).toContain('Figure - Source screenshot - screen-impact.png');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects output paths with a mismatched document extension', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-docx-generator-'));
    const outputPath = join(tempDir, 'wrong-extension.pdf');

    try {
      const result = await generateDocument({
        type: 'docx',
        title: 'Wrong extension',
        outputPath,
        content: '## Body\nHello',
      });

      expect(result).toEqual({
        success: false,
        error: 'outputPath must end with .docx for DOCX documents',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reports embedded DOCX image metadata from the tool adapter', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-docx-generator-'));
    const outputPath = join(tempDir, 'adapter-image.docx');
    const imagePath = join(tempDir, 'adapter-screen.png');

    try {
      writeFileSync(
        imagePath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        )
      );

      const result = await executeGenerateDocument({
        type: 'docx',
        title: 'Adapter image report',
        outputPath,
        content: '## Evidence\n![Adapter screenshot](adapter-screen.png)',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(`Created DOCX: ${outputPath}`);
      expect(result.output).toContain(`- ${imagePath} (Adapter screenshot) [1x1]`);
      expect(result.output).toContain('DOCX validation:');
      expect(result.output).toContain('- embedded image relationships: 1');
      expect(result.output).toContain('- media files:');
      expect(result.data).toMatchObject({
        outputPath,
        embeddedImages: [{
          path: imagePath,
          caption: 'Adapter screenshot',
          width: 1,
          height: 1,
        }],
        docxValidation: {
          embeddedRelationshipCount: 1,
          mediaFileCount: expect.any(Number),
        },
      });
      const resultData = result.data as {
        docxValidation?: { mediaFileCount: number };
      };
      expect(resultData.docxValidation?.mediaFileCount).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
