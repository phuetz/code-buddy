/**
 * Council fleet peers — fold other machines' Code Buddy into the panel.
 *
 * @module council/peers
 */

import { sanitizePeerText } from '../fleet/peer-text-sanitizer.js';
import type { CouncilPeer, GatherPeerAnswersOptions, PeerAnswer } from './types.js';

/**
 * Ask each connected fleet peer via `peer.chat` (parallel, per-peer timeout). The caller may
 * specialize each prompt with a conductor role. A slow/absent/failing peer is dropped into
 * `errors` — never crashing the council. The returned answers are structurally the council's own
 * Answer shape, so they fold into the SAME judged set.
 */
export async function gatherPeerAnswers(
  task: string,
  peers: CouncilPeer[],
  timeoutMs: number,
  options: GatherPeerAnswersOptions = {},
): Promise<{ answers: PeerAnswer[]; errors: Array<{ id: string; message: string }> }> {
  const settled = await Promise.allSettled(
    peers.map(async (p, index): Promise<PeerAnswer> => {
      const t0 = Date.now();
      const prompt = options.promptForPeer?.(p, index) ?? task;
      const resp = (await p.listener.request('peer.chat', { prompt }, { timeoutMs })) as {
        text?: string;
        modelRequested?: string;
        usage?: { total_tokens?: number };
      };
      // A peer is another machine we do not control: its prose is sanitized at
      // the door, exactly like local model answers (council-engine.ts). Without
      // this, a peer could smuggle <think>/<|im_start|>/[INST]/<<SYS>> or
      // zero-width characters into the judge prompt built below.
      const content = sanitizePeerText(resp?.text).trim();
      if (!content) throw new Error('réponse vide');
      return {
        modelId: p.id,
        modelName: `${p.id}:${resp.modelRequested ?? 'peer'}`,
        content,
        latency: Date.now() - t0,
        tokensUsed: resp.usage?.total_tokens ?? 0,
        // peer.chat does not report the peer-side marginal cost — recorded as 0,
        // an acknowledged blind spot (a peer may itself route to a paid cloud model).
        cost: 0,
        role: options.roleForPeer?.(p, index),
      };
    }),
  );
  const answers: PeerAnswer[] = [];
  const errors: Array<{ id: string; message: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') answers.push(s.value);
    else errors.push({ id: peers[i]!.id, message: s.reason instanceof Error ? s.reason.message : String(s.reason) });
  });
  return { answers, errors };
}
