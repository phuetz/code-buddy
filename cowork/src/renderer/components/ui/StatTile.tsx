/**
 * StatTile — compact telemetry tile primitive.
 *
 * @module renderer/components/ui/StatTile
 */

import { toneClasses, type UiTone } from '../../utils/ui-tone';

export interface StatTileProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: UiTone;
}

export function StatTile({ label, value, hint, tone = 'default' }: StatTileProps) {
  return (
    <div className={`rounded-lg border p-3 ${toneClasses(tone)}`} data-testid="stat-tile">
      <p className="text-xs opacity-80">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs opacity-80">{hint}</p>}
    </div>
  );
}
