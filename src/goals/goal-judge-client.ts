import { isChatGptSubscriptionModel } from '../providers/chatgpt-models.js';
import {
  CHATGPT_OAUTH_SENTINEL,
  CHATGPT_RESPONSES_BASE_URL,
  CodeBuddyClient,
} from '../codebuddy/client.js';

export interface GoalJudgeProviderInfo {
  apiKey: string;
  baseURL?: string;
  providerLabel?: string;
}

export interface GoalJudgeClientLike {
  getCurrentModel?: () => string | undefined;
}

export function isChatGptJudgeModel(model: string | undefined): boolean {
  return model ? isChatGptSubscriptionModel(model) : false;
}

export function isChatGptProvider(provider: GoalJudgeProviderInfo | undefined): boolean {
  if (!provider) return false;
  return (
    provider.apiKey === CHATGPT_OAUTH_SENTINEL ||
    provider.baseURL?.includes('chatgpt.com/backend-api/codex') === true ||
    provider.providerLabel?.toLowerCase().includes('chatgpt') === true
  );
}

export function shouldUseStandaloneChatGptJudge(
  judgeModel: string | undefined,
  agentProvider?: GoalJudgeProviderInfo,
  currentClient?: GoalJudgeClientLike | null
): boolean {
  if (!isChatGptJudgeModel(judgeModel)) return false;
  if (isChatGptProvider(agentProvider)) return false;
  const currentModel = currentClient?.getCurrentModel?.();
  return !isChatGptJudgeModel(currentModel);
}

export async function createStandaloneChatGptJudgeClient(
  judgeModel: string
): Promise<CodeBuddyClient> {
  const { hasCodexCredentials } = await import('../providers/codex-oauth.js');
  if (!hasCodexCredentials()) {
    throw new Error(`ChatGPT judge model ${judgeModel} requires \`buddy login chatgpt\` first.`);
  }

  return new CodeBuddyClient(CHATGPT_OAUTH_SENTINEL, judgeModel, CHATGPT_RESPONSES_BASE_URL);
}

export async function resolveGoalJudgeClient<T extends GoalJudgeClientLike | null>(
  currentClient: T,
  judgeModel: string | undefined,
  agentProvider?: GoalJudgeProviderInfo
): Promise<T | CodeBuddyClient> {
  if (judgeModel && shouldUseStandaloneChatGptJudge(judgeModel, agentProvider, currentClient)) {
    return createStandaloneChatGptJudgeClient(judgeModel);
  }
  return currentClient;
}

export async function resolveGoalJudgeClientFailOpen<T extends GoalJudgeClientLike | null>(
  currentClient: T,
  judgeModel: string | undefined,
  agentProvider?: GoalJudgeProviderInfo
): Promise<T | CodeBuddyClient | null> {
  if (judgeModel && shouldUseStandaloneChatGptJudge(judgeModel, agentProvider, currentClient)) {
    try {
      return await createStandaloneChatGptJudgeClient(judgeModel);
    } catch {
      return null;
    }
  }
  return currentClient;
}
