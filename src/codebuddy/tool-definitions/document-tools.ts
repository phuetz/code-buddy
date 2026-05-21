/**
 * Document Generator Tool Definitions
 *
 * OpenAI function calling schema for the generate_document tool.
 * Matches Open Cowork / Claude Cowork document generation capabilities.
 */

import type { CodeBuddyTool } from './types.js';

export const GENERATE_DOCUMENT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'generate_document',
    description: 'Generate professional documents: PowerPoint (PPTX), Word (DOCX), Excel (XLSX), or PDF. Provide markdown content and the tool converts it to the specified format. Use # for title, ## for sections, ### for subsections, - for bullets, ``` for code blocks, | or tab-separated rows for tables, and local image references like ![caption](path) for DOCX screenshots. DOCX image references are embedded with aspect-ratio fitting and visible captions from the alt text. Output paths must use the matching extension.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['pptx', 'docx', 'xlsx', 'pdf'],
          description: 'Document format to generate',
        },
        title: {
          type: 'string',
          description: 'Document title',
        },
        content: {
          type: 'string',
          description: 'Document content in markdown format. Use # for title slide, ## for section headers, ### for sub-sections, - for bullet points, ``` for code blocks. For DOCX, local image references such as ![caption](screens/image1.png) are embedded, fitted without distortion, and captioned from the alt text. For XLSX, use CSV rows or JSON array of objects.',
        },
        outputPath: {
          type: 'string',
          description: 'Output file path with matching extension, e.g. "./report.docx", "./deck.pptx", or "./output/analysis.pdf"',
        },
        theme: {
          type: 'string',
          enum: ['professional', 'minimal', 'dark'],
          description: 'Visual theme for the document (default: professional)',
        },
        pageSize: {
          type: 'string',
          enum: ['A4', 'letter'],
          description: 'Page size for PDF/DOCX (default: A4)',
        },
        orientation: {
          type: 'string',
          enum: ['portrait', 'landscape'],
          description: 'Page orientation for PDF (default: portrait)',
        },
      },
      required: ['type', 'title', 'content', 'outputPath'],
    },
  },
};

export const DOCUMENT_GENERATOR_TOOLS: CodeBuddyTool[] = [GENERATE_DOCUMENT_TOOL];
