/**
 * Track System Types
 * Inspired by Conductor's spec-driven development approach
 */

export type TrackType = 'feature' | 'bugfix' | 'refactor' | 'docs' | 'chore';
export type TrackStatus = 'planning' | 'in_progress' | 'blocked' | 'completed' | 'archived';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface TrackMetadata {
  id: string;
  name: string;
  type: TrackType;
  status: TrackStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  description?: string;
  tags?: string[];
  progress: {
    totalTasks: number;
    completedTasks: number;
    percentage: number;
  };
}

export interface TrackTask {
  id: string;
  title: string;
  status: TaskStatus;
  commitSha?: string;
  subtasks?: TrackTask[];
}

export interface TrackPhase {
  id: string;
  title: string;
  tasks: TrackTask[];
  checkpointSha?: string;
}

export interface TrackPlan {
  phases: TrackPhase[];
  workflow?: string;
}

export interface TrackSpec {
  overview: string;
  requirements: string[];
  acceptanceCriteria: string[];
  outOfScope?: string[];
  dependencies?: string[];
  technicalNotes?: string;
}

export interface Track {
  metadata: TrackMetadata;
  spec: TrackSpec;
  plan: TrackPlan;
}

export interface ProjectContext {
  product?: string;
  techStack?: string;
  guidelines?: string;
  workflow?: string;
}

export interface TrackCreateOptions {
  name: string;
  type: TrackType;
  description?: string;
  generatePlan?: boolean;
}

export interface TrackListOptions {
  status?: TrackStatus;
  type?: TrackType;
  limit?: number;
}
