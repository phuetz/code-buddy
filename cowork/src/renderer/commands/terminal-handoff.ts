/** Pure text for the Cowork "Continuer dans le terminal" result (P6). */
export function formatHandoffNotice(
  result: { command: string; messageCount: number; redactions: number },
  copied: boolean,
): string {
  const redacted = result.redactions > 0 ? ` ${result.redactions} secret(s) masqué(s).` : '';
  const how = copied ? 'Commande copiée' : 'Commande à coller dans un terminal';
  return `${how} : ${result.command} — ${result.messageCount} message(s) texte exporté(s).${redacted}`;
}
