export function requireProviderText(providerName: string, text: string | null | undefined): string {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error(`${providerName} returned empty response content`);
  }
  return text;
}
