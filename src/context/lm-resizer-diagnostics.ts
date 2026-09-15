import { execFile } from 'child_process';
import { promisify } from 'util';
import { isLmResizerEnabled, resolveLmResizerBin } from './lm-resizer-compressor.js';
const run = promisify(execFile);
/** Read-only host probe. Availability alone does not establish protocol support. */
export async function diagnoseLmResizer() {
  const binary = resolveLmResizerBin();
  const result = { binary, enabled: isLmResizerEnabled(), available: false, toolOutputSupported: false, version: 'unknown', warning: '' };
  const options = { timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true };
  try {
    await run(binary, ['--help'], options);
    result.available = true;
    try { result.version = (await run(binary, ['--version'], options)).stdout.trim(); } catch { /* Older CLI has no version flag. */ }
    try {
      const probe = await run(binary, ['tool-output', '--help'], options);
      result.toolOutputSupported = /tool-output/.test(probe.stdout);
    } catch { /* Old protocol: retain raw observations. */ }
    if (!result.toolOutputSupported) result.warning = 'This binary lacks the tool-output protocol. Buddy keeps raw observations; install a compatible release to enable observation compression.';
  } catch {
    result.warning = 'LM Resizer is unavailable on the host. Buddy keeps raw observations.';
  }
  return result;
}
