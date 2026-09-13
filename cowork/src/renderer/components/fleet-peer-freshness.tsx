/**
 * "Last seen" label and silence note for a Fleet peer, driven by the shared
 * clock so they keep ageing between events. Mount them only where they are
 * visible: every mounted label holds a subscription to the shared timer.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSharedNow } from '../hooks/use-shared-now';
import type { FleetPeer } from '../types';
import {
  FLEET_HEARTBEAT_INTERVAL_MS,
  FLEET_SILENCE_THRESHOLD_MS,
  describePeerFreshness,
  toSeenAge,
  type PeerFreshness,
  type SeenAge,
} from '../utils/fleet-freshness';

type FreshnessPeer = Pick<FleetPeer, 'id' | 'status' | 'lastSeenAt'>;
type Translate = ReturnType<typeof useTranslation>['t'];

function formatSeenAge(age: SeenAge, t: Translate): string {
  switch (age.unit) {
    case 'justNow':
      return t('fleet.freshness.justNow', 'just now');
    case 'seconds':
      return t('fleet.freshness.secondsAgo', '{{count}}s ago', { count: age.count });
    case 'minutes':
      return t('fleet.freshness.minutesAgo', '{{count}}m ago', { count: age.count });
    case 'hours':
      return t('fleet.freshness.hoursAgo', '{{count}}h ago', { count: age.count });
    case 'days':
      return t('fleet.freshness.daysAgo', '{{count}}d ago', { count: age.count });
  }
}

function usePeerFreshness(peer: FreshnessPeer): {
  freshness: PeerFreshness;
  label: string;
  hint?: string;
} {
  const { t } = useTranslation();
  const now = useSharedNow();
  const freshness = describePeerFreshness(peer, now);
  switch (freshness.kind) {
    case 'never':
      return {
        freshness,
        label: t('fleet.freshness.noEventsYet', 'no events yet'),
        hint: t(
          'fleet.freshness.noEventsHint',
          'No heartbeat or event received from this peer yet.'
        ),
      };
    case 'invalid':
      return {
        freshness,
        label: t('fleet.freshness.unknownTime', 'unknown'),
        hint: t(
          'fleet.freshness.unknownHint',
          "The last-seen time is invalid or ahead of this computer's clock."
        ),
      };
    case 'seen':
      return { freshness, label: formatSeenAge(toSeenAge(freshness.ageMs), t) };
    case 'silent': {
      const ago = formatSeenAge(toSeenAge(freshness.ageMs), t);
      return {
        freshness,
        label: `${t('fleet.freshness.silent', 'silent')} · ${ago}`,
        hint: t(
          'fleet.freshness.silentHint',
          'Still authenticated, but nothing received for over {{threshold}} s (last event {{ago}}; peers send a heartbeat every {{heartbeat}} s). The link may be stale.',
          {
            ago,
            threshold: FLEET_SILENCE_THRESHOLD_MS / 1_000,
            heartbeat: FLEET_HEARTBEAT_INTERVAL_MS / 1_000,
          }
        ),
      };
    }
  }
}

export const PeerSeenLabel: React.FC<{
  peer: FreshnessPeer;
  className?: string;
  /** Tone when the peer is not silent. */
  quietTone?: string;
}> = ({ peer, className = '', quietTone = 'text-text-muted' }) => {
  const { freshness, label, hint } = usePeerFreshness(peer);
  const tone = freshness.kind === 'silent' ? 'text-warning' : quietTone;
  return (
    <span
      data-testid={`fleet-peer-seen-${peer.id}`}
      data-freshness={freshness.kind}
      title={hint}
      className={`${tone} ${className}`.trim()}
    >
      {label}
    </span>
  );
};

/** Explains a silent peer; renders nothing otherwise. */
export const PeerSilenceNote: React.FC<{ peer: FreshnessPeer }> = ({ peer }) => {
  const { freshness, hint } = usePeerFreshness(peer);
  if (freshness.kind !== 'silent') return null;
  return (
    <div
      data-testid={`fleet-peer-silence-${peer.id}`}
      className="rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning"
    >
      {hint}
    </div>
  );
};
