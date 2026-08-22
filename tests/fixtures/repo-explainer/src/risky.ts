export function evaluateRequest(value: number): string {
  if (value < 0) return 'invalid';
  if (value === 0) return 'empty';
  if (value > 100) return 'large';
  return 'accepted';
}
