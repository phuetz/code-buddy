import { EventEmitter } from 'events';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  type: 'channel' | 'tool' | 'provider' | 'integration';
  entryPoint: string;
  configSchema?: Record<string, { type: string; required?: boolean; default?: unknown; description?: string }>;
  dependencies?: string[];
}

export interface ExtensionInstance {
  manifest: ExtensionManifest;
  path: string;
  status: 'loaded' | 'active' | 'error' | 'disabled';
  error?: string;
  loadedAt?: number;
}

export interface ExtensionLifecycle {
  onLoad?(): Promise<void>;
  onActivate?(config: Record<string, unknown>): Promise<void>;
  onDeactivate?(): Promise<void>;
  onDispose?(): Promise<void>;
}

const REQUIRED_MANIFEST_FIELDS: (keyof ExtensionManifest)[] = ['name', 'version', 'type', 'entryPoint'];
const VALID_TYPES: ExtensionManifest['type'][] = ['channel', 'tool', 'provider', 'integration'];

export class ExtensionLoader extends EventEmitter {
  private extensions: Map<string, ExtensionInstance> = new Map();
  private lifecycles: Map<string, ExtensionLifecycle> = new Map();
  private searchPaths: string[];

  constructor(searchPaths?: string[]) {
    super();
    this.searchPaths = searchPaths || [
      join(process.cwd(), '.codebuddy', 'extensions'),
      join(process.env.HOME || '~', '.codebuddy', 'extensions'),
    ];
  }

  static parseManifest(dir: string): ExtensionManifest | null {
    const manifestPath = join(dir, 'extension.json');
    if (!existsSync(manifestPath)) {
      return null;
    }
    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      for (const field of REQUIRED_MANIFEST_FIELDS) {
        if (!parsed[field]) {
          return null;
        }
      }

      if (!VALID_TYPES.includes(parsed['type'] as ExtensionManifest['type'])) {
        return null;
      }

      return parsed as unknown as ExtensionManifest;
    } catch {
      return null;
    }
  }

  discover(): ExtensionManifest[] {
    const manifests: ExtensionManifest[] = [];
    for (const searchPath of this.searchPaths) {
      if (!existsSync(searchPath)) {
        continue;
      }
      let entries: string[];
      try {
        entries = readdirSync(searchPath, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const dir = join(searchPath, entry);
        const manifest = ExtensionLoader.parseManifest(dir);
        if (manifest) {
          manifests.push(manifest);
        }
      }
    }
    return manifests;
  }

  load(name: string): ExtensionInstance | { error: string } {
    for (const searchPath of this.searchPaths) {
      const dir = join(searchPath, name);
      const manifest = ExtensionLoader.parseManifest(dir);
      if (manifest) {
        const instance: ExtensionInstance = {
          manifest,
          path: dir,
          status: 'loaded',
          loadedAt: Date.now(),
        };
        this.extensions.set(manifest.name, instance);
        this.emit('loaded', instance);
        return instance;
      }
    }
    return { error: `Extension "${name}" not found in search paths` };
  }

  loadAll(): ExtensionInstance[] {
    const manifests = this.discover();
    const instances: ExtensionInstance[] = [];
    for (const manifest of manifests) {
      const result = this.load(manifest.name);
      if ('status' in result) {
        instances.push(result);
      }
    }
    return instances;
  }

  async activate(name: string, config?: Record<string, unknown>): Promise<boolean> {
    const instance = this.extensions.get(name);
    if (!instance) {
      return false;
    }

    if (config) {
      const validation = this.validateConfig(name, config);
      if (!validation.valid) {
        instance.status = 'error';
        instance.error = validation.errors.join('; ');
        return false;
      }
    }

    const deps = this.checkDependencies(name);
    if (!deps.satisfied) {
      instance.status = 'error';
      instance.error = `Missing dependencies: ${deps.missing.join(', ')}`;
      return false;
    }

    const lifecycle = this.lifecycles.get(name);
    try {
      if (lifecycle?.onActivate) {
        await lifecycle.onActivate(config || {});
      }
      instance.status = 'active';
      this.emit('activated', instance);
      return true;
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  async deactivate(name: string): Promise<boolean> {
    const instance = this.extensions.get(name);
    if (!instance) {
      return false;
    }

    const lifecycle = this.lifecycles.get(name);
    try {
      if (lifecycle?.onDeactivate) {
        await lifecycle.onDeactivate();
      }
      instance.status = 'disabled';
      this.emit('deactivated', instance);
      return true;
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  get(name: string): ExtensionInstance | undefined {
    return this.extensions.get(name);
  }

  list(type?: ExtensionManifest['type']): ExtensionInstance[] {
    const all = Array.from(this.extensions.values());
    if (type) {
      return all.filter(ext => ext.manifest.type === type);
    }
    return all;
  }

  validateConfig(name: string, config: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const instance = this.extensions.get(name);
    if (!instance) {
      return { valid: false, errors: [`Extension "${name}" not found`] };
    }

    const schema = instance.manifest.configSchema;
    if (!schema) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];
    for (const [key, def] of Object.entries(schema)) {
      const value = config[key];
      if (def.required && value === undefined) {
        errors.push(`Missing required config field: ${key}`);
        continue;
      }
      if (value !== undefined && typeof value !== def.type) {
        errors.push(`Field "${key}" expected type "${def.type}", got "${typeof value}"`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  checkDependencies(name: string): { satisfied: boolean; missing: string[] } {
    const instance = this.extensions.get(name);
    if (!instance) {
      return { satisfied: false, missing: [] };
    }

    const deps = instance.manifest.dependencies || [];
    const missing = deps.filter(dep => !this.extensions.has(dep));
    return { satisfied: missing.length === 0, missing };
  }

  async dispose(): Promise<void> {
    const names = Array.from(this.extensions.keys());
    for (const name of names) {
      const lifecycle = this.lifecycles.get(name);
      try {
        if (lifecycle?.onDispose) {
          await lifecycle.onDispose();
        }
      } catch {
        // best-effort cleanup
      }
    }
    this.extensions.clear();
    this.lifecycles.clear();
    this.emit('disposed');
  }
}
