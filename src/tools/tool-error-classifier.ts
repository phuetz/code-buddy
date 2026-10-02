/** Tool failures with a stable cause, separate from provider transport errors. */
export function classifyToolFailure(error: string | undefined) {
  if (!error) return { code: 'TOOL_FAILURE', retryable: false, terminal: false };
  if (/Approval requires an interactive terminal or configured remote approval channel/i.test(error)) {
    return { code: 'APPROVAL_UNAVAILABLE', retryable: false, terminal: true };
  }
  if (/protected path|credential\/secret|not in a trusted directory|blocked by.*policy/i.test(error)) {
    return { code: 'CAPABILITY_DENIED', retryable: false, terminal: false };
  }
  if (/EAI_AGAIN|ECONNRESET|ETIMEDOUT/.test(error)) return { code: 'TOOL_NETWORK', retryable: true, terminal: false };
  return { code: 'TOOL_FAILURE', retryable: false, terminal: false };
}
