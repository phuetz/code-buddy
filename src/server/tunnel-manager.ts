import { logger } from '../utils/logger.js';

export interface TunnelOptions {
  port: number;
  authtoken?: string;
  domain?: string;
}

/** Contrat minimal du listener ngrok, pour ne pas dependre du type au chargement. */
interface NgrokListener {
  url: () => string | null;
  close: () => Promise<void>;
}

interface NgrokModule {
  forward: (options: Record<string, unknown>) => Promise<NgrokListener>;
}

/**
 * Charge @ngrok/ngrok a la demande.
 *
 * Le paquet est une dependance normale, mais son binaire natif par plateforme
 * (@ngrok/ngrok-linux-x64-gnu et consorts) est une dependance OPTIONNELLE de sa
 * part. Une installation qui omet les optionnelles obtient donc le module sans
 * son binaire — et un import statique faisait planter le processus au simple
 * chargement de ce fichier, avant meme qu'on demande un tunnel.
 */
async function chargerNgrok(): Promise<NgrokModule> {
  try {
    return (await import('@ngrok/ngrok')) as unknown as NgrokModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Les tunnels demandent @ngrok/ngrok et son binaire natif, absents de cette " +
        'installation. Installez-les avec : npm install @ngrok/ngrok. ' +
        `(cause : ${detail})`,
    );
  }
}

export class TunnelManager {
  private static listener: NgrokListener | null = null;

  /**
   * Start an ngrok tunnel forwarding to the specified port.
   */
  static async startTunnel(options: TunnelOptions): Promise<string> {
    if (this.listener) {
      logger.warn('A tunnel is already running. Disconnecting existing tunnel.');
      await this.stopTunnel();
    }

    try {
      logger.info(`Starting ngrok tunnel for port ${options.port}...`);
      
      const ngrokOptions: any = {
        addr: options.port,
        authtoken_from_env: true,
      };

      if (options.authtoken) {
        ngrokOptions.authtoken = options.authtoken;
      }
      if (options.domain) {
        ngrokOptions.domain = options.domain;
      }

      const ngrok = await chargerNgrok();
      this.listener = await ngrok.forward(ngrokOptions);
      const url = this.listener.url() ?? '';
      logger.info(`ngrok tunnel established at: ${url}`);
      return url;
    } catch (error) {
      logger.error('Failed to start ngrok tunnel', { error });
      throw error;
    }
  }

  /**
   * Stop the active ngrok tunnel.
   */
  static async stopTunnel(): Promise<void> {
    if (this.listener) {
      try {
        await this.listener.close();
        this.listener = null;
        logger.info('ngrok tunnel closed.');
      } catch (error) {
        logger.error('Failed to close ngrok tunnel', { error });
        throw error;
      }
    }
  }

  /**
   * Get the URL of the currently active tunnel, if any.
   */
  static getActiveTunnelUrl(): string | null {
    return this.listener ? this.listener.url() ?? null : null;
  }
}
