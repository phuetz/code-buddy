/**
 * Jupyter Notebook Tool
 *
 * Read, analyze, and edit Jupyter notebooks (.ipynb files).
 * Supports cell manipulation, execution output parsing, and code extraction.
 */

import fs from 'fs-extra';
import * as path from 'path';
import type { ToolResult } from './index.js';

// ============================================================================
// Types
// ============================================================================

interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: NotebookOutput[];
}

interface NotebookOutput {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error';
  name?: string;
  text?: string[];
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    kernelspec?: {
      display_name: string;
      language: string;
      name: string;
    };
    language_info?: {
      name: string;
      version: string;
    };
  };
  cells: NotebookCell[];
}

// ============================================================================
// Notebook Tool
// ============================================================================

export class NotebookTool {
  name = 'notebook';
  description = 'Read, analyze, and edit Jupyter notebooks (.ipynb files)';
  dangerLevel: 'safe' | 'low' | 'medium' | 'high' = 'low';

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'read_cell', 'add_cell', 'update_cell', 'delete_cell', 'extract_code', 'summarize'],
        description: 'Action to perform on the notebook',
      },
      path: {
        type: 'string',
        description: 'Path to the notebook file',
      },
      cellIndex: {
        type: 'number',
        description: 'Cell index (0-based) for cell operations',
      },
      cellType: {
        type: 'string',
        enum: ['code', 'markdown', 'raw'],
        description: 'Type of cell to add',
      },
      content: {
        type: 'string',
        description: 'Content for the cell',
      },
    },
    required: ['action', 'path'],
  };

  /**
   * Execute the notebook tool
   */
  async execute(params: {
    action: 'read' | 'read_cell' | 'add_cell' | 'update_cell' | 'delete_cell' | 'extract_code' | 'summarize';
    path: string;
    cellIndex?: number;
    cellType?: 'code' | 'markdown' | 'raw';
    content?: string;
  }): Promise<ToolResult> {
    try {
      const { action, path: filePath } = params;

      switch (action) {
        case 'read':
          return this.readNotebook(filePath);
        case 'read_cell':
          return this.readCell(filePath, params.cellIndex!);
        case 'add_cell':
          return this.addCell(filePath, params.cellType || 'code', params.content || '');
        case 'update_cell':
          return this.updateCell(filePath, params.cellIndex!, params.content || '');
        case 'delete_cell':
          return this.deleteCell(filePath, params.cellIndex!);
        case 'extract_code':
          return this.extractCode(filePath);
        case 'summarize':
          return this.summarize(filePath);
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Read entire notebook
   */
  private async readNotebook(filePath: string): Promise<ToolResult> {
    const notebook = await this.loadNotebook(filePath);

    const parts: string[] = [
      `# Notebook: ${path.basename(filePath)}`,
      '',
      `**Format**: nbformat ${notebook.nbformat}.${notebook.nbformat_minor}`,
    ];

    if (notebook.metadata.kernelspec) {
      parts.push(`**Kernel**: ${notebook.metadata.kernelspec.display_name}`);
    }
    if (notebook.metadata.language_info) {
      parts.push(`**Language**: ${notebook.metadata.language_info.name} ${notebook.metadata.language_info.version || ''}`);
    }

    parts.push('', `**Cells**: ${notebook.cells.length}`, '');

    for (let i = 0; i < notebook.cells.length; i++) {
      const cell = notebook.cells[i];
      parts.push(`## Cell ${i} [${cell.cell_type}]`);

      if (cell.execution_count !== undefined && cell.execution_count !== null) {
        parts.push(`Execution: [${cell.execution_count}]`);
      }

      parts.push('```' + (cell.cell_type === 'code' ? notebook.metadata.language_info?.name || '' : ''));
      parts.push(cell.source.join(''));
      parts.push('```');

      // Show outputs for code cells
      if (cell.outputs && cell.outputs.length > 0) {
        parts.push('', '**Output:**');
        for (const output of cell.outputs) {
          parts.push(this.formatOutput(output));
        }
      }

      parts.push('');
    }

    return { success: true, content: parts.join('\n') };
  }

  /**
   * Read a specific cell
   */
  private async readCell(filePath: string, cellIndex: number): Promise<ToolResult> {
    const notebook = await this.loadNotebook(filePath);

    if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
      return { success: false, error: `Cell index ${cellIndex} out of range (0-${notebook.cells.length - 1})` };
    }

    const cell = notebook.cells[cellIndex];
    const content = cell.source.join('');

    const parts = [
      `## Cell ${cellIndex} [${cell.cell_type}]`,
      '```',
      content,
      '```',
    ];

    if (cell.outputs && cell.outputs.length > 0) {
      parts.push('', '**Output:**');
      for (const output of cell.outputs) {
        parts.push(this.formatOutput(output));
      }
    }

    return { success: true, content: parts.join('\n') };
  }

  /**
   * Add a new cell
   */
  private async addCell(filePath: string, cellType: 'code' | 'markdown' | 'raw', content: string): Promise<ToolResult> {
    const notebook = await this.loadNotebook(filePath);

    const newCell: NotebookCell = {
      cell_type: cellType,
      source: content.split('\n').map((line, i, arr) => i < arr.length - 1 ? line + '\n' : line),
      metadata: {},
    };

    if (cellType === 'code') {
      newCell.execution_count = null;
      newCell.outputs = [];
    }

    notebook.cells.push(newCell);
    await this.saveNotebook(filePath, notebook);

    return {
      success: true,
      content: `Added ${cellType} cell at index ${notebook.cells.length - 1}`,
    };
  }

  /**
   * Update an existing cell
   */
  private async updateCell(filePath: string, cellIndex: number, content: string): Promise<ToolResult> {
    const notebook = await this.loadNotebook(filePath);

    if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
      return { success: false, error: `Cell index ${cellIndex} out of range` };
    }

    notebook.cells[cellIndex].source = content.split('\n').map((line, i, arr) =>
      i < arr.length - 1 ? line + '\n' : line
    );

    // Clear outputs for code cells when updated
    if (notebook.cells[cellIndex].cell_type === 'code') {
      notebook.cells[cellIndex].outputs = [];
      notebook.cells[cellIndex].execution_count = null;
    }

    await this.saveNotebook(filePath, notebook);

    return { success: true, content: `Updated cell ${cellIndex}` };
  }

  /**
   * Delete a cell
   */
  private async deleteCell(filePath: string, cellIndex: number): Promise<ToolResult> {
    const notebook = await this.loadNotebook(filePath);

    if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
      return { success: false, error: `Cell index ${cellIndex} out of range` };
    }

    notebook.cells.splice(cellIndex, 1);
    await this.saveNotebook(filePath, notebook);

    return { success: true, content: `Deleted cell ${cellIndex}` };
  }

  /**
   * Extract all code from the notebook
   */
  private async extractCode(filePath: string): Promise<ToolResult> {
    const notebook = await this.loadNotebook(filePath);

    const codeBlocks: string[] = [];

    for (let i = 0; i < notebook.cells.length; i++) {
      const cell = notebook.cells[i];
      if (cell.cell_type === 'code') {
        codeBlocks.push(`# Cell ${i}`);
        codeBlocks.push(cell.source.join(''));
        codeBlocks.push('');
      }
    }

    return { success: true, content: codeBlocks.join('\n') };
  }

  /**
   * Summarize the notebook
   */
  private async summarize(filePath: string): Promise<ToolResult> {
    const notebook = await this.loadNotebook(filePath);

    const codeCells = notebook.cells.filter(c => c.cell_type === 'code');
    const markdownCells = notebook.cells.filter(c => c.cell_type === 'markdown');

    const executedCells = codeCells.filter(c => c.execution_count !== null && c.execution_count !== undefined);
    const cellsWithErrors = codeCells.filter(c =>
      c.outputs?.some(o => o.output_type === 'error')
    );

    // Extract imports
    const imports: string[] = [];
    for (const cell of codeCells) {
      const content = cell.source.join('');
      const importMatches = content.match(/^(?:import|from)\s+[\w.]+/gm);
      if (importMatches) {
        imports.push(...importMatches);
      }
    }

    // Extract markdown headers
    const headers: string[] = [];
    for (const cell of markdownCells) {
      const content = cell.source.join('');
      const headerMatches = content.match(/^#+\s+.+$/gm);
      if (headerMatches) {
        headers.push(...headerMatches);
      }
    }

    const summary = [
      `# Notebook Summary: ${path.basename(filePath)}`,
      '',
      '## Statistics',
      `- Total cells: ${notebook.cells.length}`,
      `- Code cells: ${codeCells.length}`,
      `- Markdown cells: ${markdownCells.length}`,
      `- Executed cells: ${executedCells.length}`,
      `- Cells with errors: ${cellsWithErrors.length}`,
      '',
    ];

    if (imports.length > 0) {
      summary.push('## Imports');
      summary.push(...[...new Set(imports)].map(i => `- ${i}`));
      summary.push('');
    }

    if (headers.length > 0) {
      summary.push('## Structure');
      summary.push(...headers);
      summary.push('');
    }

    return { success: true, content: summary.join('\n') };
  }

  /**
   * Load notebook from file
   */
  private async loadNotebook(filePath: string): Promise<Notebook> {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Notebook;
  }

  /**
   * Save notebook to file
   */
  private async saveNotebook(filePath: string, notebook: Notebook): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(notebook, null, 1));
  }

  /**
   * Format output for display
   */
  private formatOutput(output: NotebookOutput): string {
    switch (output.output_type) {
      case 'stream':
        return output.text?.join('') || '';
      case 'execute_result':
      case 'display_data':
        if (output.data?.['text/plain']) {
          const text = output.data['text/plain'];
          return Array.isArray(text) ? text.join('') : String(text);
        }
        return '[Display data]';
      case 'error':
        return `❌ ${output.ename}: ${output.evalue}`;
      default:
        return '[Unknown output]';
    }
  }
}

// Singleton
let notebookToolInstance: NotebookTool | null = null;

export function getNotebookTool(): NotebookTool {
  if (!notebookToolInstance) {
    notebookToolInstance = new NotebookTool();
  }
  return notebookToolInstance;
}
