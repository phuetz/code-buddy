export type VideoExperimentReviewStatus =
  | 'candidate'
  | 'planned'
  | 'running'
  | 'validated'
  | 'rejected';

export interface VideoExperimentEvidence {
  t_start: number;
  t_end: number;
  transcript: string;
}

export interface VideoExperimentView {
  key: string;
  id: string;
  title: string;
  category: string;
  verificationStatus: 'unverified';
  confidence: 'low' | 'medium';
  evidence: VideoExperimentEvidence;
  namesToVerify: string[];
  links: string[];
  requirements: string[];
  risks: string[];
  minimumExperiment: string;
  source: string;
  method: string;
  artifactPath: string;
  discoveredAt: string;
  reviewStatus: VideoExperimentReviewStatus;
  reviewNote?: string;
  reviewedAt?: string;
}

export interface VideoExperimentSummary {
  total: number;
  sources: number;
  byStatus: Record<VideoExperimentReviewStatus, number>;
  roots: string[];
  reviewStorePath: string;
  skippedArtifacts: number;
}

export interface VideoExperimentListResult {
  experiments: VideoExperimentView[];
  summary: VideoExperimentSummary;
}

export interface VideoExperimentReviewInput {
  cwd?: string;
  key: string;
  status: VideoExperimentReviewStatus;
  note?: string;
}

export interface VideoExperimentReviewResult {
  ok: boolean;
  error?: string;
  review?: {
    status: VideoExperimentReviewStatus;
    note?: string;
    reviewedAt: string;
  };
}

export const VIDEO_EXPERIMENT_STATUSES: readonly VideoExperimentReviewStatus[] = [
  'candidate',
  'planned',
  'running',
  'validated',
  'rejected',
];
