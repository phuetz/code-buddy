/**
 * Throwaway HOME for test files whose code under test persists into
 * `~/.codebuddy` (profile singletons freeze `os.homedir()` at construction).
 *
 * `enter()` points HOME/USERPROFILE at a fresh temp dir; `leave()` restores the
 * previous values and removes the dir. Callers must first await or flush the
 * singletons bound to the isolated home, otherwise a fire-and-forget write can
 * land after cleanup. The no-repo-writes global guard stays the safety net.
 */
import { makeTmpDir, removeTmpDir } from './tmp.js';

export interface IsolatedHome {
  readonly path: string;
  enter(): string;
  leave(): void;
}

export function createIsolatedHome(prefix: string): IsolatedHome {
  let dir = '';
  let previousHome: string | undefined;
  let previousUserProfile: string | undefined;
  return {
    get path() {
      return dir;
    },
    enter() {
      previousHome = process.env.HOME;
      previousUserProfile = process.env.USERPROFILE;
      dir = makeTmpDir(prefix);
      process.env.HOME = dir;
      process.env.USERPROFILE = dir;
      return dir;
    },
    leave() {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      removeTmpDir(dir);
    },
  };
}
