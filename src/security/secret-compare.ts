import * as crypto from 'crypto';

/**
 * Compare deux secrets de manière sécurisée (temps constant)
 * pour éviter les attaques temporelles.
 *
 * @param a - Le premier secret (généralement le secret attendu)
 * @param b - Le deuxième secret (généralement le jeton reçu)
 * @returns true si les deux secrets sont des chaînes de caractères identiques, false sinon
 */
export function secretsEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();

  return crypto.timingSafeEqual(hashA, hashB);
}
