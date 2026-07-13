import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  BedDouble,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Clock3,
  CloudOff,
  CookingPot,
  Focus,
  House,
  Leaf,
  Loader2,
  MapPin,
  Moon,
  PartyPopper,
  Plane,
  RefreshCw,
  ShieldCheck,
  Soup,
  Sparkles,
  UsersRound,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';

import { GuidedTooltip } from '../Tooltip';
import {
  buildMaisonCardModel,
  DEFAULT_MAISON_MODES,
  MAISON_MODE_PRESENTATION,
  type MaisonContextPresentation,
  type MaisonFreshness,
  type MaisonTone,
} from './maison-model.js';
import type {
  MaisonCardProps,
  MaisonDataStatus,
  MaisonDayKind,
  MaisonMode,
  MaisonPresenceState,
} from './maison-types.js';

const MODE_ICONS: Record<MaisonMode, LucideIcon> = {
  normal: House,
  'free-day': Leaf,
  focus: Focus,
  rest: BedDouble,
  cooking: CookingPot,
  guests: UsersRound,
  away: Plane,
  silent: VolumeX,
};

const ACTION_BASE = 'inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-45';

function toneClasses(tone: MaisonTone): string {
  if (tone === 'success') return 'border-success/20 bg-success/5 text-success';
  if (tone === 'warning') return 'border-warning/25 bg-warning/10 text-warning';
  if (tone === 'accent') return 'border-accent/20 bg-accent/5 text-accent';
  return 'border-border bg-background/55 text-text-muted';
}

function freshnessClasses(freshness: MaisonFreshness): string {
  if (freshness === 'fresh') return 'text-success';
  if (freshness === 'stale') return 'text-warning';
  return 'text-text-muted';
}

function statusPresentation(status: MaisonDataStatus): {
  icon: LucideIcon;
  label: string;
  className: string;
} {
  if (status === 'ready') {
    return { icon: ShieldCheck, label: 'Prêt', className: 'border-success/20 bg-success/5 text-success' };
  }
  if (status === 'loading') {
    return { icon: Loader2, label: 'Actualisation', className: 'border-accent/20 bg-accent/5 text-accent' };
  }
  if (status === 'offline') {
    return { icon: CloudOff, label: 'Hors ligne', className: 'border-warning/25 bg-warning/10 text-warning' };
  }
  return { icon: CircleHelp, label: 'À confirmer', className: 'border-border bg-background/60 text-text-muted' };
}

function dayIcon(kind: MaisonDayKind): LucideIcon {
  if (kind === 'workday') return BriefcaseBusiness;
  if (kind === 'weekend') return Leaf;
  if (kind === 'holiday') return PartyPopper;
  return CalendarDays;
}

function presenceIcon(state: MaisonPresenceState): LucideIcon {
  if (state === 'present') return MapPin;
  if (state === 'away') return Plane;
  return CircleHelp;
}

function ContextTile({
  eyebrow,
  value,
  icon: Icon,
  testId,
  tooltip,
}: {
  eyebrow: string;
  value: MaisonContextPresentation;
  icon: LucideIcon;
  testId: string;
  tooltip: string;
}) {
  return (
    <div className="min-w-0 [&>span]:flex [&>span]:h-full [&>span]:w-full">
      <GuidedTooltip title={eyebrow} description={tooltip} kicker="Contexte Maison" side="top">
        <div
          className={`flex h-full w-full min-w-0 items-start gap-2.5 rounded-2xl border p-3 ${toneClasses(value.tone)}`}
          data-testid={testId}
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-current/15 bg-surface/70">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.14em] opacity-75">{eyebrow}</div>
            <div className="mt-0.5 truncate text-xs font-semibold text-text-primary">{value.label}</div>
            <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-text-secondary">{value.detail}</div>
          </div>
        </div>
      </GuidedTooltip>
    </div>
  );
}

