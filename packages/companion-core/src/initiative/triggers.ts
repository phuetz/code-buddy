/**
 * Why a companion might reach out, scored. One winner per tick — never a queue
 * of pending messages. Ported from the robot's proactive engine, minus the
 * delivery and the persistence.
 *
 * The `inactivity` trigger is the one to watch: it is the shape that becomes
 * shaming if it fires while the user is knowingly away, so the planner's caller
 * suppresses it in that case (`suppressInactivity`).
 *
 * @module initiative/triggers
 */

import { pendingMilestone } from '../relationship/state.js';

export type InitiativeTrigger =
  | 'milestone'
  | 'inactivity'
  | 'followUp'
  | 'encouragement'
  | 'morning'
  | 'evening';

export interface TriggerContext {
  /** Local hour 0–23. */
  hour: number;
  /** Whole days since the first meeting. */
  daysTogether: number;
  /** Whole days since the last confirmed presence. */
  daysSinceLastSeen: number;
  /** Tenure marks already celebrated. */
  celebratedMilestones: readonly number[];
  /** A due « how did it go? » — the followUp source. */
  dueFollowUp?: string | null;
  /** Frustration heard recently → an encouragement opening. */
  recentFrustration?: boolean;
  /** The user is knowingly away: never count the days at them. */
  suppressInactivity?: boolean;
  /** Days without a sighting before a check-in is warranted. */
  inactivityDays?: number;
}

export interface TriggerCandidate {
  trigger: InitiativeTrigger;
  /** Higher wins. */
  priority: number;
  /** Interpolation data for the host's template. */
  data: Record<string, string | number>;
}

export const DEFAULT_INACTIVITY_DAYS = 2;

/** Score the applicable triggers, highest priority first. Pure. */
export function evaluateTriggers(ctx: TriggerContext): TriggerCandidate[] {
  const out: TriggerCandidate[] = [];
  const milestone = pendingMilestone(ctx.daysTogether, ctx.celebratedMilestones);
  if (milestone != null) out.push({ trigger: 'milestone', priority: 0.9, data: { days: milestone } });
  if (!ctx.suppressInactivity && ctx.daysSinceLastSeen >= (ctx.inactivityDays ?? DEFAULT_INACTIVITY_DAYS)) {
    out.push({ trigger: 'inactivity', priority: 0.8, data: { days: ctx.daysSinceLastSeen } });
  }
  if (ctx.dueFollowUp) out.push({ trigger: 'followUp', priority: 0.7, data: { event: ctx.dueFollowUp } });
  if (ctx.recentFrustration) out.push({ trigger: 'encouragement', priority: 0.6, data: {} });
  if (ctx.hour >= 6 && ctx.hour < 10) out.push({ trigger: 'morning', priority: 0.5, data: {} });
  if (ctx.hour >= 19 && ctx.hour < 22) out.push({ trigger: 'evening', priority: 0.5, data: {} });
  return out.sort((a, b) => b.priority - a.priority);
}

/** The single winning trigger, or null when nothing applies. */
export function pickTrigger(ctx: TriggerContext): TriggerCandidate | null {
  return evaluateTriggers(ctx)[0] ?? null;
}

/**
 * Fill `{{key}}` placeholders. Uses a function replacer, so a `$` in the data
 * never triggers `String.replace`'s special-pattern expansion.
 */
export function interpolate(template: string, data: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : '',
  );
}
