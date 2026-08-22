import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import type { WebTestReport } from './web-test-report-model.js';
import { summarizeReport } from './web-test-report-model.js';

/**
 * Renders a Code Buddy web_test report inside the App Studio workbench: the
 * PASSED/FAILED verdict, error counts, per-check list, and the screenshot.
 */
export function VerifyReportCard({ report, onRerun }: { report: WebTestReport; onRerun?: () => void }) {
  const summary = summarizeReport(report);
  return (
    <section className="rounded-lg border border-border bg-surface p-3" aria-label="Verification report" data-testid="verify-report">
      <header className="mb-2 flex items-center gap-2">
        {report.passed ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" aria-hidden="true" />
        )}
        <h3 className={`flex-1 text-xs font-semibold ${report.passed ? 'text-green-500' : 'text-red-500'}`}>
          web_test {report.passed ? 'PASSED' : 'FAILED'} · {summary.total - summary.failed}/{summary.total}
        </h3>
        {onRerun ? (
          <button
            type="button"
            onClick={onRerun}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Re-run verification"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Re-run
          </button>
        ) : null}
      </header>

      <div className="mb-2 flex gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span className={report.consoleErrorCount > 0 ? 'text-red-500' : undefined}>
          {report.consoleErrorCount} console error(s)
        </span>
        <span className={report.networkFailureCount > 0 ? 'text-red-500' : undefined}>
          {report.networkFailureCount} network failure(s)
        </span>
      </div>

      <ul className="space-y-1">
        {report.checks.map((check, i) => (
          <li key={`${check.name}-${i}`} className="flex items-start gap-2 text-xs">
            {check.passed ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
            )}
            <span className="min-w-0">
              <span className="text-foreground">{check.name}</span>
              {check.detail ? <span className="block text-[11px] text-muted-foreground">{check.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {report.screenshotPath ? (
        <img
          src={`file://${report.screenshotPath}`}
          alt="Verification screenshot"
          className="mt-2 max-h-48 w-full rounded-md border border-border object-contain"
        />
      ) : null}
    </section>
  );
}
