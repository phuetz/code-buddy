export function resolveMaxToolRounds(optionValue: string | undefined): number | undefined {
  if (!optionValue) return undefined;
  const normalized = optionValue.trim();
  if (!/^\+?\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}
