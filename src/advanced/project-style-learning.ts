/**
 * Project Style Learning (Item 103)
 * Learns and adapts to project-specific coding style
 */

import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';

export interface StylePattern {
  category: 'naming' | 'formatting' | 'structure' | 'comments' | 'imports';
  pattern: string;
  examples: string[];
  frequency: number;
}

export interface ProjectStyle {
  projectPath: string;
  patterns: StylePattern[];
  preferences: Map<string, string>;
  analyzedFiles: number;
  lastAnalyzed: Date;
}

export class ProjectStyleLearner extends EventEmitter {
  private styles: Map<string, ProjectStyle> = new Map();

  async analyzeProject(projectPath: string): Promise<ProjectStyle> {
    const style: ProjectStyle = {
      projectPath,
      patterns: [],
      preferences: new Map(),
      analyzedFiles: 0,
      lastAnalyzed: new Date(),
    };

    const files = await this.findSourceFiles(projectPath);
    
    for (const file of files.slice(0, 100)) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        this.extractPatterns(content, style);
        style.analyzedFiles++;
      } catch {
        // Skip unreadable files
      }
    }

    this.styles.set(projectPath, style);
    this.emit('analysis-complete', style);
    return style;
  }

  private async findSourceFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go'];
    
    const walk = async (currentDir: string) => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await walk(fullPath);
          } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await walk(dir);
    return files;
  }

  private extractPatterns(content: string, style: ProjectStyle): void {
    // Detect naming conventions
    const camelCaseVars = content.match(/\b[a-z][a-zA-Z0-9]*\b/g) || [];
    const snakeCaseVars = content.match(/\b[a-z][a-z0-9_]*\b/g) || [];
    
    if (camelCaseVars.length > snakeCaseVars.length * 2) {
      style.preferences.set('naming', 'camelCase');
    } else if (snakeCaseVars.length > camelCaseVars.length * 2) {
      style.preferences.set('naming', 'snake_case');
    }

    // Detect quote style
    const singleQuotes = (content.match(/'/g) || []).length;
    const doubleQuotes = (content.match(/"/g) || []).length;
    style.preferences.set('quotes', singleQuotes > doubleQuotes ? 'single' : 'double');

    // Detect semicolon usage
    const semicolons = (content.match(/;\s*$/gm) || []).length;
    const noSemicolons = (content.match(/[^;]\s*$/gm) || []).length;
    style.preferences.set('semicolons', semicolons > noSemicolons ? 'always' : 'never');

    // Detect indentation
    const tabs = (content.match(/^\t/gm) || []).length;
    const spaces = (content.match(/^  /gm) || []).length;
    style.preferences.set('indent', tabs > spaces ? 'tabs' : 'spaces');
  }

  getStyle(projectPath: string): ProjectStyle | undefined {
    return this.styles.get(projectPath);
  }

  generateStyleGuide(projectPath: string): string {
    const style = this.styles.get(projectPath);
    if (!style) return 'No style analysis available';

    const lines: string[] = ['# Project Style Guide', ''];
    
    for (const [key, value] of style.preferences) {
      lines.push(`- **${key}**: ${value}`);
    }
    
    lines.push('', `Analyzed ${style.analyzedFiles} files on ${style.lastAnalyzed.toLocaleDateString()}`);
    return lines.join('\n');
  }

  applyStyleToCode(code: string, projectPath: string): string {
    const style = this.styles.get(projectPath);
    if (!style) return code;

    let result = code;

    if (style.preferences.get('quotes') === 'single') {
      result = result.replace(/"([^"\\]*)"/g, "'$1'");
    }

    if (style.preferences.get('semicolons') === 'never') {
      result = result.replace(/;(\s*)$/gm, '$1');
    }

    return result;
  }
}

let instance: ProjectStyleLearner | null = null;

export function getProjectStyleLearner(): ProjectStyleLearner {
  if (!instance) instance = new ProjectStyleLearner();
  return instance;
}

export default ProjectStyleLearner;
