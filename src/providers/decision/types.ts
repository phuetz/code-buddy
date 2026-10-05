/**
 * Shapes copied from jaredpalmer/kev kev/api.py at
 * fe64b1274ea7f80d4095866df90666abb03e9cf6 (SystemOneRequest, Noul, Choice, Score,
 * to_answers). No other question type is declared there.
 */

/** kev/api.py MAX_OPTIONS */
export const KEV_MAX_OPTIONS = 255;

/** kev/api.py Question = Noul | Choice | Score. `boolean` is not a type. */
export const KEV_QUESTION_TYPES = ['noul', 'choice', 'score'] as const;
export type KevQuestionType = (typeof KEV_QUESTION_TYPES)[number];

/** kev/api.py SystemOneRequest.model default. */
export const KEV_DEFAULT_MODEL = 'kev-latest';

export interface NoulQuestion {
  type: 'noul';
  instructions?: unknown;
  /** Optional. Keys used by the server are `false` and `true` (question_keys). */
  criteria?: { false?: unknown; true?: unknown } | null;
}

export interface ChoiceQuestion {
  type: 'choice';
  instructions?: unknown;
  /** 1..255 option name → description (JSONContent). Required by Choice._check. */
  criteria: Record<string, unknown>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions?: unknown;
  /** Ordered level descriptions, length 1..255. Required by Score. */
  criteria: unknown[];
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** kev/api.py SystemOneRequest. */
export interface DecisionSystemOneRequest {
  state: unknown;
  model?: string;
  questions: Record<string, DecisionQuestion>;
}

/** to_answers noul branch: `noul` is round_prob(p[1]), p(true). */
export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

/** to_answers choice branch. `choice` is the argmax key, not a probability. */
export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

/**
 * to_answers score branch. `score` is the expected level index (sum i*pi),
 * not a probability. `confidence` is score_confidence, also not a probability.
 */
export interface ScoreAnswer {
  type: 'score';
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Server._body in kev/serve.py. Extra truncation fields are ignored. */
export interface DecisionSystemOneResponse {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
}
