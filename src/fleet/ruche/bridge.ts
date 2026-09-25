import { registerPeerMethod, unregisterPeerMethod } from '../../server/websocket/peer-method-registry.js';
import { assertRucheEnabled, rucheEnabled, type RucheEvent, type RucheJournal } from './journal.js';
import { withLocalRuche } from './local-store.js';

export const RUCHE_PULL_METHOD = 'peer.ruche.pull';
export const RUCHE_BAIL_METHOD = 'peer.ruche.bail';
export const RUCHE_RENEW_METHOD = 'peer.ruche.renew';
export const RUCHE_RELEASE_METHOD = 'peer.ruche.release';
export const RUCHE_EVENT_METHOD = 'peer.ruche.event';
let wired = false;

function requestEvent(params: Record<string, unknown>): RucheEvent {
  if (params.event === null || typeof params.event !== 'object' || Array.isArray(params.event)
    || JSON.stringify(params.event).length > 16_384) {
    throw new Error('RUCHE_INVALID_EVENT');
  }
  return params.event as RucheEvent;
}

export function pullRuchePage(journal: RucheJournal, author: string, afterSeq: number, limit = 100): RucheEvent[] {
  assertRucheEnabled();
  if (!/^[A-Za-z0-9_-]{12}$/.test(author) || !Number.isSafeInteger(afterSeq) || afterSeq < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('RUCHE_INVALID_CURSOR');
  }
  return journal.events(author).filter((event) => event.seq > afterSeq).slice(0, limit);
}

export function ingestRuchePage(journal: RucheJournal, page: readonly unknown[]): number {
  assertRucheEnabled();
  if (page.length > 100) throw new Error('RUCHE_PAGE_TOO_LARGE');
  for (const event of page) journal.ingest(event);
  return page.length;
}

/** No method is registered while disabled, preserving the fleet surface. */
export function wireRucheBridge(): void {
  if (wired || !rucheEnabled()) return;
  registerPeerMethod(RUCHE_PULL_METHOD, async (params) => withLocalRuche(({ authority }) => {
    const author = params.author;
    if (typeof author !== 'string') throw new Error('RUCHE_INVALID_CURSOR');
    return { events: pullRuchePage(authority.journal, author, Number(params.afterSeq ?? 0), Number(params.limit ?? 100)) };
  }));
  registerPeerMethod(RUCHE_BAIL_METHOD, async (params) => withLocalRuche((state) => {
    const decision = state.authority.requestLease(requestEvent(params));
    state.persist();
    return decision;
  }));
  registerPeerMethod(RUCHE_RENEW_METHOD, async (params) => withLocalRuche((state) => {
    const decision = state.authority.renew(requestEvent(params));
    state.persist();
    return decision;
  }));
  registerPeerMethod(RUCHE_RELEASE_METHOD, async (params) => withLocalRuche((state) => {
    const decision = state.authority.release(requestEvent(params));
    state.persist();
    return decision;
  }));
  registerPeerMethod(RUCHE_EVENT_METHOD, async (params) => withLocalRuche((state) => {
    const event = requestEvent(params);
    if (event.type === 'approval.request') state.authority.receiveApprovalRequest(event);
    else if (event.type === 'approval.response') state.authority.receiveApprovalResponse(event);
    else if (event.type === 'heartbeat' || event.type === 'message' || event.type === 'mention') {
      state.authority.journal.ingest(event);
    } else {
      throw new Error('RUCHE_EVENT_METHOD_REFUSED');
    }
    state.persist();
    return { hash: event.hash };
  }));
  wired = true;
}

export function unwireRucheBridge(): void {
  if (!wired) return;
  unregisterPeerMethod(RUCHE_PULL_METHOD);
  unregisterPeerMethod(RUCHE_BAIL_METHOD);
  unregisterPeerMethod(RUCHE_RENEW_METHOD);
  unregisterPeerMethod(RUCHE_RELEASE_METHOD);
  unregisterPeerMethod(RUCHE_EVENT_METHOD);
  wired = false;
}