function ModePicker({
  currentMode,
  options,
  disabled,
  onChange,
}: {
  currentMode: MaisonMode | undefined;
  options: readonly MaisonMode[];
  disabled: boolean;
  onChange: (mode: MaisonMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = currentMode ? options.indexOf(currentMode) : -1;
    const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const frame = window.requestAnimationFrame(() => optionRefs.current[focusIndex]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [currentMode, open, options]);

  const choose = (mode: MaisonMode) => {
    closeAndRestoreFocus();
    onChange(mode);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const activeIndex = optionRefs.current.findIndex((item) => item === document.activeElement);
    const lastIndex = Math.max(0, options.length - 1);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? lastIndex
        : event.key === 'ArrowDown'
          ? (activeIndex + 1 + options.length) % options.length
          : (activeIndex - 1 + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      onClick={() => setOpen((value) => !value)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={menuId}
      className={`${ACTION_BASE} border-border bg-background/70 text-text-secondary hover:bg-surface-hover hover:text-text-primary`}
      data-testid="maison-change-mode"
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      Changer
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
  );

  return (
    <div ref={rootRef} className="relative [&>span]:flex [&>span]:w-full">
      <GuidedTooltip
        title="Changer le rythme de la maison"
        description="Choisis un contexte explicite. Aucun mode n’est déduit ou activé silencieusement depuis cette carte."
        kicker="Contrôle"
        side="top"
      >
        {trigger}
      </GuidedTooltip>

      {open && !disabled ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Choisir le mode Maison"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-0 z-30 mb-2 max-h-[420px] w-[calc(200%+0.5rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-elevated animate-slide-up sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2 sm:max-h-none sm:w-[min(390px,calc(100vw-32px))] sm:overflow-visible"
          data-testid="maison-mode-menu"
        >
          <div className="px-2 pb-2 pt-1">
            <div className="text-xs font-semibold text-text-primary">Rythme de la maison</div>
            <div className="mt-0.5 text-[10px] text-text-muted">Le changement reste local et immédiatement réversible.</div>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {options.map((mode, index) => {
              const option = MAISON_MODE_PRESENTATION[mode];
              const Icon = MODE_ICONS[mode];
              const selected = currentMode === mode;
              return (
                <button
                  ref={(element) => { optionRefs.current[index] = element; }}
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={selected || (!currentMode && index === 0) ? 0 : -1}
                  onClick={() => choose(mode)}
                  className={`flex min-w-0 items-start gap-2 rounded-xl border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    selected
                      ? 'border-accent/30 bg-accent/10'
                      : 'border-transparent hover:border-border hover:bg-surface-hover'
                  }`}
                  data-testid={`maison-mode-${mode}`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-accent' : 'text-text-muted'}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold text-text-primary">{option.label}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[9px] leading-relaxed text-text-muted">{option.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MaisonCard({
  snapshot,
  status,
  now = Date.now(),
  modeOptions = DEFAULT_MAISON_MODES,
  className = '',
  onModeChange,
  onSilenceChange,
  onStartCooking,
  onGuestsChange,
  onRefresh,
}: MaisonCardProps) {
  const titleId = useId();
  const model = buildMaisonCardModel(snapshot, status, now);
  const StatusIcon = statusPresentation(model.status).icon;
  const statusView = statusPresentation(model.status);
  const DayIcon = dayIcon(snapshot?.day?.kind ?? 'unknown');
  const PresenceIcon = presenceIcon(snapshot?.presence?.state ?? 'unknown');
  const ModeIcon = snapshot?.mode ? MODE_ICONS[snapshot.mode] : CircleHelp;
  const uniqueModeOptions = [...new Set(modeOptions)];
  const silent = snapshot?.mode === 'silent';
  const guests = snapshot?.mode === 'guests';

  return (
    <section
      className={`relative w-full max-w-3xl rounded-3xl border border-border bg-surface shadow-card ${className}`}
      aria-labelledby={titleId}
      aria-busy={model.status === 'loading'}
      data-testid="maison-card"
      data-status={model.status}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl" aria-hidden="true">
        <div className="absolute -right-20 -top-24 h-52 w-52 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 h-44 w-44 rounded-full bg-success/5 blur-3xl" />
      </div>

      <div className="relative p-4 sm:p-5">
        <header className="flex items-start gap-3.5">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent shadow-soft">
            <span className="absolute inset-1 rounded-xl border border-accent/15" />
            <House className="relative h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Maison</span>
              <GuidedTooltip
                title="D’où vient ce contexte ?"
                description="Cette indication distingue un réglage manuel, le calendrier ou un signal local, et montre quand il a été observé."
                kicker="Transparence"
                side="bottom"
              >
                <span
                  className={`inline-flex items-center gap-1 text-[10px] ${freshnessClasses(model.provenance.freshness)}`}
                  data-testid="maison-provenance"
                >
                  <Clock3 className="h-3 w-3" aria-hidden="true" />
                  {model.provenance.combinedLabel}
                </span>
              </GuidedTooltip>
            </div>
            <h2 id={titleId} className="mt-1 text-lg font-semibold leading-tight text-text-primary sm:text-xl">
              {model.headline}
            </h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-secondary sm:text-sm">
              {model.summary}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={`hidden items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold sm:inline-flex ${statusView.className}`}
              data-testid="maison-status-badge"
            >
              <StatusIcon className={`h-3 w-3 ${model.status === 'loading' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
              {statusView.label}
            </span>
            {onRefresh ? (
              <GuidedTooltip
                title="Actualiser Maison"
                description="Relit les signaux déjà autorisés. Cette action ne change aucun mode et ne démarre aucune routine."
                kicker="Contexte"
                side="left"
              >
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={model.status === 'loading'}
                  className="rounded-xl p-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45"
                  aria-label="Actualiser Maison"
                  data-testid="maison-refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${model.status === 'loading' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
                </button>
              </GuidedTooltip>
            ) : null}
          </div>
        </header>

        {model.stateMessage ? (
          <div
            role="status"
            aria-live="polite"
            className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] ${
              model.status === 'offline'
                ? 'border-warning/20 bg-warning/5 text-warning'
                : 'border-border bg-background/55 text-text-muted'
            }`}
            data-testid="maison-state-message"
          >
            {model.status === 'loading' ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" /> : null}
            {model.status === 'offline' ? <CloudOff className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {model.status === 'unknown' ? <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            <span>{model.stateMessage}</span>
          </div>
        ) : null}

        <div className={`mt-4 grid gap-2.5 sm:grid-cols-3 ${model.status === 'loading' ? 'opacity-65' : ''}`}>
          <ContextTile
            eyebrow="Type de journée"
            value={model.day}
            icon={DayIcon}
            testId="maison-day"
            tooltip="Le calendrier et les jours fériés décrivent le rythme possible ; ils ne prouvent jamais à eux seuls que tu es disponible."
          />
          <ContextTile
            eyebrow="Présence"
            value={model.presence}
            icon={PresenceIcon}
            testId="maison-presence"
            tooltip="La présence est affichée séparément du mode. En cas de doute, Code Buddy choisit le silence et ne révèle rien de personnel."
          />
          <ContextTile
            eyebrow="Mode Maison"
            value={model.mode}
            icon={ModeIcon}
            testId="maison-mode"
            tooltip="Le mode règle la proactivité et la confidentialité. Il reste toujours modifiable et immédiatement réversible."
          />
        </div>

        <div
          className="mt-3 flex flex-col gap-3 rounded-2xl border border-border bg-background/55 p-3 sm:flex-row sm:items-center"
          data-testid="maison-meal"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-success/15 bg-success/5 text-success">
            {model.meal ? <Soup className="h-5 w-5" aria-hidden="true" /> : <CookingPot className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              {model.meal?.whenLabel ?? 'Prochain repas'}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-text-primary">
              {model.meal?.title ?? 'Rien n’est encore prévu'}
            </div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-text-secondary">
              {model.meal?.detail ?? 'Demande une idée avec ce qui est réellement disponible, sans objectif médical ni jugement.'}
            </div>
          </div>
          <span className="w-fit shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-medium text-text-muted">
            {model.meal ? `${model.meal.planned ? 'Prévu' : 'Suggestion'} · ${model.meal.originLabel}` : 'À choisir'}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Actions Maison">
          <ModePicker
            currentMode={snapshot?.mode}
            options={uniqueModeOptions}
            disabled={model.actionsDisabled}
            onChange={onModeChange}
          />

          <div className="[&>span]:flex [&>span]:w-full">
            <GuidedTooltip
              title="Passer en cuisine mains libres"
              description="Ouvre l’expérience dédiée aux étapes courtes, substitutions explicites et minuteurs nommés. Aucun repas n’est lancé automatiquement."
              kicker="Cuisine"
              side="top"
            >
              <button
                type="button"
                onClick={onStartCooking}
                disabled={model.actionsDisabled}
                className={`${ACTION_BASE} border-transparent bg-accent text-white shadow-soft hover:bg-accent-hover`}
                data-testid="maison-start-cooking"
              >
                <CookingPot className="h-4 w-4" aria-hidden="true" />
                {snapshot?.mode === 'cooking' ? 'Cuisine active' : 'Cuisiner'}
              </button>
            </GuidedTooltip>
          </div>

          <div className="[&>span]:flex [&>span]:w-full">
            <GuidedTooltip
              title={guests ? 'Quitter le mode invités' : 'Protéger la vie privée des invités'}
              description="Le mode invités masque souvenirs, messages et projets personnels. Il ne mémorise personne sans consentement."
              kicker="Confidentialité"
              side="top"
            >
              <button
                type="button"
                onClick={() => onGuestsChange(!guests)}
                disabled={model.actionsDisabled}
                aria-pressed={guests}
                className={`${ACTION_BASE} ${
                  guests
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-border bg-background/70 text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
                data-testid="maison-guests"
              >
                <UsersRound className="h-4 w-4" aria-hidden="true" />
                {guests ? 'Invités actifs' : 'Invités'}
              </button>
            </GuidedTooltip>
          </div>

          <div className="[&>span]:flex [&>span]:w-full">
            <GuidedTooltip
              title={silent ? 'Réactiver les propositions sonores' : 'Demander le silence'}
              description="Le silence suspend toute initiative vocale. Les informations peuvent rester visibles sans interrompre la maison."
              kicker="Quiet mode"
              side="top"
            >
              <button
                type="button"
                onClick={() => onSilenceChange(!silent)}
                disabled={model.actionsDisabled}
                aria-pressed={silent}
                className={`${ACTION_BASE} ${
                  silent
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : 'border-border bg-background/70 text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
                data-testid="maison-silence"
              >
                {silent ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
                {silent ? 'Réactiver' : 'Silence'}
              </button>
            </GuidedTooltip>
          </div>
        </div>
      </div>
    </section>
  );
}
