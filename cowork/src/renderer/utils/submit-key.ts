/**
 * Loi unique des champs de saisie de Cowork (plan 2.4, E2) : Entrée envoie,
 * Maj+Entrée va à la ligne. Une touche Entrée qui valide une composition IME
 * n'envoie pas : `isComposing` est le signal standard, et certains claviers
 * (Android, quelques compositions Safari) livrent à la place `keyCode` 229.
 */
export interface SubmitKeyEvent {
  key: string;
  shiftKey: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}

export function isSubmitEnter(event: SubmitKeyEvent): boolean {
  if (event.key !== 'Enter' || event.shiftKey) return false;
  if (event.nativeEvent?.isComposing) return false;
  if (event.keyCode === 229) return false;
  return true;
}
