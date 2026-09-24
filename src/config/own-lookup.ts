/**
 * Lecture par nom. `Object.hasOwn` ignore toString, valueOf, constructor,
 * __proto__ et hasOwnProperty hérités du prototype.
 */
export function ownValue<T>(record: object | null | undefined, key: string): T | undefined {
  if (record == null || typeof record !== 'object') return undefined;
  if (!Object.hasOwn(record, key)) return undefined;
  return (record as Record<string, T>)[key];
}
