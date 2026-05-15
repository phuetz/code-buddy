/**
 * Jupyter Notebook Tool
 *
 * Read, analyze, and edit Jupyter notebooks (.ipynb files).
 * Supports cell manipulation, execution output parsing, and code extraction.
 */

import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '../types/index.js';
import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export const NOTEBOOK_CELL_COMPLETED_WITH_NO_OUTPUT = 'Cell completed successfully with no output.';

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
  private vfs = UnifiedVfsRouter.Instance;

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'read_cell', 'add_cell', 'update_cell', 'delete_cell', 'extract_code', 'summarize', 'execute_cell', 'execute_all', 'kernel_start', 'kernel_stop'],
        description: 'Action to perform on the notebook. execute_cell/execute_all use jupyter nbconvert --execute.',
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
      kernelName: {
        type: 'string',
        description: 'Kernel name for execution (default: python3)',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in seconds (default: 120)',
      },
    },
    required: ['action', 'path'],
  };

  /**
   * Execute the notebook tool
   */
  async execute(params: {
    action: 'read' | 'read_cell' | 'add_cell' | 'update_cell' | 'delete_cell' | 'extract_code' | 'summarize' | 'execute_cell' | 'execute_all' | 'kernel_start' | 'kernel_stop';
    path: string;
    cellIndex?: number;
    cellType?: 'code' | 'markdown' | 'raw';
    content?: string;
    kernelName?: string;
    timeout?: number;
  }): Promise<ToolResult> {
    try {
      const { action, path: filePath } = params;

      switch (action) {
        case 'read':
          return this.readNotebook(filePath);
        case 'read_cell':
          if (params.cellIndex == null) return { success: false, error: 'cellIndex is required for read_cell' };
          return this.readCell(filePath, params.cellIndex);
        case 'add_cell':
          return this.addCell(filePath, params.cellType || 'code', params.content || '');
        case 'update_cell':
          if (params.cellIndex == null) return { success: false, error: 'cellIndex is required for update_cell' };
          return this.updateCell(filePath, params.cellIndex, params.content || '');
        case 'delete_cell':
          if (params.cellIndex == null) return { success: false, error: 'cellIndex is required for delete_cell' };
          return this.deleteCell(filePath, params.cellIndex);
        case 'extract_code':
          return this.extractCode(filePath);
        case 'summarize':
          return this.summarize(filePath);
        case 'execute_cell':
          if (params.cellIndex == null) return { success: false, error: 'cellIndex is required for execute_cell' };
          return this.executeCell(filePath, params.cellIndex, params.kernelName, params.timeout);
        case 'execute_all':
          return this.executeAll(filePath, params.kernelName, params.timeout);
        case 'kernel_start':
          return this.kernelStart(params.kernelName);
        case 'kernel_stop':
          return this.kernelStop();
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
    const cellsWithErrors = codeCells.filter(c => this.hasErrorOutput(c));

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

  // ==========================================================================
  // Jupyter Kernel Execution
  // ==========================================================================

  /** Track whether jupyter is available */
  private jupyterAvailable: boolean | null = null;
  /** Active kernel process (for kernel_start/kernel_stop lifecycle) */
  private kernelProcess: import('child_process').ChildProcess | null = null;

  private async waitForKernelStartup(
    proc: import('child_process').ChildProcess,
    timeoutMs = 3000,
  ): Promise<{ started: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      let output = '';
      let settled = false;

      const cleanup = () => {
        proc.stderr?.removeListener('data', onData);
        proc.stdout?.removeListener('data', onData);
        proc.removeListener?.('error', onError);
        proc.removeListener?.('exit', onExit);
        proc.removeListener?.('close', onClose);
      };
      const finish = (result: { started: boolean; output: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(result);
      };
      const onData = (data: Buffer) => {
        output += data.toString();
      };
      const onError = (err: Error) => {
        finish({ started: false, output, error: err.message });
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        finish({
          started: false,
          output,
          error: `kernel process exited during startup (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        });
      };
      const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
        finish({
          started: false,
          output,
          error: `kernel process closed during startup (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        });
      };
      const timer = setTimeout(() => {
        if (proc.exitCode !== null && proc.exitCode !== undefined) {
          finish({
            started: false,
            output,
            error: `kernel process exited during startup (code=${proc.exitCode})`,
          });
          return;
        }
        finish({ started: true, output });
      }, timeoutMs);

      proc.stderr?.on('data', onData);
      proc.stdout?.on('data', onData);
      proc.on('error', onError);
      proc.on('exit', onExit);
      proc.on('close', onClose);
    });
  }

  /**
   * Check if jupyter is available on the system
   */
  private async checkJupyterAvailable(): Promise<boolean> {
    if (this.jupyterAvailable !== null) return this.jupyterAvailable;
    try {
      await execFileAsync('jupyter', ['--version'], { timeout: 10000 });
      this.jupyterAvailable = true;
    } catch {
      this.jupyterAvailable = false;
    }
    return this.jupyterAvailable;
  }

  /**
   * Execute a single cell by index.
   *
   * Strategy: Create a temporary notebook with only the target cell,
   * run `jupyter nbconvert --execute`, then read back the outputs.
   */
  private async executeCell(
    filePath: string,
    cellIndex: number,
    kernelName?: string,
    timeout?: number,
  ): Promise<ToolResult> {
    if (!await this.checkJupyterAvailable()) {
      return { success: false, error: 'jupyter is not installed or not in PATH. Install with: pip install jupyter' };
    }

    const notebook = await this.loadNotebook(filePath);
    if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
      return { success: false, error: `Cell index ${cellIndex} out of range (0-${notebook.cells.length - 1})` };
    }

    const cell = notebook.cells[cellIndex];
    if (cell.cell_type !== 'code') {
      return { success: false, error: `Cell ${cellIndex} is a ${cell.cell_type} cell, not a code cell` };
    }

    // Create a temporary notebook with just this cell
    const tempNotebook: Notebook = {
      nbformat: notebook.nbformat,
      nbformat_minor: notebook.nbformat_minor,
      metadata: { ...notebook.metadata },
      cells: [{ ...cell, outputs: [], execution_count: null }],
    };

    const resolvedPath = path.resolve(filePath);
    const tempPath = resolvedPath.replace(/\.ipynb$/, `.exec_cell_${cellIndex}.tmp.ipynb`);

    try {
      await this.vfs.writeFile(tempPath, JSON.stringify(tempNotebook, null, 1));

      const args = [
        'nbconvert',
        '--to', 'notebook',
        '--execute',
        '--ExecutePreprocessor.timeout=' + String(timeout || 120),
        '--ExecutePreprocessor.kernel_name=' + (kernelName || 'python3'),
        '--output', path.basename(tempPath),
        tempPath,
      ];

      const { stderr } = await execFileAsync('jupyter', args, {
        timeout: ((timeout || 120) + 30) * 1000,
        cwd: path.dirname(resolvedPath),
      });

      if (stderr) {
        logger.debug(`jupyter nbconvert stderr: ${stderr}`);
      }

      // Read back the executed notebook
      const executedContent = await this.vfs.readFile(tempPath, 'utf-8');
      const executedNotebook = JSON.parse(executedContent) as Notebook;
      const executedCell = executedNotebook.cells[0];

      // Update the original notebook's cell with outputs
      notebook.cells[cellIndex].outputs = executedCell.outputs || [];
      notebook.cells[cellIndex].execution_count = executedCell.execution_count;
      await this.saveNotebook(filePath, notebook);

      // Format output
      const cellHasErrors = this.hasErrorOutput(executedCell);
      const parts = [
        `## Cell ${cellIndex} executed ${cellHasErrors ? 'with errors' : 'successfully'}`,
        '',
      ];
      if (executedCell.outputs && executedCell.outputs.length > 0) {
        parts.push('**Output:**');
        for (const output of executedCell.outputs) {
          parts.push(this.formatOutput(output));
        }
      } else {
        parts.push(NOTEBOOK_CELL_COMPLETED_WITH_NO_OUTPUT);
      }

      const result = parts.join('\n');
      if (cellHasErrors) {
        return { success: false, error: result };
      }

      return { success: true, content: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to execute cell ${cellIndex}: ${message}` };
    } finally {
      // Clean up temp file
      try {
        const tempFs = await import('fs');
        if (tempFs.existsSync(tempPath)) {
          tempFs.unlinkSync(tempPath);
        }
      } catch { /* ignore cleanup errors */ }
    }
  }

  /**
   * Execute all cells in the notebook using `jupyter nbconvert --execute`.
   */
  private async executeAll(
    filePath: string,
    kernelName?: string,
    timeout?: number,
  ): Promise<ToolResult> {
    if (!await this.checkJupyterAvailable()) {
      return { success: false, error: 'jupyter is not installed or not in PATH. Install with: pip install jupyter' };
    }

    const resolvedPath = path.resolve(filePath);
    const outputName = path.basename(resolvedPath);

    try {
      const args = [
        'nbconvert',
        '--to', 'notebook',
        '--execute',
        '--inplace',
        '--ExecutePreprocessor.timeout=' + String(timeout || 120),
        '--ExecutePreprocessor.kernel_name=' + (kernelName || 'python3'),
        resolvedPath,
      ];

      const { stderr } = await execFileAsync('jupyter', args, {
        timeout: ((timeout || 120) + 30) * 1000,
        cwd: path.dirname(resolvedPath),
      });

      if (stderr) {
        logger.debug(`jupyter nbconvert stderr: ${stderr}`);
      }

      // Read back the executed notebook to get outputs
      const executedNotebook = await this.loadNotebook(filePath);
      const codeCells = executedNotebook.cells.filter(c => c.cell_type === 'code');
      const cellsWithOutput = codeCells.filter(c => c.outputs && c.outputs.length > 0);
      const cellsWithErrors = codeCells.filter(c => this.hasErrorOutput(c));

      const parts = [
        `# Executed all cells in ${outputName}`,
        '',
        `- Total cells: ${executedNotebook.cells.length}`,
        `- Code cells: ${codeCells.length}`,
        `- Cells with output: ${cellsWithOutput.length}`,
        `- Cells with errors: ${cellsWithErrors.length}`,
        '',
      ];

      // Show outputs for each code cell
      for (let i = 0; i < executedNotebook.cells.length; i++) {
        const cell = executedNotebook.cells[i];
        if (cell.cell_type !== 'code') continue;

        parts.push(`## Cell ${i} [${cell.execution_count ?? '?'}]`);
        if (cell.outputs && cell.outputs.length > 0) {
          for (const output of cell.outputs) {
            parts.push(this.formatOutput(output));
          }
        } else {
          parts.push(NOTEBOOK_CELL_COMPLETED_WITH_NO_OUTPUT);
        }
        parts.push('');
      }

      const result = parts.join('\n');
      if (cellsWithErrors.length > 0) {
        return { success: false, error: result };
      }

      return { success: true, content: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to execute notebook: ${message}` };
    }
  }

  /**
   * Start a Jupyter kernel (lifecycle management).
   * Uses `jupyter kernel` subprocess.
   */
  private async kernelStart(kernelName?: string): Promise<ToolResult> {
    if (!await this.checkJupyterAvailable()) {
      return { success: false, error: 'jupyter is not installed or not in PATH. Install with: pip install jupyter' };
    }

    if (this.kernelProcess && !this.kernelProcess.killed) {
      return { success: true, content: 'Kernel is already running. Use kernel_stop first to restart.' };
    }

    try {
      const { spawn } = await import('child_process');
      const kernel = kernelName || 'python3';

      this.kernelProcess = spawn('jupyter', ['kernel', `--KernelManager.kernel_name=${kernel}`], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const startup = await this.waitForKernelStartup(this.kernelProcess);
      if (!startup.started) {
        this.kernelProcess = null;
        return {
          success: false,
          error: `Failed to start kernel "${kernel}": ${startup.error ?? 'process ended before readiness check completed'}${startup.output.trim() ? `\n${startup.output.trim()}` : ''}`,
        };
      }

      logger.info('Jupyter kernel started', { kernel, pid: this.kernelProcess.pid });

      return {
        success: true,
        content: `Jupyter kernel "${kernel}" started (PID: ${this.kernelProcess.pid})\n${startup.output.trim()}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to start kernel: ${message}` };
    }
  }

  /**
   * Stop the running Jupyter kernel.
   */
  private async kernelStop(): Promise<ToolResult> {
    if (!this.kernelProcess || this.kernelProcess.killed) {
      return { success: true, content: 'No kernel is running.' };
    }

    const pid = this.kernelProcess.pid;
    this.kernelProcess.kill('SIGTERM');

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.kernelProcess && !this.kernelProcess.killed) {
          this.kernelProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.kernelProcess!.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.kernelProcess = null;
    logger.info('Jupyter kernel stopped', { pid });

    return { success: true, content: `Kernel (PID: ${pid}) stopped.` };
  }

  /**
   * Load notebook from file
   */
  private async loadNotebook(filePath: string): Promise<Notebook> {
    const content = await this.vfs.readFile(filePath, 'utf-8');
    try {
      const notebook = JSON.parse(content);
      if (!notebook || typeof notebook !== 'object' || !Array.isArray(notebook.cells)) {
        throw new Error('Invalid notebook format: expected object with cells array');
      }
      return notebook as Notebook;
    } catch (error) {
      throw new Error(`Failed to parse notebook ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save notebook to file
   */
  private async saveNotebook(filePath: string, notebook: Notebook): Promise<void> {
    await this.vfs.writeFile(filePath, JSON.stringify(notebook, null, 1));
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

  private hasErrorOutput(cell: NotebookCell): boolean {
    return cell.outputs?.some(o => o.output_type === 'error') ?? false;
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
