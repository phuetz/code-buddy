import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, cp, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSemanticAct, assertNaturalLanguage } from '../../src/automation-replay/engine.js';
import { ReplayStore } from '../../src/automation-replay/store.js';
import type { ReplayHost, SemanticAction } from '../../src/automation-replay/types.js';

let root: string;
let project: string;
let home: string;
let store: ReplayStore;
const request = { instruction: 'Open details', expectedText: 'Details ready' };
const action: SemanticAction = { kind: 'click', target: { role: 'button', name: 'Details' } };
function fixture() {
  let text = 'Home';
  let name = 'Details';
  let protectedInput = false;
  const perform = vi.fn(async () => { text = 'Details ready'; });
  const host: ReplayHost = {
    kind: 'browser', perform,
    observe: async () => ({ context: 'https://example.test/', text, nodes: [{ ref: 42, role: 'button', name, enabled: true, protected: protectedInput }] }),
  };
  return { host, perform, reset: () => { text = 'Home'; }, change: () => { name = 'View details'; }, protect: () => { protectedInput = true; } };
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'replay-test-'));
  project = path.join(root, 'project'); home = path.join(root, 'home');
  await mkdir(project); await mkdir(home);
  store = new ReplayStore(project, home);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('semantic action recording', () => {
  it('records a verified effect and replays with zero model calls', async () => {
    const f = fixture();
    const model = vi.fn(async () => ({ content: JSON.stringify(action), tokens: 51 }));
    expect(await runSemanticAct(f.host, request, { store, model })).toMatchObject({ success: true, modelCalls: 1, tokens: 51 });
    f.reset(); model.mockClear();
    expect(await runSemanticAct(f.host, request, { store, model })).toMatchObject({ success: true, replayed: 1, modelCalls: 0, tokens: 0 });
    expect(model).not.toHaveBeenCalled();
  });
  it('hands off BEFORE an effect on a changed page and replaces the recording', async () => {
    const f = fixture();
    await runSemanticAct(f.host, request, { store, model: async () => ({ content: JSON.stringify(action) }) });
    f.reset(); f.change(); f.perform.mockClear();
    const model = vi.fn(async () => {
      expect(f.perform).not.toHaveBeenCalled();
      return { content: JSON.stringify({ ...action, target: { role: 'button', name: 'View details' } }) };
    });
    expect(await runSemanticAct(f.host, request, { store, model })).toMatchObject({ divergence: 'state-before', modelCalls: 1 });
    f.reset(); model.mockClear();
    expect(await runSemanticAct(f.host, request, { store, model })).toMatchObject({ replayed: 1, modelCalls: 0 });
  });
  it('hands off AFTER a changed effect with the executed prefix, without repeating it', async () => {
    const f = fixture();
    await runSemanticAct(f.host, request, { store, model: async () => ({ content: JSON.stringify(action) }) });
    f.reset(); f.perform.mockClear();
    let intermediate = false;
    const originalObserve = f.host.observe;
    f.host.observe = async () => ({ ...await originalObserve(), ...(intermediate ? { text: 'Intermediate', nodes: [{ ref: 99, role: 'button', name: 'Finish', enabled: true, protected: false }] } : {}) });
    const complete = f.perform.getMockImplementation()!;
    f.perform.mockImplementationOnce(async () => { intermediate = true; })
      .mockImplementationOnce(async () => { intermediate = false; await complete(); });
    const model = vi.fn(async (_system, input) => {
      expect(JSON.parse(input).executed).toEqual([action]);
      return { content: JSON.stringify({ ...action, target: { role: 'button', name: 'Finish' } }) };
    });
    expect(await runSemanticAct(f.host, request, { store, model })).toMatchObject({ replayed: 1, modelCalls: 1, divergence: 'state-after' });
  });
  it('does not call the model or repeat an uncertain/denied replay effect', async () => {
    const f = fixture();
    await runSemanticAct(f.host, request, { store, model: async () => ({ content: JSON.stringify(action) }) });
    f.reset(); f.perform.mockRejectedValueOnce(new Error('human denied'));
    const model = vi.fn();
    await expect(runSemanticAct(f.host, request, { store, model })).rejects.toThrow('human denied');
    expect(model).not.toHaveBeenCalled();
  });
  it('does not report a failed UI effect when only atomic cache writing fails', async () => {
    const f = fixture();
    vi.spyOn(store, 'write').mockRejectedValue(new Error('read-only filesystem'));
    expect(await runSemanticAct(f.host, request, { store, model: async () => ({ content: JSON.stringify(action) }) }))
      .toMatchObject({ success: true, recordingSaved: false });
    expect(f.perform).toHaveBeenCalledOnce();
  });
  it('accepts only the first structured action from a verbose model then observes again', async () => {
    const f = fixture();
    expect(await runSemanticAct(f.host, request, { store, model: async () => ({ content: JSON.stringify(action) + '\n' + JSON.stringify(action) }) }))
      .toMatchObject({ success: true });
    expect(f.perform).toHaveBeenCalledOnce();
  });
  it('rejects a cloned or tampered recording', async () => {
    const f = fixture(); const model = vi.fn(async () => ({ content: JSON.stringify(action) }));
    await runSemanticAct(f.host, request, { store, model });
    const clone = path.join(root, 'clone'); await cp(project, clone, { recursive: true });
    f.reset(); model.mockClear();
    expect(await runSemanticAct(f.host, request, { store: new ReplayStore(clone, home), model })).toMatchObject({ modelCalls: 1, replayed: 0 });
    const dir = path.join(project, '.codebuddy/action-recordings');
    const file = path.join(dir, (await readdir(dir))[0]!);
    const record = JSON.parse(await readFile(file, 'utf8')); record.recording.steps[0].action.target.name = 'Delete';
    await writeFile(file, JSON.stringify(record)); f.reset();
    expect(await runSemanticAct(f.host, request, { store, model })).toMatchObject({ modelCalls: 1, replayed: 0 });
  });
  it('refuses symlinked recording directories', async () => {
    await symlink(home, path.join(project, '.codebuddy'), 'dir');
    await expect(store.write('a'.repeat(64), { version: 1, steps: [] })).rejects.toThrow('real directory');
  });
  it('never persists runtime values; replay obtains a new value from the caller', async () => {
    const f = fixture();
    const typed: string[] = [];
    f.host.perform = async (_action, values) => { typed.push(values.query!); await f.perform(); };
    const type = { ...action, kind: 'type', valueKey: 'query' };
    const model = async () => ({ content: JSON.stringify(type) });
    await runSemanticAct(f.host, { ...request, values: { query: 'private-first-value' } }, { store, model });
    const dir = path.join(project, '.codebuddy/action-recordings');
    expect(await readFile(path.join(dir, (await readdir(dir))[0]!), 'utf8')).not.toContain('private-first-value');
    f.reset();
    expect(await runSemanticAct(f.host, { ...request, values: { query: 'fresh-second-value' } }, { store, model })).toMatchObject({ replayed: 1 });
    expect(typed).toEqual(['private-first-value', 'fresh-second-value']);
  });
  it('never records or replays password fields, including a target that becomes protected', async () => {
    const f = fixture();
    const model = async () => ({ content: JSON.stringify(action) });
    await runSemanticAct(f.host, request, { store, model });
    f.reset(); f.protect(); f.perform.mockClear();
    await expect(runSemanticAct(f.host, request, { store, model })).rejects.toThrow('Protected input');
    expect(f.perform).not.toHaveBeenCalled();
  });
  it('rejects ambiguous targets before any effect', async () => {
    const f = fixture(); const original = f.host.observe;
    f.host.observe = async () => { const o = await original(); return { ...o, nodes: [...o.nodes, ...o.nodes] }; };
    await expect(runSemanticAct(f.host, request, { store, model: async () => ({ content: JSON.stringify(action) }) })).rejects.toThrow('ambiguous');
    expect(f.perform).not.toHaveBeenCalled();
  });
  it('natural assertions use a fresh model judgment and require grounded evidence', async () => {
    const f = fixture();
    const model = vi.fn(async () => ({ content: JSON.stringify({ passed: true, evidence: 'Home' }) }));
    expect(await assertNaturalLanguage(f.host, 'Home is visible', model)).toMatchObject({ passed: true });
    expect(await assertNaturalLanguage(f.host, 'Home is visible', model)).toMatchObject({ passed: true });
    expect(model).toHaveBeenCalledTimes(2);
    expect(await assertNaturalLanguage(f.host, 'Done', async () => ({ content: '{"passed":true,"evidence":"invented"}' }))).toMatchObject({ passed: false });
    await expect(assertNaturalLanguage(f.host, 'Done', async () => ({ content: 'not json' }))).rejects.toThrow();
  });
});

it('keeps separate recordings for identical intentions on different URL contexts', async () => {
  const f = fixture(); let context = 'https://first.test/';
  const observe = f.host.observe;
  f.host.observe = async () => ({ ...await observe(), context });
  const model = vi.fn(async () => ({ content: JSON.stringify(action) }));
  await runSemanticAct(f.host, request, { store, model });
  f.reset(); context = 'https://second.test/';
  await runSemanticAct(f.host, request, { store, model });
  f.reset(); context = 'https://first.test/'; model.mockClear();
  expect(await runSemanticAct(f.host, request, { store, model })).toMatchObject({ replayed: 1, modelCalls: 0 });
  expect(model).not.toHaveBeenCalled();
});
