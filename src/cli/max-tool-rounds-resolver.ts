export function resolveMaxToolRounds(optionValue: string | undefined): number | undefined {
  if (!optionValue) return undefined;
  if (!/^[1-9]\d*$/.test(optionValue)) return undefined;
  const parsed = Number(optionValue);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return parsed;
}
