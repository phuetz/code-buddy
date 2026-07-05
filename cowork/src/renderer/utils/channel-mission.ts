/**
 * Pure validation for channel-assigned missions.
 *
 * @module renderer/utils/channel-mission
 */

export type ChannelKind = 'whatsapp' | 'telegram' | 'slack' | 'teams';
export type ChannelPosture = 'plan' | 'auto' | 'full';

export interface ChannelRef {
  id: string;
  label: string;
  kind: ChannelKind;
}

export interface ChannelAssignmentInput {
  channelId: string;
  goal: string;
  posture: ChannelPosture;
}

export function validateAssignment(input: ChannelAssignmentInput): { ok: boolean; error?: string } {
  if (!input.channelId.trim()) return { ok: false, error: 'channel_required' };
  if (input.goal.trim().length < 4) return { ok: false, error: 'goal_too_short' };
  if (!['plan', 'auto', 'full'].includes(input.posture)) return { ok: false, error: 'posture_invalid' };
  return { ok: true };
}
