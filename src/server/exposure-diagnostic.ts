import { isLoopbackHost } from './origin-check.js';

export const UNAUTHENTICATED_NETWORK_BIND_CODE =
  'SERVER_UNAUTHENTICATED_NETWORK_BIND' as const;

export interface ServerExposureInput {
  host: string;
  authEnabled: boolean;
}

export interface ServerExposureDiagnostic {
  code: typeof UNAUTHENTICATED_NETWORK_BIND_CODE | null;
  status: 'ok' | 'warn';
  host: string;
  authEnabled: boolean;
  loopback: boolean;
  networkExposed: boolean;
  unsafe: boolean;
  message: string;
  recommendations: string[];
}

const LOCAL_ONLY_RECOMMENDATION =
  'For local-only use, bind to loopback with `--host 127.0.0.1 --no-auth` ' +
  '(or set `HOST=127.0.0.1`).';

const REMOTE_FLEET_RECOMMENDATION =
  'For intentional Fleet/A2A remote access, keep the non-loopback bind, remove ' +
  '`--no-auth`, and configure the same `JWT_SECRET` plus peer credentials on every participant.';

/**
 * Diagnose the one server exposure combination that is never safe by itself:
 * an unauthenticated listener reachable beyond the local machine.
 *
 * The diagnostic is deliberately non-blocking. Fleet/A2A deployments may bind
 * to a LAN or tailnet address explicitly; they remain supported when JWT auth
 * and the peer credentials are configured.
 */
export function diagnoseServerExposure(input: ServerExposureInput): ServerExposureDiagnostic {
  const host = input.host.trim();
  const loopback = isLoopbackHost(host);
  const networkExposed = !loopback;
  const unsafe = networkExposed && !input.authEnabled;

  if (unsafe) {
    const recommendations = [LOCAL_ONLY_RECOMMENDATION, REMOTE_FLEET_RECOMMENDATION];
    return {
      code: UNAUTHENTICATED_NETWORK_BIND_CODE,
      status: 'warn',
      host,
      authEnabled: false,
      loopback,
      networkExposed,
      unsafe,
      message:
        `[${UNAUTHENTICATED_NETWORK_BIND_CODE}] Code Buddy is listening on non-loopback ` +
        `host "${host || '(empty host)'}" with authentication disabled. CORS does not protect ` +
        `against non-browser clients. ${recommendations.join(' ')}`,
      recommendations,
    };
  }

  const message = loopback
    ? `Server bind ${host || '(empty host)'} is loopback-only${
        input.authEnabled ? ' with authentication enabled' : ''
      }.`
    : `Server bind ${host || '(empty host)'} is network-reachable with authentication enabled.`;

  return {
    code: null,
    status: 'ok',
    host,
    authEnabled: input.authEnabled,
    loopback,
    networkExposed,
    unsafe,
    message,
    recommendations: [],
  };
}
