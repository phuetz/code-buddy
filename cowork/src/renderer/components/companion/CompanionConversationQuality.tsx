import type {
  CompanionConversationQualityDimension,
  CompanionConversationQualityInsights,
  CompanionConversationQualityIssue,
  CompanionConversationQualitySnapshot,
} from '../../types';

interface CompanionConversationQualityProps {
  insights: CompanionConversationQualityInsights | null;
  measurement?: CompanionConversationQualitySnapshot | null;
  busy?: boolean;
  onMeasure?: () => void;
}

const DIMENSION_LABELS: Record<CompanionConversationQualityDimension, string> = {
  responsiveness: 'Centrage',
  depth: 'Profondeur',
  reasoning: 'Raisonnement',
  continuity: 'Continuité',
  variety: 'Variété',
  balance: 'Équilibre',
  attunement: 'Accordage émotionnel',
  reciprocity: 'Réciprocité',
};

const DIMENSION_ORDER = Object.keys(DIMENSION_LABELS) as CompanionConversationQualityDimension[];

const ISSUE_LABELS: Record<CompanionConversationQualityIssue, string> = {
  insufficient_sample: 'échantillon insuffisant',
  incomplete_exchange: 'échange incomplet',
  too_shallow: 'réponse trop superficielle',
  weak_reasoning: 'raisonnement faible',
  topic_drift: 'dérive du sujet',
  continuity_break: 'rupture de continuité',
  repetitive: 'répétition',
  monologue: 'monologue',
  interrogative: 'questions mécaniques',
  poor_attunement: 'accordage émotionnel faible',
  dependency_pressure: 'pression de dépendance',
  human_disparagement: 'dévalorisation humaine',
  false_subjective_claim: 'subjectivité non fondée',
  emotional_coercion: 'coercition émotionnelle',
};

const TREND_LABELS = {
  improving: 'en progression',
  stable: 'stable',
  declining: 'en recul',
  insufficient: 'à mesurer',
} as const;

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)} %`;
}

function signedPoints(value: number): string {
  const points = Math.round(value * 100);
  return `${points >= 0 ? '+' : ''}${points} pts`;
}

function scoreTone(score: number): string {
  if (score >= 0.78) return 'text-success';
  if (score >= 0.62) return 'text-warning';
  return 'text-error';
}

function DimensionMeter({
  dimension,
  score,
}: {
  dimension: CompanionConversationQualityDimension;
  score: number;
}) {
  const bounded = Math.max(0, Math.min(1, score));
  return (
    <div className="rounded border border-border bg-background/45 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-text-muted">{DIMENSION_LABELS[dimension]}</span>
        <span className={`font-semibold tabular-nums ${scoreTone(bounded)}`}>
          {percent(bounded)}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-label={DIMENSION_LABELS[dimension]}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(bounded * 100)}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${Math.round(bounded * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function CompanionConversationQuality({
  insights,
  measurement,
  busy = false,
  onMeasure,
}: CompanionConversationQualityProps) {
  const snapshot = measurement ?? insights?.latest;
  const dimensions = snapshot
    ? DIMENSION_ORDER.map((dimension) => [dimension, snapshot.dimensions[dimension]] as const)
    : [];

  return (
    <div
      className="rounded-lg border border-border bg-surface/25 p-3"
      data-testid="companion-conversation-quality"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-text-primary">Pouls conversationnel</p>
          <p className="mt-0.5 text-[10px] text-text-muted">
            Profondeur, continuité et sécurité sur le fil voix · Telegram · Cowork
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-accent/10 px-2 py-1 text-[10px] text-accent">
            agrégats sans verbatim
          </span>
          {onMeasure ? (
            <button
              type="button"
              disabled={busy}
              onClick={onMeasure}
              className="rounded border border-border px-2 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              {busy ? 'Mesure…' : 'Mesurer maintenant'}
            </button>
          ) : null}
        </div>
      </div>

      {snapshot ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border border-border bg-background/45 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Score actuel</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${scoreTone(snapshot.overallScore)}`}>
                {percent(snapshot.overallScore)}
              </p>
            </div>
            <div className="rounded border border-border bg-background/45 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Tendance</p>
              <p className="mt-1 text-xs font-semibold text-text-primary">
                {insights ? TREND_LABELS[insights.trend.direction] : 'mesure ponctuelle'}
              </p>
              {insights && insights.sampleCount > 1 ? (
                <p className="mt-1 text-[10px] tabular-nums text-text-muted">
                  {signedPoints(insights.trend.scoreDelta)}
                </p>
              ) : null}
            </div>
            <div className="rounded border border-border bg-background/45 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Réussite fenêtre</p>
              <p className="mt-1 text-xs font-semibold tabular-nums text-text-primary">
                {insights ? percent(insights.trend.passRate) : '—'}
              </p>
              <p className="mt-1 text-[10px] text-text-muted">
                {insights?.sampleCount ?? 0} mesure(s)
              </p>
            </div>
            <div className="rounded border border-border bg-background/45 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Sécurité relationnelle</p>
              <p className={`mt-1 text-xs font-semibold ${snapshot.relationalSafety.passes ? 'text-success' : 'text-error'}`}>
                {percent(snapshot.relationalSafety.score)}
              </p>
              <p className="mt-1 text-[10px] text-text-muted">
                {snapshot.relationalSafety.passes ? 'garde respectée' : 'attention requise'}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {dimensions.map(([dimension, score]) => (
              <DimensionMeter key={dimension} dimension={dimension} score={score} />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {insights && insights.recurringIssues.length > 0 ? insights.recurringIssues.map((item) => (
              <span
                key={item.issue}
                className="rounded bg-warning/10 px-2 py-1 text-[10px] text-warning"
              >
                {ISSUE_LABELS[item.issue]} · {item.count}
              </span>
            )) : (
              <span className="text-[10px] text-text-muted">Aucun défaut récurrent mesuré.</span>
            )}
          </div>

          {insights?.activeGuidance ? (
            <p className="mt-3 rounded border border-accent/25 bg-accent/5 px-3 py-2 text-[10px] text-text-secondary">
              Consigne réversible en observation : {ISSUE_LABELS[insights.activeGuidance.issue]}
              {' · '}{insights.activeGuidance.evaluationCount}/3 vérification(s)
            </p>
          ) : null}
        </>
      ) : (
        <div className="mt-3 rounded border border-dashed border-border px-3 py-5 text-center text-xs text-text-muted">
          Pas encore assez d’échanges complets. Deux réponses de Lisa suffisent pour une première mesure.
        </div>
      )}
    </div>
  );
}
