export function getOllamaBaseUrl(env?: NodeJS.ProcessEnv): string {
  const envSource = env ?? process.env;
  let host = envSource.OLLAMA_HOST?.trim() || envSource.OLLAMA_BASE_URL?.trim();
  if (!host) {
    return 'http://127.0.0.1:11434';
  }
  if (!/^https?:\/\//i.test(host)) {
    host = `http://${host}`;
  }
  return host.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export function getOllamaV1BaseUrl(env?: NodeJS.ProcessEnv): string {
  return `${getOllamaBaseUrl(env)}/v1`;
}
