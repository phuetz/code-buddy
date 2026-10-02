import { AsyncLocalStorage } from 'node:async_hooks';
import type { CodeBuddyToolCall } from '../../codebuddy/client.js';

/** Correlate nested permission/file requests even for concurrent read tools. */
export const toolCallContext = new AsyncLocalStorage<CodeBuddyToolCall>();
