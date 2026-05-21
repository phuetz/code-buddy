import { describe, expect, it } from 'vitest';
import { DocumentExecuteTool } from '../../src/tools/registry/multimodal-tools.js';

describe('DocumentExecuteTool validation', () => {
  it('advertises DOCX embedded image extraction', () => {
    const tool = new DocumentExecuteTool();
    const schema = tool.getSchema();
    const operation = schema.parameters.properties?.operation;
    const outputDir = schema.parameters.properties?.output_dir;

    expect(tool.description).toContain('Markdown references');
    expect(operation?.enum).toContain('extract_images');
    expect(operation?.description).toContain('Markdown image references');
    expect(outputDir).toMatchObject({
      type: 'string',
    });
    expect(outputDir?.description).toContain('markdownRef');
  });

  it('accepts extract_images with an output directory', () => {
    const tool = new DocumentExecuteTool();

    expect(tool.validate({
      operation: 'extract_images',
      path: 'questions.docx',
      output_dir: 'screens',
    })).toEqual({ valid: true });
  });

  it('rejects unknown document operations', () => {
    const tool = new DocumentExecuteTool();

    expect(tool.validate({
      operation: 'extract_text_and_images',
      path: 'questions.docx',
    })).toEqual({
      valid: false,
      errors: ['operation must be one of: read, list, extract_images'],
    });
  });
});
