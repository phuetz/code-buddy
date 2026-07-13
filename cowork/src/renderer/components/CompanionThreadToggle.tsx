import { useState } from 'react';
import { HeartHandshake, Loader2 } from 'lucide-react';
import type { Session } from '../types';
import {
  isCompanionThreadTags,
  setCompanionThreadLinked,
} from '../../shared/companion-thread';
import { useAppStore } from '../store';
import { Tooltip } from './Tooltip';

interface CompanionThreadToggleProps {
  session: Session;
  updateTags: (tags: string[]) => Promise<boolean>;
}

/** Visible, per-session consent for joining Lisa's private cross-surface thread. */
export function CompanionThreadToggle({
  session,
  updateTags,
}: CompanionThreadToggleProps) {
  const [saving, setSaving] = useState(false);
  const linked = isCompanionThreadTags(session.tags);
  const tooltip = linked
    ? 'Cette session continue le même fil que la voix et Telegram. Cliquer pour l’isoler.'
    : 'Relier uniquement cette session au fil privé voix ↔ Telegram de Lisa.';

  const toggle = async (): Promise<void> => {
    if (saving) return;
    const previous = [...(session.tags ?? [])];
    const next = setCompanionThreadLinked(previous, !linked);
    setSaving(true);
    try {
      const persisted = await updateTags(next);
      if (!persisted) {
        useAppStore.getState().updateSession(session.id, { tags: previous });
      }
    } catch {
      useAppStore.getState().updateSession(session.id, { tags: previous });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tooltip label={tooltip} side="bottom">
      <button
        type="button"
        aria-label={linked ? 'Isoler cette session de Lisa' : 'Continuer cette session avec Lisa'}
        aria-pressed={linked}
        disabled={saving}
        onClick={() => void toggle()}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
          linked
            ? 'border border-rose-400/25 bg-rose-400/12 text-rose-300 hover:bg-rose-400/18'
            : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        }`}
      >
        {saving
          ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          : <HeartHandshake size={12} aria-hidden="true" />}
        <span>Lisa</span>
      </button>
    </Tooltip>
  );
}
