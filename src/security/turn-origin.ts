/**
 * Where the current agent turn comes from, scoped to its async context.
 *
 * A voice turn is started by speech the microphone HEARD: the television, a
 * guest or the robot's own voice can produce it, and nobody is at a terminal to
 * confirm anything. Policies that are right for an interactive coding session
 * (run workspace mutations in the sandbox without a prompt) are wrong there, so
 * they need to know the origin. AsyncLocalStorage keeps it local to the turn:
 * concurrent code, Cowork, HTTP and fleet sessions are unaffected.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type TurnOrigin = 'voice';

const originContext = new AsyncLocalStorage<TurnOrigin>();

export function withTurnOriginAsync<T>(origin: TurnOrigin, fn: () => Promise<T>): Promise<T> {
  return originContext.run(origin, fn);
}

export function getTurnOrigin(): TurnOrigin | undefined {
  return originContext.getStore();
}
