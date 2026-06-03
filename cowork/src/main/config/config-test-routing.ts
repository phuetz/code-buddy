import type { ApiTestInput, ApiTestResult } from '../../renderer/types';
import type { AppConfig } from './config-store';

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig,
): Promise<ApiTestResult> {
  const { probeWithClaudeSdk } = await import('../claude/claude-sdk-one-shot');
  return probeWithClaudeSdk(payload, config);
}
