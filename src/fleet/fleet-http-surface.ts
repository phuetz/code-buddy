/**
 * HTTP surface for Fleet peer methods.
 *
 * Only two Express routes exist (`GET /api/fleet/status`,
 * `GET /api/fleet/describe`). Every other `peer.*` method is WebSocket-only
 * until an explicit product decision adds an HTTP wrapper. This catalog is
 * the source of truth that tests the existing routes and names the gap.
 */

/** Peer methods that have an HTTP wrapper under /api/fleet/. */
export const FLEET_HTTP_PEER_METHODS = ['peer.describe'] as const;

/** Diagnostic HTTP routes that are not peer-method wrappers. */
export const FLEET_HTTP_DIAGNOSTIC_ROUTES = ['/api/fleet/status'] as const;

/**
 * Peer methods registered at boot that have no HTTP wrapper.
 * Listed so a new method cannot stay silently WS-only.
 */
export const FLEET_WS_ONLY_PEER_METHODS = [
  'peer.ping',
  'peer.echo',
  'peer.dispatch',
  'peer.dispatchStatus',
  'peer.chat',
  'peer.chat-stream',
  'peer.chat-session.start',
  'peer.chat-session.continue',
  'peer.chat-session.continue-stream',
  'peer.chat-session.list',
  'peer.chat-session.goal',
  'peer.chat-session.end',
  'peer.tool.invoke',
  'peer.tool.invoke.stream',
  'peer.ckg.sync',
  'peer.mission-exchange.describe',
  'peer.mission-exchange.offer',
  'peer.mission-exchange.rank',
] as const;

/**
 * HTTP paths a client might try for WS-only peer methods. None of these
 * are served — they exist so tests can probe the gap instead of only
 * `/chat`, `/tool`, and `/ckg`.
 */
export function fleetWsOnlyHttpPaths(): string[] {
  const paths = new Set<string>();
  for (const method of FLEET_WS_ONLY_PEER_METHODS) {
    const rest = method.slice('peer.'.length);
    if (rest === 'tool.invoke' || rest === 'tool.invoke.stream') {
      paths.add('/api/fleet/tool');
      paths.add(`/api/fleet/${rest.replace(/\./g, '/')}`);
      continue;
    }
    if (rest === 'ckg.sync') {
      paths.add('/api/fleet/ckg');
      paths.add('/api/fleet/ckg/sync');
      continue;
    }
    if (rest === 'chat') {
      paths.add('/api/fleet/chat');
      continue;
    }
    paths.add(`/api/fleet/${rest.replace(/\./g, '/')}`);
  }
  return [...paths];
}

export function fleetHttpDescribeEnvelope(description: Record<string, unknown>): Record<string, unknown> {
  return {
    ...description,
    httpMethods: [...FLEET_HTTP_PEER_METHODS],
    wsOnlyMethods: [...FLEET_WS_ONLY_PEER_METHODS],
    wsOnlyHttpPaths: fleetWsOnlyHttpPaths(),
  };
}
