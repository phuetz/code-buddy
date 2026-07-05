/**
 * Pill — compact semantic label primitive.
 *
 * @module renderer/components/ui/Pill
 */

import type { ReactNode } from 'react';
import { toneClasses, type UiTone } from '../../utils/ui-tone';

export interface PillProps {
  children: ReactNode;
  tone?: UiTone;
}

export function Pill({ children, tone = 'default' }: PillProps) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses(tone)}`}>
      {children}
    </span>
  );
}
