/** Compact headless turns cannot afford a full workflow for a vague keyword.
 * Keep precise triggers and explicit skill names; full mode retains discovery.
 */
export function matchesCompactSkill(
  query: string,
  skill: { name: string; triggers?: string[] }
): boolean {
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const text = normalize(query);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:^|[^\\w-])${escape(normalize(skill.name))}(?:$|[^\\w-])`).test(text))
    return true;
  return (
    skill.triggers?.some(
      (trigger) => trigger.trim().length > 0 && text.includes(normalize(trigger))
    ) ?? false
  );
}
