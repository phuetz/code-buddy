import type { BrowserWindow, Tray } from 'electron';

// Références canoniques uniquement : la création et le cycle de vie des
// fenêtres restent dans index.ts afin d'éviter une seconde source de vérité.
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getTray(): Tray | null {
  return tray;
}

export function setTray(nextTray: Tray | null): void {
  tray = nextTray;
}
