import { getSandboxManager } from '../security/sandbox.js';
import { getTrustFolderManager } from '../security/trust-folders.js';

/** Keep explicit CLI directory grants consistent across file and shell tools. */
export function grantAdditionalDirectories(directories: string[]): () => void {
  const sandbox = getSandboxManager();
  const trust = getTrustFolderManager();
  const releases: Array<() => void> = [];
  const release = () => { for (const undo of releases.splice(0).reverse()) undo(); };
  try {
    for (const directory of directories) releases.push(trust.trustFolderForSession(directory));
    for (const directory of directories) sandbox.allowPath(directory);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
