/**
 * Specialized renderer bootstrap — failure must be visible, not swallowed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import type { Renderer } from '../../src/renderers/types.js';
import {
  initializeRenderers,
  areSpecializedRenderersDegraded,
  getSpecializedRenderersDegradedError,
  resetSpecializedRendererBootstrapForTests,
  setSpecializedRendererLoaderForTests,
} from '../../src/renderers/startup.js';
import { getRenderManager, resetRenderManager } from '../../src/renderers/render-manager.js';
import { logger } from '../../src/utils/logger.js';

function dummyRenderer(id: string): Renderer {
  return {
    id,
    name: id,
    priority: 0,
    canRender: (_data: unknown): _data is unknown => false,
    render: () => '',
  };
}

function dummyBundle() {
  return {
    testResultsRenderer: dummyRenderer('test-results'),
    weatherRenderer: dummyRenderer('weather'),
    codeStructureRenderer: dummyRenderer('code-structure'),
    diffRenderer: dummyRenderer('diff'),
    tableRenderer: dummyRenderer('table'),
    treeRenderer: dummyRenderer('tree'),
  };
}

describe('initializeRenderers', () => {
  beforeEach(() => {
    resetRenderManager();
    resetSpecializedRendererBootstrapForTests();
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(() => {
    resetSpecializedRendererBootstrapForTests();
    resetRenderManager();
  });

  it('registers specialized renderers and stays healthy on success', async () => {
    setSpecializedRendererLoaderForTests(async () => dummyBundle());
    await initializeRenderers();
    expect(areSpecializedRenderersDegraded()).toBe(false);
    expect(getSpecializedRenderersDegradedError()).toBeUndefined();
    const ids = getRenderManager().getRenderers().map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'test-results',
        'weather',
        'code-structure',
        'diff',
        'table',
        'tree',
      ]),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects, flags degraded state, and warns when loading fails', async () => {
    setSpecializedRendererLoaderForTests(async () => {
      throw new Error('boom-import');
    });

    await expect(initializeRenderers()).rejects.toThrow('boom-import');

    expect(areSpecializedRenderersDegraded()).toBe(true);
    expect(getSpecializedRenderersDegradedError()).toBe('boom-import');
    expect(logger.warn).toHaveBeenCalledWith(
      'Specialized renderer bootstrap failed; generic rendering remains available',
      expect.objectContaining({
        error: 'boom-import',
        renderersDegraded: true,
      }),
    );
    expect(getRenderManager().getRenderers()).toHaveLength(0);
  });

  it('does not swallow a later initializeRenderers() call after a failed bootstrap', async () => {
    setSpecializedRendererLoaderForTests(async () => {
      throw new Error('still-broken');
    });
    await expect(initializeRenderers()).rejects.toThrow('still-broken');
    await expect(initializeRenderers()).rejects.toThrow('still-broken');
    expect(areSpecializedRenderersDegraded()).toBe(true);
  });
});
