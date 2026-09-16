/**
 * execute_code must not break valid Python that starts with a module
 * docstring and `from __future__ import …`.
 *
 * The RPC helper used to be prepended unconditionally, which moved
 * `__future__` off the top of the file and raised SyntaxError — so
 * `buddy science --language python` never ran a real experiment.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  executeCode,
  injectAfterPythonPreamble,
} from '../../src/tools/execute-code-runner.js';

let tempWorkspace: string;
let idCounter: number;

function nextId(): string {
  idCounter += 1;
  return `py-future-${idCounter}`;
}

describe('injectAfterPythonPreamble', () => {
  const helper = 'import os as _cb_os\n';

  it('places the helper after a docstring + future import, not before', () => {
    const src = ['"""module doc"""', 'from __future__ import annotations', 'x = 1', ''].join('\n');
    const out = injectAfterPythonPreamble(src, helper);
    expect(out.indexOf('from __future__')).toBeLessThan(out.indexOf('import os as _cb_os'));
    expect(out.indexOf('import os as _cb_os')).toBeLessThan(out.indexOf('x = 1'));
    expect(out.startsWith('"""module doc"""')).toBe(true);
  });

  it('places the helper after a parenthesized future import', () => {
    const src = ['from __future__ import (', '    annotations,', ')', 'print(1)', ''].join('\n');
    const out = injectAfterPythonPreamble(src, helper);
    expect(out.indexOf(')')).toBeLessThan(out.indexOf('import os as _cb_os'));
    expect(out.indexOf('import os as _cb_os')).toBeLessThan(out.indexOf('print(1)'));
  });

  it('keeps a leading shebang and encoding cookie before the future import', () => {
    const src = [
      '#!/usr/bin/env python3',
      '# -*- coding: utf-8 -*-',
      'from __future__ import annotations',
      'print(1)',
    ].join('\n');
    const out = injectAfterPythonPreamble(src, helper);
    expect(out.startsWith('#!/usr/bin/env python3')).toBe(true);
    expect(out.indexOf('from __future__')).toBeLessThan(out.indexOf('import os as _cb_os'));
  });
});

describe('execute_code Python __future__ preamble', () => {
  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-py-future-'));
    idCounter = 0;
  });

  afterEach(async () => {
    await fs.rm(tempWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('runs a script whose first statements are a docstring then from __future__ import annotations', async () => {
    const result = await executeCode(
      {
        language: 'python',
        code: [
          '"""module doc — required before future in some styles"""',
          'from __future__ import annotations',
          'x: int = 7',
          'print(f"ok={x}")',
        ].join('\n'),
      },
      { rootDir: tempWorkspace, createId: nextId },
    );

    expect(result.ok, result.stderr || result.error).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ok=7');
    expect(result.stderr).not.toContain('from __future__ imports must occur at the beginning');
  });

  it('still exposes codebuddy_tool_call after a future import (RPC helper survives the splice)', async () => {
    const result = await executeCode(
      {
        language: 'python',
        code: [
          'from __future__ import annotations',
          'print("has_rpc=" + str(callable(codebuddy_tool_call)))',
        ].join('\n'),
      },
      { rootDir: tempWorkspace, createId: nextId },
    );

    expect(result.ok, result.stderr || result.error).toBe(true);
    expect(result.stdout).toContain('has_rpc=True');
  });
});
