/**
 * Import FIRST in a test file whose code under test reads the user
 * `config.toml`: the config loader freezes that path from `os.homedir()` when
 * its module loads, so a later `enter()` would be too late. HOME/USERPROFILE
 * point at a throwaway dir for the whole file, and the developer's own
 * profile can no longer change a verdict.
 */
import { afterAll } from 'vitest';
import { createIsolatedHome } from './isolated-home.js';

const home = createIsolatedHome('cb-config-home-');
home.enter();
afterAll(() => home.leave());
