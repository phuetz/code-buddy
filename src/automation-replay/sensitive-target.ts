/** Controls whose contents must never be recorded or replayed. */
export function sensitiveTarget(name: string): boolean {
  return /password|mot de passe|secret|token|cvv|\bpin\b|\botp\b|iban|verification code|code de v[ée]rification|one.time/i.test(name);
}
