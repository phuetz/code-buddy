/**
 * IPC surface for the Video Studio (prompt→video). `film.produce` runs the
 * pipeline and streams `film.progress` events back to the calling webContents.
 * Side-effect free: the integrator calls `registerFilmIpc` after creating the
 * service.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { FilmProduceRequest, FilmService } from './film-service.js';

export const FILM_CHANNELS = {
  produce: 'film.produce',
  progress: 'film.progress',
} as const;

export function registerFilmIpc(ipcMain: Pick<IpcMain, 'handle'>, service: FilmService): void {
  ipcMain.handle(
    FILM_CHANNELS.produce,
    async (event: IpcMainInvokeEvent, req: FilmProduceRequest) => {
      const wc = event.sender;
      return service.produceFromPrompt(req ?? { pitch: '' }, (p) => {
        try {
          wc.send(FILM_CHANNELS.progress, p);
        } catch {
          /* renderer gone */
        }
      });
    }
  );
}
