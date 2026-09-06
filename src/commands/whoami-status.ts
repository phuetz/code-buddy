export interface WhoamiChatGpt {
  email?: string;
  plan?: string;
  model?: string;
  fedramp?: boolean;
  fallback?: string;
}

export interface WhoamiLocal {
  provider: string;
  model?: string;
  baseURL?: string;
}

export function formatWhoamiStatus(input: {
  chatgpt?: WhoamiChatGpt | null;
  local?: WhoamiLocal | null;
  providerHealth?: string[];
}): string[] {
  const lines: string[] = [];
  const chatgpt = input.chatgpt;
  if (!chatgpt) {
    lines.push('ChatGPT: not connected (run `buddy login` to authenticate)');
  } else {
    lines.push('ChatGPT: ✅ connected');
    if (chatgpt.email) lines.push(`  Account:    ${chatgpt.email}`);
    if (chatgpt.plan) lines.push(`  Plan:       ${chatgpt.plan}`);
    if (chatgpt.fedramp) lines.push('  FedRAMP:    yes');
    if (chatgpt.model) lines.push(`  Model:      ${chatgpt.model}`);
    if (chatgpt.fallback) lines.push(`  Safe fallback: ${chatgpt.fallback}`);
  }

  const local = input.local;
  if (local && (local.provider === 'ollama' || local.provider === 'lmstudio')) {
    const bits = [local.provider];
    if (local.model) bits.push(local.model);
    if (local.baseURL) bits.push(local.baseURL);
    lines.push(`Local: ${bits.join(' · ')}`);
  }

  if (input.providerHealth && input.providerHealth.length > 0) {
    lines.push(...input.providerHealth);
  }

  return lines;
}
