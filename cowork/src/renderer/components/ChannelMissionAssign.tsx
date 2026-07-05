/**
 * ChannelMissionAssign — assign a mission from a connected messaging channel.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/ChannelMissionAssign
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Shield, Smartphone } from 'lucide-react';
import {
  validateAssignment,
  type ChannelAssignmentInput,
  type ChannelPosture,
  type ChannelRef,
} from '../utils/channel-mission';

export interface ChannelMissionAssignProps {
  channels: ChannelRef[];
  onAssign: (assignment: ChannelAssignmentInput) => void;
}

const POSTURES: ChannelPosture[] = ['plan', 'auto', 'full'];

export function ChannelMissionAssign({ channels, onAssign }: ChannelMissionAssignProps) {
  const { t } = useTranslation();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [goal, setGoal] = useState('');
  const [posture, setPosture] = useState<ChannelPosture>('plan');
  const assignment = useMemo(() => ({ channelId, goal, posture }), [channelId, goal, posture]);
  const validation = validateAssignment(assignment);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="channel-mission-assign">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <Smartphone aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.channel.title', 'Assigner depuis un canal')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {channels.length} canaux disponibles · posture {posture}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor="channel-select">
          {t('genspark.channel.channel', 'Canal')}
          <select
            id="channel-select"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            data-testid="channel-select"
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.label} · {channel.kind}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor="channel-goal">
          {t('genspark.channel.goal', 'Mission')}
          <textarea
            id="channel-goal"
            className="min-h-24 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            data-testid="channel-goal"
            placeholder={t('genspark.channel.placeholder', 'Décris la mission à confier à l’employé IA...')}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t('genspark.channel.posture', 'Posture')}</p>
          <div className="flex flex-wrap gap-2">
            {POSTURES.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={posture === item}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                  posture === item
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                data-testid={`channel-posture-${item}`}
                onClick={() => setPosture(item)}
              >
                <Shield aria-hidden="true" className="h-3.5 w-3.5" />
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {validation.ok ? t('genspark.channel.ready', 'Mission prête à assigner.') : validation.error}
          </p>
          <button
            type="button"
            aria-label={t('genspark.channel.assign', 'Assigner la mission')}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="channel-assign"
            disabled={!validation.ok}
            onClick={() => onAssign(assignment)}
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            {t('genspark.channel.assign', 'Assigner')}
          </button>
        </div>
      </div>
    </section>
  );
}
