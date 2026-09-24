import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createKanbanTools } from '../../../src/tools/registry/kanban-tools.js';
import { ColabKanbanAdapter } from '../../../src/kanban/colab-kanban-adapter.js';

describe('Kanban Tools', () => {
  let tempHome: string;
  let tempCwd: string;

  beforeEach(async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-home-'));
    tempCwd = path.join(tempHome, 'test-project');
    fs.mkdirSync(tempCwd, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  async function getCardFromAdapter(adapter: ColabKanbanAdapter, id: string) {
    const cards = await adapter.listCards({});
    return cards.find(c => c.id === id);
  }

  it('kanban_create', async () => {
    const tools = createKanbanTools({ rootDir: tempCwd });
    const createTool = tools.find((t) => t.name === 'kanban_create');

    const input = {
      title: 'Fix issue',
      description: 'The issue is serious',
      status: 'todo',
      priority: 'high',
      author: 'TestUser',
    };

    const result = await createTool!.execute(input, { cwd: tempCwd } as any);
    expect(result.success).toBe(true);
    let parsed = JSON.parse(result.output as string);
    const id = parsed.card.id;

    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    const card = await getCardFromAdapter(store, id);
    expect(card).toBeDefined();
    expect(card?.title).toBe('Fix issue');
    expect(card?.description).toBe('The issue is serious');
  });

  it('kanban_list', async () => {
    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    await store.createCard({ title: 'Task 1', description: 'Desc 1', status: 'todo' });
    await store.createCard({ title: 'Task 2', description: 'Desc 2', status: 'done' });

    const tools = createKanbanTools({ rootDir: tempCwd });
    const listTool = tools.find((t) => t.name === 'kanban_list');

    const resultAll = await listTool!.execute({}, { cwd: tempCwd } as any);
    expect(resultAll.success).toBe(true);
    let parsedAll = JSON.parse(resultAll.output as string);
    expect(parsedAll.cards.length).toBe(2);

    const resultTodo = await listTool!.execute({ status: 'todo' }, { cwd: tempCwd } as any);
    expect(resultTodo.success).toBe(true);
    let parsedTodo = JSON.parse(resultTodo.output as string);
    expect(parsedTodo.cards.length).toBe(1);
    expect(parsedTodo.cards[0].title).toBe('Task 1');
  });

  it('kanban_show', async () => {
    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    const createdCard = await store.createCard({ title: 'Task 1', description: 'Desc 1', status: 'todo' });

    const tools = createKanbanTools({ rootDir: tempCwd });
    const showTool = tools.find((t) => t.name === 'kanban_show');

    const result = await showTool!.execute({ id: createdCard.id }, { cwd: tempCwd } as any);
    expect(result.success).toBe(true);
    let parsed = JSON.parse(result.output as string);
    expect(parsed.card.id).toBe(createdCard.id);
    expect(parsed.card.title).toBe('Task 1');
  });

  it('kanban_complete', async () => {
    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    const createdCard = await store.createCard({ title: 'Task 1', description: 'Desc 1', status: 'todo' });

    const tools = createKanbanTools({ rootDir: tempCwd });
    const completeTool = tools.find((t) => t.name === 'kanban_complete');

    const result = await completeTool!.execute({ id: createdCard.id }, { cwd: tempCwd } as any);
    expect(result.success).toBe(true);
    
    const card = await getCardFromAdapter(store, createdCard.id);
    expect(card?.status).toBe('done');
  });

  it('kanban_block', async () => {
    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    const createdCard = await store.createCard({ title: 'Task 1', description: 'Desc 1', status: 'todo' });

    const tools = createKanbanTools({ rootDir: tempCwd });
    const blockTool = tools.find((t) => t.name === 'kanban_block');

    const result = await blockTool!.execute({ 
      id: createdCard.id,
      reason: 'Blocked by dependency'
    }, { cwd: tempCwd } as any);
    expect(result.success).toBe(true);
    
    const card = await getCardFromAdapter(store, createdCard.id);
    expect(card?.status).toBe('blocked');
    expect(card?.comments.some((c: any) => c.text.includes('Blocked by dependency'))).toBe(true);
  });

  it('kanban_unblock', async () => {
    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    const createdCard = await store.createCard({ title: 'Task 1', description: 'Desc 1', status: 'blocked' });

    const tools = createKanbanTools({ rootDir: tempCwd });
    const unblockTool = tools.find((t) => t.name === 'kanban_unblock');

    const result = await unblockTool!.execute({ 
      id: createdCard.id,
      comment: 'Dependency resolved',
    }, { cwd: tempCwd } as any);
    expect(result.success).toBe(true);
    
    const card = await getCardFromAdapter(store, createdCard.id);
    expect(card?.status).toBe('in_progress');
    expect(card?.comments.some((c: any) => c.text.includes('Dependency resolved'))).toBe(true);
  });

  it('kanban_comment', async () => {
    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    const createdCard = await store.createCard({ title: 'Task 1', description: 'Desc 1', status: 'todo' });

    const tools = createKanbanTools({ rootDir: tempCwd });
    const commentTool = tools.find((t) => t.name === 'kanban_comment');

    const result = await commentTool!.execute({ 
      id: createdCard.id,
      text: 'Adding some notes'
    }, { cwd: tempCwd } as any);
    expect(result.success).toBe(true);
    
    const card = await getCardFromAdapter(store, createdCard.id);
    expect(card?.comments.some((c: any) => c.text === 'Adding some notes')).toBe(true);
  });

  it('kanban_link', async () => {
    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    const card1 = await store.createCard({ title: 'Task 1', description: 'Desc 1', status: 'todo' });
    const card2 = await store.createCard({ title: 'Task 2', description: 'Desc 2', status: 'todo' });

    const tools = createKanbanTools({ rootDir: tempCwd });
    const linkTool = tools.find((t) => t.name === 'kanban_link');

    const result = await linkTool!.execute({ 
      id: card1.id,
      target: card2.id,
      label: 'blocks'
    }, { cwd: tempCwd } as any);
    expect(result.success).toBe(true);
    
    const c1 = await getCardFromAdapter(store, card1.id);
    expect(c1?.links.some((l: any) => l.target === card2.id && l.label === 'blocks')).toBe(true);
  });

  it('kanban_heartbeat', async () => {
    const store = new ColabKanbanAdapter({ rootDir: tempCwd });
    const createdCard = await store.createCard({ title: 'Task 1', description: 'Desc 1', status: 'todo' });

    const tools = createKanbanTools({ rootDir: tempCwd });
    const heartbeatTool = tools.find((t) => t.name === 'kanban_heartbeat');

    const result = await heartbeatTool!.execute({ 
      id: createdCard.id,
      message: 'Still working on this'
    }, { cwd: tempCwd } as any);
    expect(result.success).toBe(true);
    
    const card = await getCardFromAdapter(store, createdCard.id);
    expect(card?.heartbeats.some((h: any) => h.message === 'Still working on this')).toBe(true);
  });
});
