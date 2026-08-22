import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import type { EditorialQualityReport } from '../../../shared/editorial-quality';

export function FlowEditorialGate({
  report,
  title,
  description,
  series,
  disclosure,
  onTitle,
  onDescription,
  onSeries,
  onDisclosure,
}: {
  report: EditorialQualityReport;
  title: string;
  description: string;
  series: string;
  disclosure: boolean;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onSeries: (value: string) => void;
  onDisclosure: (value: boolean) => void;
}) {
  const tone = report.ready ? 'border-emerald-500/35 bg-emerald-500/5' : 'border-amber-500/35 bg-amber-500/5';
  return (
    <details className={`mt-2 rounded-lg border ${tone}`} data-testid="flow-editorial-gate">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-medium">
        <ShieldCheck className={`h-3.5 w-3.5 ${report.ready ? 'text-emerald-600' : 'text-amber-600'}`} />
        Contrôle éditorial YouTube
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${report.ready ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>{report.score}/100 · {report.ready ? 'prêt pour revue' : 'à améliorer'}</span>
      </summary>
      <div className="grid gap-3 border-t border-current/10 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[10px]"><span className="mb-1 block text-muted-foreground">Titre de l’épisode</span><input value={title} onChange={(event) => onTitle(event.target.value)} maxLength={100} className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-[11px] outline-none" /></label>
          <label className="block text-[10px]"><span className="mb-1 block text-muted-foreground">Nom de la série</span><input value={series} onChange={(event) => onSeries(event.target.value)} maxLength={80} className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-[11px] outline-none" placeholder="Les matins de Lisa" /></label>
          <label className="block text-[10px] sm:col-span-2"><span className="mb-1 block text-muted-foreground">Description originale</span><textarea value={description} onChange={(event) => onDescription(event.target.value)} maxLength={1000} rows={3} className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[11px] outline-none" /></label>
          <label className="flex items-center gap-2 text-[10px] sm:col-span-2"><input type="checkbox" checked={disclosure} onChange={(event) => onDisclosure(event.target.checked)} className="accent-orange-500" /> Déclarer le personnage et les images comme contenu synthétique</label>
        </div>
        <div className="grid content-start gap-1.5">
          {report.checks.map((check) => <div key={check.id} className="flex items-start gap-2 rounded-md bg-background/70 px-2 py-1.5 text-[9px]" title={check.detail}>{check.status === 'pass' ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" /> : check.status === 'warn' ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />}<span><strong>{check.label}</strong><span className="ml-1 text-muted-foreground">{check.detail}</span></span></div>)}
        </div>
      </div>
    </details>
  );
}
