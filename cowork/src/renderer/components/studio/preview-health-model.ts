/**
 * Preview health for App Studio's auto-build loop.
 *
 * Before this module the loop's only success criterion was "the dev server
 * answers HTTP". Vite answers 200 even when the app cannot render (unresolved
 * import, syntax error, uncaught exception, empty #root), so the capped
 * auto-fix loop never fired on the failures that actually happen. bolt.diy
 * forwards preview errors back to the model; this module is the local,
 * WebContainer-free equivalent: the main process gathers raw signals (a
 * `vite build` pass + a hidden-window load of the preview) and this PURE model
 * turns them into a verdict and a fix prompt.
 *
 * @module renderer/components/studio/preview-health-model
 */

export interface PreviewSignals {
  /** Exit code of the build probe (`vite build`); null/undefined = not run. */
  buildExitCode?: number | null;
  buildOutput?: readonly string[];
  /** console.error messages seen while loading the preview. */
  consoleErrors?: readonly string[];
  /** Uncaught exceptions / unhandled rejections seen while loading. */
  pageErrors?: readonly string[];
  /** Vite's error overlay element was present. */
  overlay?: boolean;
  /** Child elements of the mount node (#root / #app / body). */
  rootChildren?: number;
  /** Length of document.body.innerText. */
  textLength?: number;
  /** The starter placeholder is still what renders (app not generated). */
  placeholder?: boolean;
  /** Navigation itself failed (connection refused, timeout...). */
  navError?: string;
}

export type PreviewProblemKind = 'build' | 'runtime' | 'overlay' | 'blank' | 'placeholder' | 'navigation';

export interface PreviewProblem {
  kind: PreviewProblemKind;
  detail: string;
}

export interface PreviewHealthReport {
  ok: boolean;
  problems: PreviewProblem[];
  /** Non-blocking console errors, passed to the model as context only. */
  warnings: string[];
  summary: string;
}

// eslint-disable-next-line no-control-regex -- stripping ANSI colour codes from build logs
const ANSI = /\u001b\[[0-9;]*m/g;
/** Console errors that are noise for "does the app render" (favicon 404, React key warnings…). */
const NOISE = [/Failed to load resource/i, /favicon/i, /Warning: Each child in a list/i, /Download the React DevTools/i];
/** Console errors that mean the app is broken even if something rendered. */
const FATAL = [
  /Uncaught/i,
  /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b/,
  /is not defined/i,
  /Failed to resolve import/i,
  /does not provide an export named/i,
  /Failed to fetch dynamically imported module/i,
  /\[plugin:vite/i,
  /The above error occurred in/i,
];

function clean(line: string): string {
  return line.replace(ANSI, '').trimEnd();
}

/** Keep the lines of a build log that explain the failure (error + a little context). */
export function extractBuildErrors(output: readonly string[], max = 30): string[] {
  const lines = output.map(clean).filter((l) => l.trim().length > 0);
  const hits: number[] = [];
  lines.forEach((l, i) => {
    if (/error|failed|cannot|could not|not found|unexpected|expected|✘|\[vite\]/i.test(l)) hits.push(i);
  });
  if (hits.length === 0) return lines.slice(-max);
  const keep = new Set<number>();
  for (const i of hits) for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 3); j++) keep.add(j);
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]!).slice(0, max);
}

export function collectPreviewHealth(signals: PreviewSignals): PreviewHealthReport {
  const problems: PreviewProblem[] = [];
  const warnings: string[] = [];

  if (typeof signals.buildExitCode === 'number' && signals.buildExitCode !== 0) {
    const lines = extractBuildErrors(signals.buildOutput ?? []);
    problems.push({ kind: 'build', detail: lines.join('\n') || `vite build exited with code ${signals.buildExitCode}` });
  }
  if (signals.navError) problems.push({ kind: 'navigation', detail: clean(signals.navError) });

  const pageErrors = [...new Set((signals.pageErrors ?? []).map(clean))];
  for (const e of pageErrors.slice(0, 5)) problems.push({ kind: 'runtime', detail: e });

  const consoleErrors = [...new Set((signals.consoleErrors ?? []).map(clean))].filter(
    (e) => !NOISE.some((re) => re.test(e)),
  );
  const fatal = consoleErrors.filter((e) => FATAL.some((re) => re.test(e)));
  // A pageerror usually also shows up as an "Uncaught …" console line: don't count it twice.
  for (const e of fatal.slice(0, 5)) {
    if (!pageErrors.some((p) => e.includes(p) || p.includes(e))) problems.push({ kind: 'runtime', detail: e });
  }
  warnings.push(...consoleErrors.filter((e) => !fatal.includes(e)).slice(0, 5));

  if (signals.overlay) problems.push({ kind: 'overlay', detail: 'Vite error overlay is displayed over the page.' });

  if (!signals.navError) {
    if (signals.placeholder) {
      problems.push({ kind: 'placeholder', detail: 'The starter placeholder App is still rendered: the app itself was not written.' });
    } else if ((signals.rootChildren ?? 0) === 0 || (signals.textLength ?? 0) === 0) {
      problems.push({ kind: 'blank', detail: 'The page renders nothing (empty mount node / no visible text).' });
    }
  }

  const ok = problems.length === 0;
  const summary = ok
    ? 'preview OK'
    : [...new Set(problems.map((p) => p.kind))].join(', ');
  return { ok, problems, warnings, summary };
}

const KIND_LABEL: Record<PreviewProblemKind, string> = {
  build: 'Erreur de build (vite build)',
  runtime: "Erreur d'exécution dans l'aperçu",
  overlay: 'Overlay d’erreur Vite',
  blank: 'Page blanche',
  placeholder: 'Application non écrite',
  navigation: "L'aperçu ne se charge pas",
};

/**
 * Message handed back to the SAME agent session (bolt.diy's "Fix this preview
 * error" + our no-shell / full-file contract).
 */
export function buildPreviewFixPrompt(report: PreviewHealthReport): string {
  const parts: string[] = [
    "L'application démarre mais son aperçu est cassé. Problèmes détectés automatiquement :",
  ];
  for (const p of report.problems.slice(0, 6)) {
    parts.push('', `### ${KIND_LABEL[p.kind]}`, '```', p.detail.slice(0, 2000), '```');
  }
  if (report.warnings.length) {
    parts.push('', 'Autres erreurs console (contexte) :', '```', report.warnings.join('\n').slice(0, 1200), '```');
  }
  parts.push(
    '',
    'Corrige la CAUSE en éditant les fichiers du projet :',
    '- lis d’abord le fichier en cause, puis réécris-le en ENTIER (aucun « // reste inchangé », aucun code factice) ;',
    '- chaque import doit pointer vers un fichier que tu crées réellement ou vers un paquet présent dans package.json ' +
      '(ajoute-le à package.json avec une version majeure existante si besoin — App Studio relancera l’installation) ;',
    '- vérifie les exports nommés/par défaut entre fichiers ;',
    "- n'exécute AUCUNE commande shell (App Studio relance le build et l'aperçu lui-même).",
    'Termine par une phrase qui dit ce que tu as changé.',
  );
  return parts.join('\n');
}

/**
 * Names of every declared dependency (deps + devDeps). Used to decide whether
 * `npm install` must run again: the previous "node_modules/.package-lock.json
 * exists" marker skipped the install after a fix that ADDED a dependency, so
 * the fix loop retried the same missing-module failure.
 */
export function listDeclaredDependencies(packageJsonText: string): string[] {
  try {
    const pkg = JSON.parse(packageJsonText) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])];
  } catch {
    return [];
  }
}
