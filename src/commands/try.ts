/**
 * `buddy try` — an isolated, zero-configuration coding-agent demonstration.
 *
 * The demo intentionally accepts only the two free paths advertised during
 * onboarding: an existing ChatGPT OAuth login, then a reachable local Ollama.
 * Ambient paid API keys are never selected implicitly.
 */

import { execFile } from 'node:child_process';
    ?? (async () => {
      const folder = await mkdtemp(join(tmpdir(), 'code-buddy-try-'));
      // TMPDIR may sit under an ESM project. Pin the demo's requested CommonJS
      // format locally rather than inheriting that project's package type.
      await writeFile(join(folder, 'package.json'), '{"private":true,"type":"commonjs"}\n');
      return folder;
    });
