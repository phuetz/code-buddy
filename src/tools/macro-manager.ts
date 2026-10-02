import * as path from 'path';
import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import type { ComputerControlInput } from './computer-control-tool.js';

export interface MacroDefinition {
  name: string;
  description?: string;
  steps: ComputerControlInput[];
  createdAt: number;
}

export class MacroManager {
  private static instance: MacroManager | null = null;
  private readonly macrosDir = path.join(process.cwd(), '.codebuddy', 'macros');
  private vfs = UnifiedVfsRouter.Instance;

  private constructor() {}

  static getInstance(): MacroManager {
    if (!MacroManager.instance) {
      MacroManager.instance = new MacroManager();
    }
    return MacroManager.instance;
  }

  async ensureDir(): Promise<void> {
    await this.vfs.ensureDir(this.macrosDir);
  }

  private getMacroPath(name: string): string {
    const safeName = name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    return path.join(this.macrosDir, `${safeName}.json`);
  }

  async saveMacro(name: string, steps: ComputerControlInput[], description?: string): Promise<void> {
    await this.ensureDir();
    const macroPath = this.getMacroPath(name);
    
    const macro: MacroDefinition = {
      name,
      description,
      steps,
      createdAt: Date.now()
    };

    await this.vfs.writeFile(macroPath, JSON.stringify(macro, null, 2), 'utf-8');
  }

  async loadMacro(name: string): Promise<MacroDefinition | null> {
    await this.ensureDir();
    const macroPath = this.getMacroPath(name);
    
    if (!(await this.vfs.exists(macroPath))) {
      return null;
    }

    try {
      const content = await this.vfs.readFile(macroPath, 'utf-8');
      return JSON.parse(content) as MacroDefinition;
    } catch (e) {
      console.error(`Failed to load macro ${name}`, e);
      return null;
    }
  }

  async listMacros(): Promise<MacroDefinition[]> {
    if (!(await this.vfs.exists(this.macrosDir))) return [];
    const files = await this.vfs.readdir(this.macrosDir);
    const macros: MacroDefinition[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const macroPath = path.join(this.macrosDir, file);
        try {
          const content = await this.vfs.readFile(macroPath, 'utf-8');
          macros.push(JSON.parse(content) as MacroDefinition);
        } catch (e) {
          console.error(`Failed to read macro file ${file}`, e);
        }
      }
    }

    return macros.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteMacro(name: string): Promise<boolean> {
    await this.ensureDir();
    const macroPath = this.getMacroPath(name);
    if (await this.vfs.exists(macroPath)) {
      await this.vfs.remove(macroPath);
      return true;
    }
    return false;
  }
}
