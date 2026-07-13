import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DatabaseInstance,
  MessageRow,
  ProjectRow,
  SessionRow,
} from '../src/main/db/database';
import {
  ProjectEvolutionService,
  type ProjectEvolutionRepository,
} from '../src/main/project/project-evolution';
import { ProjectManager } from '../src/main/project/project-manager';
import type { ProjectEvolutionProposal } from '../src/shared/project-evolution';

class MemoryProposalRepository implements ProjectEvolutionRepository {
  readonly proposals = new Map<string, ProjectEvolutionProposal>();

  save(proposal: ProjectEvolutionProposal): void {
    this.proposals.set(proposal.id, structuredClone(proposal));
  }

  get(id: string): ProjectEvolutionProposal | null {
    const proposal = this.proposals.get(id);
    return proposal ? structuredClone(proposal) : null;
  }

  list(projectId: string): ProjectEvolutionProposal[] {
    return [...this.proposals.values()]
      .filter((proposal) => proposal.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((proposal) => structuredClone(proposal));
  }
}

const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'cowork-project-evolution-'));
  scratch.push(root);
  mkdirSync(join(root, 'docs'), { recursive: true });
  return root;
}

function createHarness(options: {
  workspacePath?: string;
  masterInstruction?: string;
  knowledgeFiles?: string[];
} = {}) {
  const projects = new Map<string, ProjectRow>();
  const sessions = new Map<string, SessionRow>();
  const messages = new Map<string, MessageRow[]>();
  const database = {
    raw: {} as never,
    projects: {
      create: vi.fn((row: ProjectRow) => projects.set(row.id, { ...row })),
      update: vi.fn((id: string, updates: Partial<ProjectRow>) => {
        const current = projects.get(id);
        if (!current) return;
        projects.set(id, { ...current, ...updates, updated_at: Date.now() });
      }),
      get: vi.fn((id: string) => projects.get(id)),
      getAll: vi.fn(() => [...projects.values()]),
      delete: vi.fn((id: string) => { projects.delete(id); }),
    },
    sessions: {
      create: vi.fn((row: SessionRow) => sessions.set(row.id, row)),
      update: vi.fn(),
      get: vi.fn((id: string) => sessions.get(id)),
      getAll: vi.fn(() => [...sessions.values()]),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn((row: MessageRow) => {
        messages.set(row.session_id, [...(messages.get(row.session_id) ?? []), row]);
      }),
      update: vi.fn(),
      getBySessionId: vi.fn((sessionId: string) => messages.get(sessionId) ?? []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
      searchContent: vi.fn(() => []),
    },
  } as unknown as DatabaseInstance;
  const manager = new ProjectManager(database);
  const project = manager.create({
    name: 'Roman vivant',
    workspacePath: options.workspacePath,
    contextConfig: {
      masterInstruction: options.masterInstruction,
      knowledgeFiles: options.knowledgeFiles ?? [],
    },
  });
  const repository = new MemoryProposalRepository();
  const service = new ProjectEvolutionService(database, manager, repository);
  return { database, manager, messages, project, repository, service, sessions };
}

function sessionRow(id: string, projectId: string): SessionRow {
  return {
    id,
    title: 'Session de travail',
    claude_session_id: null,
    openai_thread_id: null,
    status: 'idle',
    cwd: null,
    mounted_paths: '[]',
    allowed_tools: '[]',
    memory_enabled: 1,
    model: null,
    project_id: projectId,
    is_background: 0,
    execution_mode: 'chat',
    created_at: 1,
    updated_at: 1,
  };
}

describe('ProjectEvolutionService', () => {
  it('keeps a deterministic master-instruction proposal pending until approval and can roll it back', () => {
    const { manager, project, service } = createHarness({ masterInstruction: 'Répondre en français.' });
    const proposal = service.create({
      projectId: project.id,
      source: {
        kind: 'summary',
        text: [
          'Toujours citer la date des sources.',
          'Éviter les affirmations sans preuve.',
          'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456',
        ].join('\n'),
      },
      target: { type: 'master_instruction' },
    });

    expect(proposal.status).toBe('pending');
    expect(proposal.beforeContent).toBe('Répondre en français.');
    expect(proposal.afterContent).toContain('Toujours citer la date des sources.');
    expect(proposal.afterContent).toContain('Éviter les affirmations sans preuve.');
    expect(JSON.stringify(proposal)).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(manager.get(project.id)?.contextConfig?.masterInstruction).toBe('Répondre en français.');

    const approved = service.approve(proposal.id);
    expect(approved.ok).toBe(true);
    expect(approved.proposal?.status).toBe('approved');
    expect(manager.get(project.id)?.contextConfig?.masterInstruction).toBe(proposal.afterContent);

    const rolledBack = service.rollback(proposal.id);
    expect(rolledBack.ok).toBe(true);
    expect(rolledBack.proposal?.status).toBe('rolled_back');
    expect(manager.get(project.id)?.contextConfig?.masterInstruction).toBe('Répondre en français.');
    expect(rolledBack.proposal?.audit.map((entry) => entry.action)).toEqual([
      'created',
      'approved',
      'rolled_back',
    ]);
  });

  it('rejects a proposal without mutating Project context', () => {
    const { manager, project, service } = createHarness({ masterInstruction: 'Avant.' });
    const proposal = service.create({
      projectId: project.id,
      source: { kind: 'summary', text: 'Toujours produire un résumé final.' },
      target: { type: 'master_instruction' },
    });

    const result = service.reject({ proposalId: proposal.id, reason: 'Pas pour ce projet.' });

    expect(result.ok).toBe(true);
    expect(result.proposal).toMatchObject({ status: 'rejected', rejectionReason: 'Pas pour ce projet.' });
    expect(manager.get(project.id)?.contextConfig?.masterInstruction).toBe('Avant.');
  });

  it('marks a proposal stale and blocks approval when the master instruction changed', () => {
    const { manager, project, service } = createHarness({ masterInstruction: 'Version A.' });
    const proposal = service.create({
      projectId: project.id,
      source: { kind: 'summary', text: 'Toujours conserver les citations.' },
      target: { type: 'master_instruction' },
    });
    manager.update(project.id, { contextConfig: { masterInstruction: 'Version B.' } });

    const listed = service.list(project.id);
    const result = service.approve(proposal.id);

    expect(listed[0]?.staleReason).toMatch(/changed/);
    expect(result.ok).toBe(false);
    expect(result.proposal?.status).toBe('pending');
    expect(manager.get(project.id)?.contextConfig?.masterInstruction).toBe('Version B.');
  });

  it('applies and rolls back an atomic knowledge-file proposal', () => {
    const root = workspace();
    const knowledgePath = join(root, 'docs', 'canon.md');
    writeFileSync(knowledgePath, '# Canon\n\nVersion initiale.\n', 'utf-8');
    const { manager, project, service } = createHarness({ workspacePath: root });
    const proposal = service.create({
      projectId: project.id,
      source: { kind: 'summary', text: 'Toujours conserver le nom de la cité : Auroria.' },
      target: { type: 'knowledge_file', path: 'docs/canon.md' },
    });

    expect(readFileSync(knowledgePath, 'utf-8')).toBe(proposal.beforeContent);
    expect(service.approve(proposal.id).ok).toBe(true);
    expect(readFileSync(knowledgePath, 'utf-8')).toBe(proposal.afterContent);
    expect(manager.get(project.id)?.contextConfig?.knowledgeFiles).toContain('docs/canon.md');

    expect(service.rollback(proposal.id).ok).toBe(true);
    expect(readFileSync(knowledgePath, 'utf-8')).toBe(proposal.beforeContent);
    expect(manager.get(project.id)?.contextConfig?.knowledgeFiles).not.toContain('docs/canon.md');
  });

  it('detects an externally edited knowledge file before approval', () => {
    const root = workspace();
    const knowledgePath = join(root, 'docs', 'canon.md');
    writeFileSync(knowledgePath, 'Version A.\n', 'utf-8');
    const { project, service } = createHarness({ workspacePath: root });
    const proposal = service.create({
      projectId: project.id,
      source: { kind: 'summary', text: 'Toujours garder une chronologie cohérente.' },
      target: { type: 'knowledge_file', path: 'docs/canon.md' },
    });
    writeFileSync(knowledgePath, 'Version B écrite ailleurs.\n', 'utf-8');

    const result = service.approve(proposal.id);

    expect(result.ok).toBe(false);
    expect(result.proposal?.staleReason).toMatch(/changed/);
    expect(readFileSync(knowledgePath, 'utf-8')).toBe('Version B écrite ailleurs.\n');
  });

  it('binds a knowledge proposal to the exact reviewed workspace', () => {
    const reviewedRoot = workspace();
    const replacementRoot = workspace();
    const { manager, project, service } = createHarness({ workspacePath: reviewedRoot });
    const proposal = service.create({
      projectId: project.id,
      source: { kind: 'summary', text: 'Toujours documenter les décisions structurantes.' },
      target: { type: 'knowledge_file', path: 'docs/new-knowledge.md' },
    });
    manager.update(project.id, { workspacePath: replacementRoot });

    const result = service.approve(proposal.id);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/workspace changed/i);
    expect(() => readFileSync(join(replacementRoot, 'docs', 'new-knowledge.md'), 'utf-8')).toThrow();
  });

  it('refuses traversal, sensitive targets, and symlinked knowledge files', () => {
    const root = workspace();
    const outside = join(root, '..', `outside-${Date.now()}.md`);
    scratch.push(outside);
    writeFileSync(outside, 'outside', 'utf-8');
    const { project, service } = createHarness({ workspacePath: root });
    const base = {
      projectId: project.id,
      source: { kind: 'summary' as const, text: 'Toujours protéger les données.' },
    };

    expect(() => service.create({ ...base, target: { type: 'knowledge_file', path: '../outside.md' } }))
      .toThrow(/Unsafe/);
    expect(() => service.create({ ...base, target: { type: 'knowledge_file', path: '.env' } }))
      .toThrow(/Unsafe/);

    if (process.platform !== 'win32') {
      symlinkSync(outside, join(root, 'docs', 'linked.md'));
      expect(() => service.create({ ...base, target: { type: 'knowledge_file', path: 'docs/linked.md' } }))
        .toThrow(/Unsafe/);
    }
  });

  it('creates a bounded, secret-filtered proposal from a session belonging to the Project', () => {
    const { database, project, service } = createHarness();
    database.sessions.create(sessionRow('session-1', project.id));
    database.messages.create({
      id: 'message-1',
      session_id: 'session-1',
      role: 'user',
      content: JSON.stringify([
        { type: 'text', text: 'Désormais, toujours écrire les dialogues avec des tirets cadratins.' },
      ]),
      timestamp: 42,
      token_usage: null,
      execution_time_ms: null,
    });
    database.messages.create({
      id: 'message-2',
      session_id: 'session-1',
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', text: 'TOKEN=abcdefghijklmnopqrstuvwxyz1234567890' }]),
      timestamp: 43,
      token_usage: null,
      execution_time_ms: null,
    });

    const proposal = service.create({
      projectId: project.id,
      source: { kind: 'session', sessionId: 'session-1' },
      target: { type: 'master_instruction' },
    });

    expect(proposal.sourceSessionId).toBe('session-1');
    expect(proposal.evidence).toEqual([
      expect.objectContaining({ messageId: 'message-1', role: 'user', timestamp: 42 }),
    ]);
    expect(JSON.stringify(proposal)).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('drops complete multi-line private keys before splitting reusable source text', () => {
    const { project, service } = createHarness();
    const proposal = service.create({
      projectId: project.id,
      source: {
        kind: 'summary',
        text: [
          'Toujours conserver une chronologie vérifiable.',
          '-----BEGIN PRIVATE KEY-----',
          'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
          'ligneSecreteQuiNeDoitJamaisSortir',
          '-----END PRIVATE KEY-----',
        ].join('\n'),
      },
      target: { type: 'master_instruction' },
    });

    expect(proposal.afterContent).toContain('Toujours conserver une chronologie vérifiable.');
    expect(JSON.stringify(proposal)).not.toContain('BEGIN PRIVATE KEY');
    expect(JSON.stringify(proposal)).not.toContain('ligneSecreteQuiNeDoitJamaisSortir');
  });

  it('refuses to learn from a session attached to another Project', () => {
    const { database, project, service } = createHarness();
    database.sessions.create(sessionRow('foreign-session', 'another-project'));

    expect(() => service.create({
      projectId: project.id,
      source: { kind: 'session', sessionId: 'foreign-session' },
      target: { type: 'master_instruction' },
    })).toThrow(/does not belong/);
  });
});
