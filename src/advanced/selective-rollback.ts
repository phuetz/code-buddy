/**
 * Selective File Rollback (Item 109)
 * Roll back individual files from checkpoints
 */

import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface FileVersion {
  id: string;
  path: string;
  content: string;
  hash: string;
  timestamp: Date;
  source: 'checkpoint' | 'git' | 'manual';
}

export interface RollbackResult {
  success: boolean;
  path: string;
  fromVersion: string;
  toVersion: string;
  error?: string;
}

export class SelectiveRollbackManager extends EventEmitter {
  private versions: Map<string, FileVersion[]> = new Map();
  private maxVersionsPerFile = 20;

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  }

  saveVersion(filePath: string, content: string, source: FileVersion['source'] = 'manual'): FileVersion {
    const normalized = path.normalize(filePath);
    const version: FileVersion = {
      id: crypto.randomBytes(6).toString('hex'),
      path: normalized,
      content,
      hash: this.computeHash(content),
      timestamp: new Date(),
      source,
    };

    const fileVersions = this.versions.get(normalized) || [];
    
    // Skip if content is same as latest
    if (fileVersions.length > 0 && fileVersions[0].hash === version.hash) {
      return fileVersions[0];
    }

    fileVersions.unshift(version);
    
    // Trim old versions
    if (fileVersions.length > this.maxVersionsPerFile) {
      fileVersions.pop();
    }

    this.versions.set(normalized, fileVersions);
    this.emit('version-saved', version);
    return version;
  }

  getVersions(filePath: string): FileVersion[] {
    return this.versions.get(path.normalize(filePath)) || [];
  }

  getVersion(filePath: string, versionId: string): FileVersion | undefined {
    const versions = this.getVersions(filePath);
    return versions.find(v => v.id === versionId);
  }

  async rollbackFile(filePath: string, versionId: string): Promise<RollbackResult> {
    const normalized = path.normalize(filePath);
    const version = this.getVersion(normalized, versionId);

    if (!version) {
      return { success: false, path: normalized, fromVersion: '', toVersion: versionId, error: 'Version not found' };
    }

    try {
      // Save current state before rollback
      if (await fs.pathExists(normalized)) {
        const currentContent = await fs.readFile(normalized, 'utf-8');
        this.saveVersion(normalized, currentContent, 'manual');
      }

      // Perform rollback
      await fs.ensureDir(path.dirname(normalized));
      await fs.writeFile(normalized, version.content, 'utf-8');

      this.emit('file-rolled-back', { path: normalized, versionId });
      
      return { success: true, path: normalized, fromVersion: 'current', toVersion: versionId };
    } catch (error) {
      return { success: false, path: normalized, fromVersion: '', toVersion: versionId, error: String(error) };
    }
  }

  async rollbackMultiple(files: Array<{ path: string; versionId: string }>): Promise<RollbackResult[]> {
    const results: RollbackResult[] = [];
    for (const file of files) {
      results.push(await this.rollbackFile(file.path, file.versionId));
    }
    return results;
  }

  compareVersions(filePath: string, versionId1: string, versionId2: string): { added: number; removed: number; changed: number } | null {
    const v1 = this.getVersion(filePath, versionId1);
    const v2 = this.getVersion(filePath, versionId2);

    if (!v1 || !v2) return null;

    const lines1 = v1.content.split('\n');
    const lines2 = v2.content.split('\n');

    let added = 0, removed = 0, changed = 0;
    const maxLen = Math.max(lines1.length, lines2.length);

    for (let i = 0; i < maxLen; i++) {
      if (i >= lines1.length) added++;
      else if (i >= lines2.length) removed++;
      else if (lines1[i] !== lines2[i]) changed++;
    }

    return { added, removed, changed };
  }

  getLatestVersion(filePath: string): FileVersion | undefined {
    const versions = this.getVersions(filePath);
    return versions[0];
  }

  clearVersions(filePath: string): void {
    this.versions.delete(path.normalize(filePath));
    this.emit('versions-cleared', filePath);
  }

  getAllTrackedFiles(): string[] {
    return Array.from(this.versions.keys());
  }

  getStats(): { totalFiles: number; totalVersions: number } {
    let totalVersions = 0;
    for (const versions of this.versions.values()) {
      totalVersions += versions.length;
    }
    return { totalFiles: this.versions.size, totalVersions };
  }
}

let instance: SelectiveRollbackManager | null = null;
export function getSelectiveRollbackManager(): SelectiveRollbackManager {
  if (!instance) instance = new SelectiveRollbackManager();
  return instance;
}
export default SelectiveRollbackManager;
