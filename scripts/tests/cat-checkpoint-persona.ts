/**
 * Cat 51: Checkpoint Manager (7 tests, no API)
 * Cat 52: Persona Manager (7 tests, no API)
 * Cat 53: Conversation Exporter (5 tests, no API)
 */

import type { TestDef } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Cat 51: Checkpoint Manager
// ============================================================================

export function cat51CheckpointManager(): TestDef[] {
  return [
    {
      name: '51.1-create-checkpoint',
      timeout: 5000,
      fn: async () => {
        const { CheckpointManager } = await import('../../src/checkpoints/checkpoint-manager.js');
        const mgr = new CheckpointManager({ maxCheckpoints: 10 });
        const cp = mgr.createCheckpoint('test checkpoint');
        return {
          pass: cp.id !== undefined && cp.description === 'test checkpoint' && cp.files.length === 0,
          metadata: { id: cp.id, desc: cp.description },
        };
      },
    },
    {
      name: '51.2-checkpoint-max-limit',
      timeout: 5000,
      fn: async () => {
        const { CheckpointManager } = await import('../../src/checkpoints/checkpoint-manager.js');
        const mgr = new CheckpointManager({ maxCheckpoints: 3 });
        mgr.createCheckpoint('cp1');
        mgr.createCheckpoint('cp2');
        mgr.createCheckpoint('cp3');
        mgr.createCheckpoint('cp4');
        const all = mgr.getCheckpoints();
        return {
          pass: all.length === 3,
          metadata: { count: all.length },
        };
      },
    },
    {
      name: '51.3-checkpoint-before-edit',
      timeout: 5000,
      fn: async () => {
        const { CheckpointManager } = await import('../../src/checkpoints/checkpoint-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-cp-test-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const testFile = path.join(tmp, 'test.txt');
        fs.writeFileSync(testFile, 'original content');

        const mgr = new CheckpointManager({ maxCheckpoints: 10 });
        const cp = mgr.checkpointBeforeEdit(testFile);
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: cp.description.includes('Before editing') && cp.files.length >= 0,
          metadata: { desc: cp.description },
        };
      },
    },
    {
      name: '51.4-checkpoint-before-create',
      timeout: 5000,
      fn: async () => {
        const { CheckpointManager } = await import('../../src/checkpoints/checkpoint-manager.js');
        const mgr = new CheckpointManager();
        const cp = mgr.checkpointBeforeCreate('/tmp/nonexistent-file.txt');
        return {
          pass: cp.description.includes('Before creating'),
          metadata: { desc: cp.description },
        };
      },
    },
    {
      name: '51.5-rewind-to-checkpoint',
      timeout: 5000,
      fn: async () => {
        const { CheckpointManager } = await import('../../src/checkpoints/checkpoint-manager.js');
        const tmp = path.join(os.tmpdir(), `cb-cp-rewind-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const testFile = path.join(tmp, 'rewind.txt');
        fs.writeFileSync(testFile, 'version 1');

        const mgr = new CheckpointManager();
        const cp = mgr.createCheckpoint('before change', [testFile]);
        fs.writeFileSync(testFile, 'version 2');

        const result = mgr.rewindTo(cp.id);
        const content = fs.readFileSync(testFile, 'utf-8');
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: result.success && content === 'version 1',
          metadata: { restored: result.restored.length },
        };
      },
    },
    {
      name: '51.6-rewind-nonexistent-fails',
      timeout: 5000,
      fn: async () => {
        const { CheckpointManager } = await import('../../src/checkpoints/checkpoint-manager.js');
        const mgr = new CheckpointManager();
        const result = mgr.rewindTo('nonexistent-id');
        return {
          pass: result.success === false && result.errors.length > 0,
          metadata: { errors: result.errors },
        };
      },
    },
    {
      name: '51.7-checkpoint-event-emitted',
      timeout: 5000,
      fn: async () => {
        const { CheckpointManager } = await import('../../src/checkpoints/checkpoint-manager.js');
        const mgr = new CheckpointManager();
        let emitted = false;
        mgr.on('checkpoint-created', () => { emitted = true; });
        mgr.createCheckpoint('event test');
        return { pass: emitted };
      },
    },
  ];
}

// ============================================================================
// Cat 52: Persona Manager
// ============================================================================

export function cat52PersonaManager(): TestDef[] {
  return [
    {
      name: '52.1-builtin-personas-loaded',
      timeout: 5000,
      fn: async () => {
        const { PersonaManager } = await import('../../src/personas/persona-manager.js');
        const mgr = new PersonaManager({
          customPersonasDir: path.join(os.tmpdir(), `cb-persona-${Date.now()}`),
        });
        // Give time for async initialize
        await new Promise(r => setTimeout(r, 100));
        const all = mgr.getAllPersonas();
        return {
          pass: all.length >= 4,
          metadata: { count: all.length, names: all.map(p => p.name) },
        };
      },
    },
    {
      name: '52.2-get-persona-by-id',
      timeout: 5000,
      fn: async () => {
        const { PersonaManager } = await import('../../src/personas/persona-manager.js');
        const mgr = new PersonaManager({
          customPersonasDir: path.join(os.tmpdir(), `cb-persona-${Date.now()}`),
        });
        await new Promise(r => setTimeout(r, 100));
        const persona = mgr.getPersona('default');
        return {
          pass: persona !== undefined && persona.name === 'Default Assistant',
          metadata: { name: persona?.name },
        };
      },
    },
    {
      name: '52.3-set-active-persona',
      timeout: 5000,
      fn: async () => {
        const { PersonaManager } = await import('../../src/personas/persona-manager.js');
        const mgr = new PersonaManager({
          customPersonasDir: path.join(os.tmpdir(), `cb-persona-${Date.now()}`),
        });
        await new Promise(r => setTimeout(r, 100));
        const result = mgr.setActivePersona('senior-developer');
        const active = mgr.getActivePersona();
        return {
          pass: result === true && active?.id === 'senior-developer',
          metadata: { activeId: active?.id },
        };
      },
    },
    {
      name: '52.4-nonexistent-persona-fails',
      timeout: 5000,
      fn: async () => {
        const { PersonaManager } = await import('../../src/personas/persona-manager.js');
        const mgr = new PersonaManager({
          customPersonasDir: path.join(os.tmpdir(), `cb-persona-${Date.now()}`),
        });
        await new Promise(r => setTimeout(r, 100));
        const result = mgr.setActivePersona('nonexistent-persona-xyz');
        return { pass: result === false };
      },
    },
    {
      name: '52.5-builtin-vs-custom',
      timeout: 5000,
      fn: async () => {
        const { PersonaManager } = await import('../../src/personas/persona-manager.js');
        const mgr = new PersonaManager({
          customPersonasDir: path.join(os.tmpdir(), `cb-persona-${Date.now()}`),
        });
        await new Promise(r => setTimeout(r, 100));
        const builtins = mgr.getBuiltinPersonas();
        const customs = mgr.getCustomPersonas();
        return {
          pass: builtins.length >= 4 && builtins.every(p => p.isBuiltin) && customs.length === 0,
          metadata: { builtinCount: builtins.length, customCount: customs.length },
        };
      },
    },
    {
      name: '52.6-build-system-prompt',
      timeout: 5000,
      fn: async () => {
        const { PersonaManager } = await import('../../src/personas/persona-manager.js');
        const mgr = new PersonaManager({
          customPersonasDir: path.join(os.tmpdir(), `cb-persona-${Date.now()}`),
        });
        await new Promise(r => setTimeout(r, 100));
        const prompt = mgr.buildSystemPrompt('additional context here');
        return {
          pass: typeof prompt === 'string' && prompt.length > 0,
          metadata: { promptLen: prompt.length, preview: prompt.substring(0, 150) },
        };
      },
    },
    {
      name: '52.7-format-status',
      timeout: 5000,
      fn: async () => {
        const { PersonaManager } = await import('../../src/personas/persona-manager.js');
        const mgr = new PersonaManager({
          customPersonasDir: path.join(os.tmpdir(), `cb-persona-${Date.now()}`),
        });
        await new Promise(r => setTimeout(r, 100));
        const status = mgr.formatStatus();
        return {
          pass: typeof status === 'string' && status.length > 0,
          metadata: { preview: status.substring(0, 150) },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 53: Conversation Exporter
// ============================================================================

export function cat53ConversationExporter(): TestDef[] {
  return [
    {
      name: '53.1-exporter-instantiation',
      timeout: 5000,
      fn: async () => {
        const { ConversationExporter } = await import('../../src/utils/conversation-export.js');
        const tmp = path.join(os.tmpdir(), `cb-export-${Date.now()}`);
        const exporter = new ConversationExporter(tmp);
        const exists = fs.existsSync(tmp);
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: exporter !== undefined && exists,
        };
      },
    },
    {
      name: '53.2-export-markdown',
      timeout: 5000,
      fn: async () => {
        const { ConversationExporter } = await import('../../src/utils/conversation-export.js');
        const tmp = path.join(os.tmpdir(), `cb-export-${Date.now()}`);
        const exporter = new ConversationExporter(tmp);
        const entries = [
          { type: 'user' as const, content: 'Hello world', timestamp: new Date() },
          { type: 'assistant' as const, content: 'Hi there!', timestamp: new Date() },
        ];
        const result = exporter.export(entries, { format: 'markdown' });
        const exists = result.filePath ? fs.existsSync(result.filePath) : false;
        const content = exists && result.filePath ? fs.readFileSync(result.filePath, 'utf-8') : '';
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: result.success && content.includes('Hello world'),
          metadata: { path: result.filePath, contentLen: content.length },
        };
      },
    },
    {
      name: '53.3-export-json',
      timeout: 5000,
      fn: async () => {
        const { ConversationExporter } = await import('../../src/utils/conversation-export.js');
        const tmp = path.join(os.tmpdir(), `cb-export-${Date.now()}`);
        const exporter = new ConversationExporter(tmp);
        const entries = [
          { type: 'user' as const, content: 'Test question', timestamp: new Date() },
        ];
        const result = exporter.export(entries, { format: 'json' });
        const content = result.filePath && fs.existsSync(result.filePath) ? fs.readFileSync(result.filePath, 'utf-8') : '{}';
        let parsed: any;
        try { parsed = JSON.parse(content); } catch { parsed = null; }
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: result.success && parsed !== null,
          metadata: { path: result.filePath },
        };
      },
    },
    {
      name: '53.4-export-text',
      timeout: 5000,
      fn: async () => {
        const { ConversationExporter } = await import('../../src/utils/conversation-export.js');
        const tmp = path.join(os.tmpdir(), `cb-export-${Date.now()}`);
        const exporter = new ConversationExporter(tmp);
        const entries = [
          { type: 'user' as const, content: 'Plain text test', timestamp: new Date() },
        ];
        const result = exporter.export(entries, { format: 'text' });
        const content = result.filePath && fs.existsSync(result.filePath) ? fs.readFileSync(result.filePath, 'utf-8') : '';
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: result.success && content.includes('Plain text test'),
          metadata: { contentLen: content.length },
        };
      },
    },
    {
      name: '53.5-empty-conversation',
      timeout: 5000,
      fn: async () => {
        const { ConversationExporter } = await import('../../src/utils/conversation-export.js');
        const tmp = path.join(os.tmpdir(), `cb-export-${Date.now()}`);
        const exporter = new ConversationExporter(tmp);
        const result = exporter.export([], { format: 'markdown' });
        const exists = result.filePath ? fs.existsSync(result.filePath) : false;
        fs.rmSync(tmp, { recursive: true, force: true });
        return {
          pass: result.success && exists,
          metadata: { path: result.filePath },
        };
      },
    },
  ];
}
