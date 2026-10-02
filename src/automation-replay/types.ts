/** Independently implemented; trace/re-observation idea inspired by tester-army/e2e (Apache-2.0). */
export interface SemanticTarget { role: string; name: string }
export interface SemanticNode extends SemanticTarget {
  ref: number;
  enabled: boolean;
  protected: boolean;
  /** Digest of non-protected input/ARIA state; no plaintext field value. */
  state?: string;
}
export interface Observation {
  context: string;
  text: string;
  nodes: SemanticNode[];
}
export interface SemanticAction {
  kind: 'click' | 'type' | 'press';
  target: SemanticTarget;
  /** Runtime parameter name, never the value. */
  valueKey?: string;
  key?: 'Enter' | 'Tab';
}
export interface RecordedStep { action: SemanticAction; before: string; after: string }
export interface Recording { version: 1; steps: RecordedStep[] }
export interface ReplayHost {
  kind: 'browser' | 'desktop';
  observe(): Promise<Observation>;
  /** Must re-resolve the semantic target and cross the original authorization boundary. */
  perform(action: SemanticAction, values: Record<string, string>): Promise<void>;
}
export interface ModelReply { content: string; tokens?: number }
export type ReplayModel = (system: string, input: string) => Promise<ModelReply>;
export interface ActRequest {
  instruction: string;
  expectedText: string;
  values?: Record<string, string>;
}
