import { getGlobalEventBus } from '../events/event-bus.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from '../sensory/reactions.js';
import { CognitiveMesh } from './cognitive-mesh.js';
import { GlobalWorkspace } from './global-workspace.js';
import type { WorkspaceDraft, WorkspaceItem } from './types.js';

export interface SafeSensoryPercept {
  modality: string;
  kind: string;
  observedAt: number;
}

export interface EmbodiedCognitionHandle {
  workspace: GlobalWorkspace;
  mesh: CognitiveMesh;
  close(): void;
}

function worldFact(trigger: WorkspaceItem<SafeSensoryPercept>): WorkspaceDraft | null {
  if (trigger.payload.modality !== 'vision') return null;
  const status =
    trigger.payload.kind === 'person_entered'
      ? 'visible'
      : trigger.payload.kind === 'person_left'
        ? 'absent'
        : null;
  if (!status) return null;
  return {
    kind: 'fact',
    producerId: 'world-model',
    correlationId: trigger.correlationId,
    salience: trigger.salience,
    confidence: trigger.confidence,
    privacy: 'local-only',
    provenance: { source: 'deterministic-vision-transition' },
    ttlMs: status === 'visible' ? 15_000 : 5_000,
    payload: {
      entityId: 'observed-person',
      visibility: status,
      observedAt: trigger.payload.observedAt,
      source: 'vision',
    },
  };
}

/**
 * Shadow-mode adapter: mirrors safe sensory metadata into the cognitive mesh.
 * Raw audio, transcripts, image data, local paths and arbitrary payload fields
 * intentionally never cross this boundary.
 */
export function wireSensoryWorkspace(options: {
  workspace?: GlobalWorkspace;
  mesh?: CognitiveMesh;
} = {}): EmbodiedCognitionHandle {
  const workspace = options.workspace ?? new GlobalWorkspace();
  const mesh = options.mesh ?? new CognitiveMesh(workspace);
  mesh.register({
    id: 'world-model',
    role: 'deterministic embodied state reducer',
    subscriptions: ['percept'],
    mailboxCapacity: 32,
    overflow: 'coalesce-latest',
    activate: async ({ trigger }) => {
      const fact = worldFact(trigger as WorkspaceItem<SafeSensoryPercept>);
      return fact ? [fact] : [];
    },
  });

  let sequence = 0;
  const listenerId = getGlobalEventBus().on('sensory:perception', (event: BaseEvent) => {
    const perception = perceptionOf(event);
    if (!perception.modality || !perception.kind) return;
    const observedAt = perception.tsMs ?? perception.receivedAt ?? event.timestamp;
    mesh.publish<SafeSensoryPercept>({
      kind: 'percept',
      producerId: `sense:${perception.modality}`,
      correlationId: `sensory:${event.timestamp}:${++sequence}`,
      salience: Math.max(0, Math.min(1, (perception.salience ?? 0) / 255)),
      confidence: 1,
      privacy: 'local-only',
      provenance: { source: 'sensory-bridge' },
      ttlMs: 10_000,
      payload: {
        modality: perception.modality,
        kind: perception.kind,
        observedAt,
      },
    });
  });

  return {
    workspace,
    mesh,
    close: () => {
      getGlobalEventBus().off(listenerId);
      mesh.stop();
    },
  };
}
