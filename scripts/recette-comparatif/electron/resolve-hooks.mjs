// ESM resolve hook for the private core build under /tmp: bare specifiers that
// cannot be found next to the build are resolved from the worktree root, then
// from the Cowork package (read-only shared node_modules through the worktree).
import { pathToFileURL } from 'node:url';

const worktree = process.env.RECETTE_WORKTREE;
if (!worktree) throw new Error('RECETTE_WORKTREE is required');
const roots = [pathToFileURL(`${worktree}/package.json`).href, pathToFileURL(`${worktree}/cowork/package.json`).href];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const bare = !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':');
    if (!bare || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    for (const parentURL of roots) {
      try {
        return await nextResolve(specifier, { ...context, parentURL });
      } catch { /* try next root */ }
    }
    throw error;
  }
}
