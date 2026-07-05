/**
 * CallLogView — transcript and summary surface for phone-call agent results.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/CallLogView
 */

import { useTranslation } from 'react-i18next';
import { PhoneCall, Timer, Users } from 'lucide-react';
import { summarizeCall, type CallTurn } from '../utils/call-model';
import { MessageMarkdown } from './MessageMarkdown';

export interface CallLogViewProps {
  transcript: CallTurn[];
  summary: string;
}

function formatCallTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

export function CallLogView({ transcript, summary }: CallLogViewProps) {
  const { t } = useTranslation();
  const stats = summarizeCall(transcript);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="call-log-view">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <PhoneCall aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.call.title', 'Journal d’appel')}
            </h2>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                <Timer aria-hidden="true" className="h-3.5 w-3.5" />
                {formatCallTime(stats.durationSec)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                <Users aria-hidden="true" className="h-3.5 w-3.5" />
                {stats.speakerCount} intervenants
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ol className="space-y-2">
          {transcript.length === 0 ? (
            <li className="flex min-h-28 items-center justify-center rounded-lg border border-border bg-background text-sm text-muted-foreground">
              {t('genspark.call.empty', 'Aucun transcript disponible.')}
            </li>
          ) : (
            transcript.map((turn) => (
              <li
                key={turn.id}
                className="rounded-lg border border-border bg-background p-3"
                data-testid={`call-turn-${turn.id}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">{turn.speaker}</span>
                  <span>{formatCallTime(turn.startSec)}</span>
                  {turn.endSec !== undefined && <span>→ {formatCallTime(turn.endSec)}</span>}
                </div>
                <p className="mt-2 text-sm leading-6 text-foreground">{turn.text}</p>
              </li>
            ))
          )}
        </ol>

        <aside className="rounded-lg border border-border bg-background p-3">
          <h3 className="mb-2 text-sm font-medium text-foreground">{t('genspark.call.summary', 'Résumé')}</h3>
          <div className="text-sm text-muted-foreground">
            <MessageMarkdown normalizedText={summary || t('genspark.call.noSummary', 'Aucun résumé fourni.')} />
          </div>
        </aside>
      </div>
    </section>
  );
}
