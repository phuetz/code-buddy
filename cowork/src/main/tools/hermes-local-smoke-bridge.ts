import {
  runHermesBrowserBackendSmokeForReview,
  type HermesBrowserBackendSmokeResult,
} from './hermes-browser-backends-bridge';
import {
  runHermesProtocolGatewaysSmokeForReview,
  type HermesProtocolGatewaySmokeResult,
} from './hermes-protocol-gateways-bridge';
import {
  runHermesRuntimeBackendSmokeForReview,
  type HermesRuntimeBackendSmokeResult,
} from './hermes-runtime-backends-bridge';

export interface HermesLocalSmokeSuiteReview {
  commands: {
    browser: string;
    protocols: string;
    runtime: string;
    suite: string;
  };
  generatedAt: string;
  kind: 'hermes_local_smoke_suite';
  notes: string[];
  ok: boolean;
  results: {
    browser: HermesBrowserBackendSmokeResult;
    protocols: HermesProtocolGatewaySmokeResult;
    runtime: HermesRuntimeBackendSmokeResult;
  };
  schemaVersion: 1;
  summary: {
    passed: number;
    total: 3;
  };
}

function basenameOnly(value: string): string {
  return value.replace(/\\/g, '/').split('/').pop() || 'local-artifact';
}

function sanitizeSmokeCommand(command: string | null): string | null {
  if (!command) return null;
  if (command.includes('/') || command.includes('\\') || /^[A-Za-z]:/.test(command)) {
    return basenameOnly(command);
  }
  return command;
}

function redactLocalSmokeText(value: string): string {
  return value
    .replace(/trace=([^;\r\n]+)/g, 'trace=[redacted-local-path]')
    .replace(/[A-Za-z]:\\[^\r\n;]+/g, '[redacted-local-path]')
    .replace(/\/(?:Users|home|tmp|var\/folders)\/[^\r\n;]+/g, '[redacted-local-path]');
}

function sanitizeRuntimeSmokeResult(result: HermesRuntimeBackendSmokeResult): HermesRuntimeBackendSmokeResult {
  return {
    ...result,
    command: sanitizeSmokeCommand(result.command),
    output: redactLocalSmokeText(result.output),
    stderr: redactLocalSmokeText(result.stderr),
    stdout: redactLocalSmokeText(result.stdout),
  };
}

function sanitizeBrowserSmokeResult(result: HermesBrowserBackendSmokeResult): HermesBrowserBackendSmokeResult {
  return {
    ...result,
    artifacts: result.artifacts?.map((artifact) => ({
      ...artifact,
      path: basenameOnly(artifact.path),
    })),
    command: sanitizeSmokeCommand(result.command),
    output: redactLocalSmokeText(result.output),
    stderr: redactLocalSmokeText(result.stderr),
    stdout: redactLocalSmokeText(result.stdout),
  };
}

export async function runHermesLocalSmokeSuiteForReview(): Promise<HermesLocalSmokeSuiteReview> {
  const [runtime, browser, protocols] = await Promise.all([
    runHermesRuntimeBackendSmokeForReview('auto'),
    runHermesBrowserBackendSmokeForReview('auto'),
    runHermesProtocolGatewaysSmokeForReview(),
  ]);
  const passed = [runtime.ok, browser.ok, protocols.ok].filter(Boolean).length;

  return {
    commands: {
      browser: 'buddy hermes browser-smoke auto --json',
      protocols: 'buddy hermes protocols-smoke local --json',
      runtime: 'buddy hermes runtime-smoke auto --json',
      suite: 'buddy hermes smoke --json',
    },
    generatedAt: new Date().toISOString(),
    kind: 'hermes_local_smoke_suite',
    notes: [
      'Runs only the local-first Hermes runtime, browser, and protocol gateway smokes.',
      'Remote providers and managed browser/runtime backends remain opt-in in their dedicated strips.',
    ],
    ok: passed === 3,
    results: {
      browser: sanitizeBrowserSmokeResult(browser),
      protocols,
      runtime: sanitizeRuntimeSmokeResult(runtime),
    },
    schemaVersion: 1,
    summary: {
      passed,
      total: 3,
    },
  };
}
