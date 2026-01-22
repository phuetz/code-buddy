/**
 * Type declarations for optional dependencies
 * These modules may or may not be installed
 */

// node-llama-cpp (optional)
declare module 'node-llama-cpp' {
  export class LlamaModel {
    constructor(options: { modelPath: string; gpuLayers?: number });
  }

  export class LlamaContext {
    constructor(options: { model: LlamaModel; contextSize?: number });
  }

  export class LlamaChatSession {
    constructor(options: { context: LlamaContext; systemPrompt?: string });
    prompt(
      message: string,
      options?: { maxTokens?: number; temperature?: number; onToken?: unknown }
    ): Promise<string>;
  }
}

// alasql (optional)
declare module 'alasql' {
  const alasql: {
    (sql: string, params?: unknown[]): unknown;
    promise(sql: string, params?: unknown[]): Promise<unknown>;
    tables: Record<string, unknown>;
  };
  export default alasql;
}

// adm-zip (optional)
declare module 'adm-zip' {
  interface ZipEntry {
    entryName: string;
    isDirectory: boolean;
    header: {
      size: number;
      compressedSize: number;
      time: Date;
    };
    getData(): Buffer;
  }
  class AdmZip {
    constructor(filePath?: string | Buffer);
    getEntries(): ZipEntry[];
    getEntry(name: string): ZipEntry | null;
    readAsText(entry: string | ZipEntry, encoding?: string): string;
    extractAllTo(targetPath: string, overwrite?: boolean): void;
    extractEntryTo(entryName: string, targetPath: string, maintainEntryPath?: boolean, overwrite?: boolean): boolean;
    addLocalFile(localPath: string, zipPath?: string, zipName?: string): void;
    addLocalFolder(localPath: string, zipPath?: string): void;
    writeZip(targetFileName?: string): void;
    toBuffer(): Buffer;
  }
  export default AdmZip;
}

// pdf-parse (optional)
declare module 'pdf-parse' {
  interface PdfData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PdfData>;
  export default pdfParse;
}

// xlsx (optional)
declare module 'xlsx' {
  interface Sheet {
    [key: string]: unknown;
  }
  interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, Sheet>;
  }
  function readFile(filename: string, options?: unknown): WorkBook;
  function read(data: Buffer | ArrayBuffer | string, options?: unknown): WorkBook;
  const utils: {
    sheet_to_json<T = unknown>(sheet: Sheet, options?: unknown): T[];
    json_to_sheet(data: unknown[], options?: unknown): Sheet;
    book_new(): WorkBook;
    book_append_sheet(workbook: WorkBook, sheet: Sheet, name: string): void;
  };
  function writeFile(workbook: WorkBook, filename: string, options?: unknown): void;
}

// @mlc-ai/web-llm (optional)
declare module '@mlc-ai/web-llm' {
  export class MLCEngine {
    reload(
      model: string,
      options?: { initProgressCallback?: (progress: { progress: number; text: string }) => void }
    ): Promise<void>;

    chat: {
      completions: {
        create(options: {
          messages: Array<{ role: string; content: string }>;
          max_tokens?: number;
          temperature?: number;
          stream?: boolean;
        }): Promise<{
          choices: Array<{
            message?: { content: string };
            delta?: { content?: string };
          }>;
          usage?: { total_tokens: number };
        }>;
      };
    };
  }
}
