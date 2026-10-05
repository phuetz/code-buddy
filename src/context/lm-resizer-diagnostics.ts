import { execFile } from 'child_process';
import { promisify } from 'util';
import { classifyToolOutputHelp, isLmResizerEnabled, resolveLmResizerBin } from './lm-resizer-compressor.js';
const run = promisify(execFile);
/** Read-only host probe. Availability alone does not establish protocol support. */
export async function diagnoseLmResizer() {
  const binary = resolveLmResizerBin();
  const result = { binary, enabled: isLmResizerEnabled(), available: false, toolOutputSupported: false, protocol: 'unsupported' as 'argv' | 'request-json' | 'unsupported', version: 'unknown', warning: '' };
  const options = { timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true };
  try {
    await run(binary, ['--help'], options);
    result.available = true;
    try { result.version = (await run(binary, ['--version'], options)).stdout.trim(); } catch { /* Older CLI has no version flag. */ }
    try {
      const probe = await run(binary, ['tool-output', '--help'], options);
      // `tool-output --help` succeeds on an incompatible binary too: read the options it documents.
      result.protocol = classifyToolOutputHelp(probe.stdout);
      result.toolOutputSupported = result.protocol !== 'unsupported';
    } catch { /* Old protocol: retain raw observations. */ }
    if (!result.toolOutputSupported) result.warning = 'This binary lacks a usable tool-output protocol (neither `--command` nor `--request-json`). Buddy keeps raw observations; install lm-resizer >= 0.2.4 to enable observation compression.';
  } catch {
    result.warning = 'LM Resizer is unavailable on the host. Buddy keeps raw observations.';
  }
  return result;
}
