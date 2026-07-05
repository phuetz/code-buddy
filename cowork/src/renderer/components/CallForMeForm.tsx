/**
 * CallForMeForm — presentational phone-call request scaffold.
 *
 * The calling backend is out of scope here; this component only validates local
 * form state and emits the requested phone/goal payload.
 *
 * @module renderer/components/CallForMeForm
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneCall } from 'lucide-react';

export interface CallForMeFormProps {
  onSubmit: (req: { phone: string; goal: string }) => void;
  busy?: boolean;
  className?: string;
}

export const CallForMeForm: React.FC<CallForMeFormProps> = ({
  onSubmit,
  busy = false,
  className = '',
}) => {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [goal, setGoal] = useState('');
  const trimmedPhone = phone.trim();
  const trimmedGoal = goal.trim();
  const disabled = busy || !trimmedPhone || !trimmedGoal;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    onSubmit({ phone: trimmedPhone, goal: trimmedGoal });
  };

  return (
    <form
      data-testid="call-for-me-form"
      className={`space-y-3 rounded-md border border-border bg-surface p-3 text-sm ${className}`}
      aria-busy={busy}
      onSubmit={handleSubmit}
    >
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-muted" htmlFor="call-for-me-phone">
          {t('callForMe.phone', 'Phone')}
        </label>
        <input
          id="call-for-me-phone"
          type="tel"
          data-testid="call-for-me-phone"
          aria-label={t('callForMe.phone', 'Phone')}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          disabled={busy}
          className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
          placeholder={t('callForMe.phonePlaceholder', '+1 555 0100')}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-muted" htmlFor="call-for-me-goal">
          {t('callForMe.goal', 'Goal')}
        </label>
        <textarea
          id="call-for-me-goal"
          data-testid="call-for-me-goal"
          aria-label={t('callForMe.goal', 'Goal')}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          disabled={busy}
          rows={3}
          className="w-full resize-none rounded border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
          placeholder={t('callForMe.goalPlaceholder', 'Describe the call objective')}
        />
      </div>

      <button
        type="submit"
        data-testid="call-for-me-submit"
        aria-label={t('callForMe.placeCall', 'Place call')}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-border disabled:opacity-50"
      >
        <PhoneCall className="h-3.5 w-3.5" aria-hidden />
        <span>{t('callForMe.placeCall', 'Place call')}</span>
      </button>
    </form>
  );
};

export default CallForMeForm;
