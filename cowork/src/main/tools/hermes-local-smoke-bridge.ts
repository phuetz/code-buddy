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
      browser,
      protocols,
      runtime,
    },
    schemaVersion: 1,
    summary: {
      passed,
      total: 3,
    },
  };
}
