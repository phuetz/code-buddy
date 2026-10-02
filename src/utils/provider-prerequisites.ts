/** Actionable prerequisite shared by inference surfaces without a provider. */
export const PROVIDER_SETUP_MESSAGE =
  'No LLM provider configured. Run `buddy login`, configure local Ollama, or set a provider API key.';

/** A missing client does not prove that provider configuration is absent. */
export const PEER_CLIENT_UNAVAILABLE_MESSAGE =
  'LLM client unavailable on this peer. Check the server startup logs and provider connection. ' +
  'If no provider is configured, run `buddy login`, configure local Ollama, or set a provider API key.';
