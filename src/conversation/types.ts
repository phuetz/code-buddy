/** Shared, transport-agnostic conversation primitives used by voice and Cowork. */

export type DialogueAct =
  | 'phatic'
  | 'backchannel'
  | 'question'
  | 'fresh_information'
  | 'action'
  | 'emotional_disclosure'
  | 'opinion'
  | 'agreement'
  | 'disagreement'
  | 'clarification'
  | 'correction'
  | 'closing';

export type ConversationDepth = 'brief' | 'standard' | 'developed' | 'deliberative';

export type DiscourseMove =
  | 'acknowledge'
  | 'reflect'
  | 'clarify'
  | 'direct_answer'
  | 'position'
  | 'reason'
  | 'evidence'
  | 'example'
  | 'significance'
  | 'counterpoint'
  | 'concession'
  | 'synthesis'
  | 'freshness'
  | 'source'
  | 'invitation';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationAnalysis {
  act: DialogueAct;
  depth: ConversationDepth;
  needsFreshContext: boolean;
  isEmotional: boolean;
  isFollowUp: boolean;
  confidence: number;
  salientTerms: string[];
}

export interface ConversationPlan {
  analysis: ConversationAnalysis;
  /** Convenient aliases for consumers that only need the routing decision. */
  act: DialogueAct;
  depth: ConversationDepth;
  moves: DiscourseMove[];
  minSentences: number;
  maxSentences: number;
  targetTokens: number;
  askFollowUp: boolean;
  guidance: string;
}

export interface CommonGroundSnapshot {
  focus: string[];
  accepted: string[];
  disputed: string[];
  openQuestions: string[];
  recentTurns: ConversationTurn[];
}

export interface ConversationReply {
  speech: string;
  text?: string;
  intent: DialogueAct;
  depth: ConversationDepth;
  route: 'instant' | 'companion' | 'grounded' | 'fresh-cache' | 'fallback';
  citations?: Array<{
    title: string;
    url: string;
    source?: string;
    publishedAt?: string;
  }>;
  freshness?: {
    fetchedAt: number;
    state: 'fresh' | 'stale';
  };
  recoverableError?: string;
}
