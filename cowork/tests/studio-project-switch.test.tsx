// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppStudio } from '../src/renderer/components/studio/use-app-studio';
import type { AppStudioApis } from '../src/renderer/components/studio/studio-api';

afterEach(cleanup);

it('never opens the previous project file in a newly scaffolded project', async () => {
  let finishList: (() => void) | undefined;
  const listed = new Promise<void>((resolve) => { finishList = resolve; });
  const read = vi.fn(async (_root: string, path: string) => ({ ok: true as const, data: { content: path } }));
  const apis: Partial<AppStudioApis> = {
    files: {
      list: vi.fn(async (root: string) => {
        if (root === 'new-project') await listed;
        return { ok: true as const, data: [{ name: root === 'old-project' ? 'old.js' : 'index.html', path: root === 'old-project' ? 'old.js' : 'index.html', type: 'file' as const }] };
      }),
      read,
    } as AppStudioApis['files'],
    scaffold: {
      list: async () => [],
      generate: async () => ({ ok: true, data: { projectDir: 'new-project', files: [] } }),
    } as AppStudioApis['scaffold'],
  };
  const { result } = renderHook(() => useAppStudio({ projectRoot: 'old-project', apis }));
  await waitFor(() => expect(result.current.state.activeFile).toBe('old.js'));
  read.mockClear();
  let generating: Promise<void>;
  act(() => { generating = result.current.actions.scaffold({ template: 'react-ts', targetDir: 'new-project', vars: {} }); });
  await waitFor(() => expect(result.current.state.projectRoot).toBe('new-project'));
  expect(read).not.toHaveBeenCalledWith('new-project', 'old.js');
  await act(async () => { finishList?.(); await generating!; });
});
