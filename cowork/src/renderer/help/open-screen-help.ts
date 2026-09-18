import { useAppStore } from '../store';

/** Open the help index (F1 / titlebar Documentation). */
export function openHelpIndex(): void {
  useAppStore.getState().setShowHelpDocs(true, null);
}

/** Global F1 handler. Returns true when the event was consumed. */
export function handleHelpKeyDown(event: { key: string; preventDefault: () => void }): boolean {
  if (event.key !== 'F1') {
    return false;
  }
  event.preventDefault();
  openHelpIndex();
  return true;
}

/** Open help positioned on a sidebar screen. */
export function openScreenHelp(screenId: string): void {
  useAppStore.getState().setShowHelpDocs(true, screenId);
}

export function closeHelpDocs(): void {
  useAppStore.getState().setShowHelpDocs(false);
}
