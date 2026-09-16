import { afterEach, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { PersonaManager } from '../../src/personas/persona-manager.js';
import { logger } from '../../src/utils/logger.js';

let manager: PersonaManager | undefined;
let directory: string | undefined;

afterEach(async () => {
  manager?.dispose();
  vi.restoreAllMocks();
  if (directory) await fs.remove(directory);
});

it('closes a failed real watcher without losing the active persona or throwing', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-watch-error-'));
  const watch = vi.spyOn(fs, 'watch');
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  manager = new PersonaManager({ customPersonasDir: directory, persistActivePersona: false });
  await manager.ready();
  expect(manager.setActivePersona('minimalist')).toBe(true);
  const watcher = watch.mock.results[0].value as fs.FSWatcher;
  const close = vi.spyOn(watcher, 'close');
  const error = Object.assign(new Error('operation not permitted, watch'), { code: 'EPERM' });

  expect(() => watcher.emit('error', error)).not.toThrow();
  expect(close).toHaveBeenCalledOnce();
  expect(manager.getActivePersona()?.id).toBe('minimalist');
  expect(warn).toHaveBeenCalledWith(
    'Persona hot reload stopped after a watcher error',
    { code: 'EPERM', message: error.message },
  );
  manager.dispose();
  expect(close).toHaveBeenCalledOnce();
});
