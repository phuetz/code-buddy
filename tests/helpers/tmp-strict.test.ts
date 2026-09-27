import { describe, expect, it, vi } from 'vitest';

const rmSync = vi.hoisted(() => vi.fn());
vi.mock('node:fs', () => ({ rmSync }));

import { removeTmpDirStrict, TMP_RM_OPTIONS } from './tmp.js';

describe('strict temporary directory cleanup', () => {
  it('uses bounded retries and propagates a persistent cleanup error', () => {
    rmSync.mockReset();
    const error = Object.assign(new Error('directory still in use'), { code: 'ENOTEMPTY' });
    rmSync.mockImplementation(() => { throw error; });

    expect(() => removeTmpDirStrict('/tmp/test-directory')).toThrow(error);
    expect(rmSync).toHaveBeenCalledWith('/tmp/test-directory', TMP_RM_OPTIONS);
  });
});
