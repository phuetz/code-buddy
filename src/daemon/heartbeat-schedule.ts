/**
 * Lightweight due-now filter for HEARTBEAT.md sections.
 * Understands a small FR/EN subset plus a 5-field cron line.
 * Unscheduled text stays due — we only drop clearly off-schedule blocks.
 */

export interface HeartbeatClock {
  hour: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  dimanche: 0,
  monday: 1,
  lundi: 1,
  tuesday: 2,
  mardi: 2,
  wednesday: 3,
  mercredi: 3,
  thursday: 4,
  jeudi: 4,
  friday: 5,
  vendredi: 5,
  saturday: 6,
  samedi: 6,
};

function clockFrom(date: Date): HeartbeatClock {
  return { hour: date.getHours(), weekday: date.getDay() };
}

function parseHour(text: string): number | null {
  const match = text.match(/\b([01]?\d|2[0-3])(?:[:hH]([0-5]\d))?\b/);
  if (!match) return null;
  return Number(match[1]);
}

function weekdayIn(text: string): number | null {
  const lower = text.toLowerCase();
  for (const [name, value] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}s?\\b`, 'i').test(lower)) return value;
  }
  return null;
}

function cronDue(line: string, clock: HeartbeatClock): boolean | null {
  const match = line.match(/\b(?:SCHEDULE:\s*)?([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9*,/-]+)\b/);
  if (!match) return null;
  const hourField = match[2];
  const dowField = match[5];
  // noUncheckedIndexedAccess : un groupe de capture peut manquer.
  if (hourField === undefined || dowField === undefined) return null;
  const hourOk = hourField === '*' || hourField.split(',').some((part) => Number(part) === clock.hour);
  const dowOk =
    dowField === '*' ||
    dowField.split(',').some((part) => Number(part) === clock.weekday);
  return hourOk && dowOk;
}

export function isHeartbeatSectionDue(section: string, now: Date = new Date()): boolean {
  const clock = clockFrom(now);
  const text = section.toLowerCase();
  const cron = cronDue(section, clock);
  if (cron !== null) return cron;

  if (/every\s+\d+\s+min|toutes? les\s+\d+\s+min|chaque battement|every heartbeat/.test(text)) {
    return true;
  }
  if (/\b(matin|morning)\b/.test(text)) return clock.hour >= 6 && clock.hour < 11;
  if (/\b(soir|evening|bonsoir)\b/.test(text)) return clock.hour >= 18 && clock.hour < 23;

  const day = weekdayIn(text);
  const hour = parseHour(section);
  if (day !== null && hour !== null) return clock.weekday === day && clock.hour === hour;
  if (day !== null) return clock.weekday === day;
  if (hour !== null) return clock.hour === hour;
  return true;
}

export function filterDueHeartbeatChecklist(checklist: string, now: Date = new Date()): string {
  const blocks = checklist
    .split(/\n(?=##\s+|###\s+)/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length <= 1) {
    return isHeartbeatSectionDue(checklist, now) ? checklist : '';
  }
  const due = blocks.filter((block) => isHeartbeatSectionDue(block, now));
  return due.join('\n\n');
}
