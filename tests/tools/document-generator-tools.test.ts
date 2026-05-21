import { describe, expect, it } from 'vitest';
import { GenerateDocumentExecuteTool } from '../../src/tools/registry/document-generator-tools.js';

describe('GenerateDocumentExecuteTool validation', () => {
  it('advertises DOCX local image caption behavior', () => {
    const tool = new GenerateDocumentExecuteTool();
    const schema = tool.getSchema();
    const contentDescription = schema.parameters.properties?.content?.description ?? '';

    expect(tool.description).toContain('visible captions');
    expect(contentDescription).toContain('fitted without distortion');
    expect(contentDescription).toContain('captioned from the alt text');
  });

  it('accepts matching document extensions', () => {
    const tool = new GenerateDocumentExecuteTool();

    expect(tool.validate({
      type: 'docx',
      title: 'Workshop',
      content: '## Questions\n- Answer one',
      outputPath: 'reports/workshop.docx',
    })).toEqual({ valid: true });
  });

  it('rejects mismatched output extensions before generation', () => {
    const tool = new GenerateDocumentExecuteTool();

    const result = tool.validate({
      type: 'docx',
      title: 'Workshop',
      content: '## Questions\n- Answer one',
      outputPath: 'reports/workshop.pdf',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('outputPath must end with .docx when type is docx');
  });
});
