export interface CliModelListItem {
  id: string;
  owned_by?: string;
}

export interface CliModelListResult {
  models: CliModelListItem[];
  source: 'chatgpt-oauth' | 'openai-compatible';
}

export interface CliModelListOptions {
  baseURL: string;
  provider?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
}

function isChatGptCodexBaseURL(baseURL: string): boolean {
  return baseURL.includes('chatgpt.com/backend-api/codex');
}

export function shouldUseStaticChatGptModels(options: Pick<CliModelListOptions, 'baseURL' | 'provider'>): boolean {
  return options.provider === 'chatgpt' || isChatGptCodexBaseURL(options.baseURL);
}

export function getStaticChatGptModels(defaultModel?: string): CliModelListItem[] {
  return [
    {
      id: defaultModel || 'gpt-5.5',
      owned_by: 'chatgpt',
    },
  ];
}

function joinBaseUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function resolveCliModelList(options: CliModelListOptions): Promise<CliModelListResult> {
  if (shouldUseStaticChatGptModels(options)) {
    return {
      source: 'chatgpt-oauth',
      models: getStaticChatGptModels(options.defaultModel),
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(joinBaseUrl(options.baseURL, 'models'));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as { data?: CliModelListItem[] };
  return {
    source: 'openai-compatible',
    models: data.data ?? [],
  };
}
