/**
 * MissionTimeline — compact plan-of-flight timeline for agent missions.
 *
 * @module renderer/components/MissionTimeline
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, CircleCheck, CircleX, Loader } from 'lucide-react';

export interface MissionStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  tool?: string;
  detail?: string;
}

export interface MissionTimelineProps {
  steps: MissionStep[];
  className?: string;
}

const statusIcon = {
  pending: Circle,
  running: Loader,
  done: CircleCheck,
  error: CircleX,
} satisfies Record<MissionStep['status'], React.ComponentType<{ className?: string }>>;

const statusTone: Record<MissionStep['status'], string> = {
  pending: 'text-text-muted',
  running: 'text-accent',
  done: 'text-success',
  error: 'text-warning',
};

export const MissionTimeline: React.FC<MissionTimelineProps> = ({ steps, className = '' }) => {
  const { t } = useTranslation();

  return (
    <ol
      data-testid="mission-timeline"
      className={`space-y-1 border-l border-border pl-3 ${className}`}
      aria-label={t('missionTimeline.label', 'Mission timeline')}
    >
      {steps.map((step) => {
        const Icon = statusIcon[step.status];
        const isRunning = step.status === 'running';
        const tone = statusTone[step.status];

        return (
          <li
            key={step.id}
            data-testid={`mission-step-${step.id}`}
            className={`relative flex min-w-0 items-start gap-2 rounded px-2 py-1.5 text-xs ${
              isRunning ? 'bg-accent/15 text-text' : 'text-text-muted'
            }`}
          >
            <Icon
              className={`absolute -left-[1.05rem] mt-0.5 h-3.5 w-3.5 bg-surface ${tone} ${
                isRunning ? 'animate-spin' : ''
              }`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className={`truncate font-medium ${isRunning ? 'text-text' : ''}`} title={step.label}>
                {step.label}
              </div>
              {step.detail && (
                <div className="mt-0.5 truncate text-[11px] text-text-muted" title={step.detail}>
                  {step.detail}
                </div>
              )}
            </div>
            {step.tool && (
              <span
                className="max-w-[9rem] shrink-0 truncate rounded bg-border px-1.5 py-0.5 text-[10px] text-text-muted"
                title={step.tool}
              >
                {step.tool}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default MissionTimeline;
