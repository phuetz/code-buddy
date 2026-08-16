/** Render the pure repository explanation as Markdown or autonomous HTML. */

import type {
  RepoExplanation,
  RepoHotspot,
  RepoLanguageSummary,
  RepoRiskLevel,
} from '../analytics/repo-explainer.js';
import { exportStandaloneHtmlDocument } from './session-share.js';

export interface RepoExplanationHtmlOptions {
  /** Locally-rendered Mermaid PNG. If absent, Mermaid source stays visible. */
  diagramDataUri?: string;
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function languageLabel(language: RepoLanguageSummary): string {
  if (language.files === 0) return language.name;
  return `${language.name} (${language.files} fichier${language.files === 1 ? '' : 's'}, ${language.percent} %)`;
}

function riskLabel(level: RepoRiskLevel): string {
  if (level === 'critical') return 'critique';
  if (level === 'high') return 'élevé';
  if (level === 'medium') return 'modéré';
  return 'faible';
}

function formatSigned(value: number | undefined): string {
  if (value === undefined) return 'non mesuré';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('fr-FR')}`;
}

function renderMarkdownHotspots(hotspots: RepoHotspot[]): string[] {
  if (hotspots.length === 0) {
    return [
      'Aucun point chaud mesurable. Commencez par les fichiers d’entrée et ajoutez un historique Git pour enrichir ce classement.',
      '',
    ];
  }
  const lines = ['| Rang | Fichier | Risque | Score | Pourquoi |', '|---:|---|---|---:|---|'];
  hotspots.forEach((hotspot, index) => {
    lines.push(
      `| ${index + 1} | \`${markdownCell(hotspot.path)}\` | ${riskLabel(hotspot.level)} | ${hotspot.score}/100 | ${markdownCell(hotspot.reasons.join(' · ') || 'signal relatif')} |`
    );
  });
  lines.push('');
  return lines;
}

/** Render one complete Markdown artifact. */
export function renderRepoExplanationMarkdown(explanation: RepoExplanation): string {
  const lines: string[] = [
    `# Comprendre ${explanation.repo.name}`,
    '',
    `> Analyse ${explanation.repo.depth === 'deep' ? 'approfondie' : 'rapide'} générée le ${explanation.repo.generatedAt}. ${explanation.repo.totalFiles} fichiers observés, dont ${explanation.repo.sourceFiles} source et ${explanation.repo.testFiles} test(s).`,
    '',
    '## 1. À quoi sert ce repo',
    '',
    explanation.repo.purpose,
    '',
    `- **Langages :** ${explanation.overview.languages.map(languageLabel).join(', ') || 'non détectés'}`,
    `- **Frameworks :** ${explanation.overview.frameworks.join(', ') || 'non détectés'}`,
    `- **Gestionnaire de paquets :** ${explanation.overview.packageManager ?? 'non détecté'}`,
    `- **Tests :** ${explanation.overview.testFramework ?? (explanation.repo.testFiles > 0 ? 'présents, framework non détecté' : 'non détectés')}`,
  ];

  if (explanation.overview.dependencies.length > 0) {
    lines.push(
      `- **Dépendances structurantes :** ${explanation.overview.dependencies.map((dependency) => `\`${dependency}\``).join(', ')}`
    );
  }

  lines.push('', '### Entrées principales', '');
  if (explanation.overview.entryPoints.length === 0) {
    lines.push(
      '- Aucune entrée conventionnelle détectée; partez du manifeste et du premier module listé ci-dessous.'
    );
  } else {
    for (const entry of explanation.overview.entryPoints) {
      const symbols =
        entry.exportedSymbols.length > 0
          ? ` — exports : ${entry.exportedSymbols.map((symbol) => `\`${symbol}\``).join(', ')}`
          : '';
      lines.push(`- \`${entry.path}\` — ${entry.reason}${symbols}`);
    }
  }

  lines.push(
    '',
    '## 2. Architecture',
    '',
    `Style détecté : **${explanation.architecture.style}**.`,
    '',
    '| Module / dossier | Rôle | Fichiers |',
    '|---|---|---:|'
  );
  if (explanation.architecture.modules.length === 0) {
    lines.push('| *(aucun module détecté)* | Dépôt minimal | 0 |');
  } else {
    for (const module of explanation.architecture.modules) {
      lines.push(
        `| \`${markdownCell(module.directory)}\` | ${markdownCell(module.purpose)} | ${module.fileCount} |`
      );
    }
  }

  if (explanation.architecture.centralModules.length > 0) {
    lines.push(
      '',
      `Modules les plus importés : ${explanation.architecture.centralModules
        .map((module) => `\`${module.path}\` (${module.importedBy})`)
        .join(', ')}.`
    );
  }

  lines.push(
    '',
    '### Diagramme de dépendances',
    '',
    `Source : **${explanation.architecture.diagram.source === 'code-explorer' ? 'Code Explorer' : 'analyse locale'}** — ${explanation.architecture.diagram.note}`,
    '',
    '```mermaid',
    explanation.architecture.diagram.mermaid,
    '```',
    '',
    '## 3. Points chauds et risques',
    ''
  );

  if (explanation.risks.complexity) {
    const summary = explanation.risks.complexity;
    lines.push(
      `Complexité : ${summary.totalFunctions ?? 0} fonction(s) mesurée(s), moyenne ${summary.averageComplexity?.toFixed(1) ?? 'n/a'}, maximum ${summary.maxComplexity ?? 'n/a'}, note globale ${summary.overallRating ?? 'n/a'}.`,
      ''
    );
  }
  const evolution = explanation.risks.evolution;
  const evolutionTrends = evolution?.trends;
  if (evolution && evolutionTrends) {
    lines.push(
      `Évolution Git : code **${evolutionTrends.locTrend ?? 'stable'}**, fichiers **${evolutionTrends.fileTrend ?? 'stable'}**, variation LOC ${formatSigned(evolution.summary?.locChange)} (${formatSigned(evolution.summary?.locChangePercent)} %).`,
      ''
    );
  } else if (!explanation.risks.gitAvailable) {
    lines.push('Historique Git absent : aucun churn n’est inventé.', '');
  }
  lines.push(...renderMarkdownHotspots(explanation.risks.hotspots));

  lines.push('## 4. Par où commencer', '');
  if (explanation.gettingStarted.path.length === 0) {
    lines.push('1. Lisez le manifeste ou ajoutez un README décrivant le rôle du dépôt.');
  } else {
    explanation.gettingStarted.path.forEach((filePath, index) => {
      lines.push(`${index + 1}. Ouvrez \`${filePath}\`.`);
    });
  }

  if (Object.keys(explanation.gettingStarted.commands).length > 0) {
    lines.push('', '### Commandes utiles', '', '```text');
    for (const [name, command] of Object.entries(explanation.gettingStarted.commands)) {
      lines.push(`${name.padEnd(12)} ${command}`);
    }
    lines.push('```');
  }

  lines.push('', '### Documentation et tests', '');
  lines.push(
    explanation.gettingStarted.docs.length > 0
      ? `- Documentation : ${explanation.gettingStarted.docs.map((filePath) => `\`${filePath}\``).join(', ')}`
      : '- Documentation : aucun fichier évident détecté.'
  );
  lines.push(
    explanation.gettingStarted.tests.length > 0
      ? `- Tests représentatifs : ${explanation.gettingStarted.tests.map((filePath) => `\`${filePath}\``).join(', ')}`
      : '- Tests : aucun fichier de test évident détecté.'
  );

  lines.push('', '## Limites de cette lecture', '');
  if (explanation.limitations.length === 0) {
    lines.push('- Aucun repli notable pendant la collecte.');
  } else {
    for (const limitation of explanation.limitations) lines.push(`- ${limitation}`);
  }
  lines.push('', '---', '', 'Généré localement par `buddy explain` — aucun appel LLM requis.', '');
  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderPills(values: string[], empty: string): string {
  const items = values.length > 0 ? values : [empty];
  return items.map((value) => `<span class="pill">${escapeHtml(value)}</span>`).join('');
}

function renderHtmlHotspot(hotspot: RepoHotspot, index: number): string {
  return `<article class="hotspot risk-${hotspot.level}">
    <div class="rank">${String(index + 1).padStart(2, '0')}</div>
    <div class="hotspot-main">
      <div class="hotspot-head"><code>${escapeHtml(hotspot.path)}</code><span>${escapeHtml(riskLabel(hotspot.level))}</span></div>
      <p>${escapeHtml(hotspot.reasons.join(' · ') || 'Signal relatif')}</p>
    </div>
    <strong>${hotspot.score}</strong>
  </article>`;
}

const REPO_EXPLANATION_CSS = `
  :root {
    color-scheme: dark;
    --page: #081019;
    --panel: #101b28;
    --panel-soft: #142334;
    --line: #26384a;
    --text: #eff7ff;
    --muted: #8fa3b8;
    --cyan: #56d6e8;
    --blue: #7da7ff;
    --green: #6ee7b7;
    --amber: #f4c86a;
    --red: #ff8190;
    --shadow: 0 24px 70px rgba(0, 0, 0, .3);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    color: var(--text);
    background:
      radial-gradient(circle at 15% -10%, rgba(86, 214, 232, .13), transparent 34rem),
      radial-gradient(circle at 92% 6%, rgba(125, 167, 255, .12), transparent 30rem),
      var(--page);
    font: 15px/1.65 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
  .hero { padding: 72px 0 42px; }
  .brand { color: var(--cyan); font-size: 12px; font-weight: 850; letter-spacing: .16em; text-transform: uppercase; }
  h1 { max-width: 900px; margin: 20px 0 16px; font-size: clamp(36px, 7vw, 72px); line-height: 1; letter-spacing: -.05em; }
  .dek { max-width: 780px; margin: 0; color: #bdcbd8; font-size: 18px; }
  .meta, .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
  .meta span, .pill { border: 1px solid var(--line); border-radius: 999px; padding: 5px 10px; color: #b9cad9; background: rgba(16, 27, 40, .75); font: 12px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
  nav { position: sticky; top: 0; z-index: 2; border-block: 1px solid rgba(38, 56, 74, .8); background: rgba(8, 16, 25, .9); backdrop-filter: blur(14px); }
  nav .shell { display: flex; gap: 8px; overflow-x: auto; padding-block: 10px; }
  nav a { border-radius: 8px; padding: 6px 10px; color: var(--muted); text-decoration: none; white-space: nowrap; font-size: 12px; }
  nav a:hover { color: var(--text); background: var(--panel); }
  main { padding: 38px 0 68px; }
  section { margin-bottom: 28px; padding: 28px; border: 1px solid var(--line); border-radius: 22px; background: linear-gradient(145deg, rgba(20, 35, 52, .94), rgba(11, 21, 32, .95)); box-shadow: var(--shadow); }
  .section-number { color: var(--cyan); font: 800 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .12em; }
  h2 { margin: 10px 0 18px; font-size: clamp(24px, 4vw, 36px); letter-spacing: -.03em; }
  h3 { margin: 25px 0 10px; color: #dce9f5; font-size: 16px; }
  p { margin: 8px 0; }
  .muted { color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .card { min-width: 0; padding: 17px; border: 1px solid var(--line); border-radius: 14px; background: rgba(7, 14, 22, .48); }
  .card strong { display: block; margin-bottom: 6px; color: #dbe8f4; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; }
  code { overflow-wrap: anywhere; }
  .entries, .steps, .plain-list { margin: 0; padding-left: 22px; }
  .entries li, .steps li, .plain-list li { margin: 7px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th, td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { color: var(--muted); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
  td:last-child, th:last-child { text-align: right; }
  .diagram { margin-top: 14px; padding: 18px; border: 1px solid var(--line); border-radius: 15px; background: #07101a; overflow: auto; }
  .diagram img { display: block; max-width: 100%; height: auto; margin: auto; }
  .diagram pre { margin: 0; color: #c3d5e4; white-space: pre; }
  .hotspot { display: grid; grid-template-columns: 42px minmax(0, 1fr) 48px; gap: 12px; align-items: center; margin-top: 9px; padding: 14px; border: 1px solid var(--line); border-left: 3px solid var(--amber); border-radius: 12px; background: rgba(7, 14, 22, .48); }
  .hotspot.risk-critical { border-left-color: var(--red); }
  .hotspot.risk-high { border-left-color: #ffad72; }
  .hotspot.risk-low { border-left-color: var(--green); }
  .rank { color: var(--muted); font: 800 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .hotspot-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .hotspot-head span { color: var(--muted); font-size: 11px; text-transform: uppercase; }
  .hotspot p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
  .hotspot > strong { color: var(--amber); font: 800 18px/1 ui-monospace, SFMono-Regular, Consolas, monospace; text-align: right; }
  .commands { padding: 14px; border-radius: 12px; color: #c5e5d8; background: #07110e; white-space: pre-wrap; }
  footer { padding: 26px 0 48px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
  @media (max-width: 720px) {
    .shell { width: min(100% - 20px, 1120px); }
    .hero { padding-top: 44px; }
    section { padding: 19px; border-radius: 16px; }
    .grid { grid-template-columns: 1fr; }
    .hotspot { grid-template-columns: 30px minmax(0, 1fr); }
    .hotspot > strong { display: none; }
    .hotspot-head { display: block; }
    table { display: block; overflow-x: auto; }
  }
  @media print {
    :root { color-scheme: light; --page: #fff; --panel: #fff; --panel-soft: #fff; --line: #d6dde5; --text: #172230; --muted: #5b6978; --shadow: none; }
    body { background: #fff; }
    nav { display: none; }
    section, .card, .hotspot { break-inside: avoid; background: #fff; }
  }
`;

/** Render one complete, zero-CDN HTML artifact. */
export function renderRepoExplanationHtml(
  explanation: RepoExplanation,
  options: RepoExplanationHtmlOptions = {}
): string {
  const diagramDataUri = options.diagramDataUri?.startsWith('data:image/png;base64,')
    ? options.diagramDataUri
    : undefined;
  const frameworkValues =
    explanation.overview.frameworks.length > 0
      ? explanation.overview.frameworks
      : ['Aucun framework détecté'];
  const languageValues = explanation.overview.languages.map(languageLabel);
  const entryHtml =
    explanation.overview.entryPoints.length > 0
      ? explanation.overview.entryPoints
          .map(
            (entry) =>
              `<li><code>${escapeHtml(entry.path)}</code> — ${escapeHtml(entry.reason)}${entry.exportedSymbols.length > 0 ? `<div class="muted">Exports : ${escapeHtml(entry.exportedSymbols.join(', '))}</div>` : ''}</li>`
          )
          .join('')
      : '<li>Aucune entrée conventionnelle détectée.</li>';
  const moduleRows =
    explanation.architecture.modules.length > 0
      ? explanation.architecture.modules
          .map(
            (module) =>
              `<tr><td><code>${escapeHtml(module.directory)}</code></td><td>${escapeHtml(module.purpose)}</td><td>${module.fileCount}</td></tr>`
          )
          .join('')
      : '<tr><td>Dépôt minimal</td><td>Aucun module détecté</td><td>0</td></tr>';
  const diagramHtml = diagramDataUri
    ? `<img src="${diagramDataUri}" alt="Diagramme local des dépendances">`
    : `<pre><code>${escapeHtml(explanation.architecture.diagram.mermaid)}</code></pre><p class="muted">Le moteur Mermaid local n’était pas disponible; la source reste exploitable et aucun CDN n’a été chargé.</p>`;
  const hotspotsHtml =
    explanation.risks.hotspots.length > 0
      ? explanation.risks.hotspots.map(renderHtmlHotspot).join('')
      : '<p class="muted">Aucun point chaud mesurable. Aucun risque n’est inventé.</p>';
  const commandText = Object.entries(explanation.gettingStarted.commands)
    .map(([name, command]) => `${name.padEnd(12)} ${command}`)
    .join('\n');
  const pathHtml =
    explanation.gettingStarted.path.length > 0
      ? explanation.gettingStarted.path
          .map((filePath) => `<li>Ouvrez <code>${escapeHtml(filePath)}</code>.</li>`)
          .join('')
      : '<li>Lisez le manifeste ou ajoutez un README décrivant le projet.</li>';
  const limitations =
    explanation.limitations.length > 0
      ? explanation.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('')
      : '<li>Aucun repli notable pendant la collecte.</li>';

  const body = `<header class="hero shell">
    <div class="brand">Code Buddy · Repo Explain</div>
    <h1>${escapeHtml(explanation.repo.name)}</h1>
    <p class="dek">${escapeHtml(explanation.repo.purpose)}</p>
    <div class="meta">
      <span>${explanation.repo.depth === 'deep' ? 'analyse approfondie' : 'analyse rapide'}</span>
      <span>${explanation.repo.totalFiles} fichiers</span>
      <span>${explanation.repo.sourceFiles} source</span>
      <span>${explanation.repo.testFiles} tests</span>
      <span>${escapeHtml(explanation.repo.generatedAt)}</span>
    </div>
  </header>
  <nav><div class="shell"><a href="#overview">Vue d’ensemble</a><a href="#architecture">Architecture</a><a href="#risks">Risques</a><a href="#start">Démarrage</a></div></nav>
  <main class="shell">
    <section id="overview">
      <div class="section-number">01</div><h2>À quoi sert ce repo</h2>
      <p>${escapeHtml(explanation.repo.purpose)}</p>
      <div class="grid">
        <div class="card"><strong>Langages</strong><div class="pills">${renderPills(languageValues, 'Non détectés')}</div></div>
        <div class="card"><strong>Frameworks</strong><div class="pills">${renderPills(frameworkValues, 'Non détectés')}</div></div>
        <div class="card"><strong>Outillage</strong><p>${escapeHtml(explanation.overview.packageManager ?? 'Gestionnaire non détecté')} · ${escapeHtml(explanation.overview.testFramework ?? 'Tests non identifiés')}</p></div>
        <div class="card"><strong>Dépendances structurantes</strong><p>${escapeHtml(explanation.overview.dependencies.join(', ') || 'Non détectées')}</p></div>
      </div>
      <h3>Entrées principales</h3><ul class="entries">${entryHtml}</ul>
    </section>
    <section id="architecture">
      <div class="section-number">02</div><h2>Architecture</h2>
      <p>Style détecté : <strong>${escapeHtml(explanation.architecture.style)}</strong>.</p>
      <table><thead><tr><th>Module / dossier</th><th>Rôle</th><th>Fichiers</th></tr></thead><tbody>${moduleRows}</tbody></table>
      <h3>Diagramme de dépendances</h3>
      <p class="muted">${escapeHtml(explanation.architecture.diagram.note)} Source : ${explanation.architecture.diagram.source === 'code-explorer' ? 'Code Explorer' : 'analyse locale'}.</p>
      <div class="diagram">${diagramHtml}</div>
    </section>
    <section id="risks">
      <div class="section-number">03</div><h2>Points chauds et risques</h2>
      ${explanation.risks.complexity ? `<p class="muted">${explanation.risks.complexity.totalFunctions ?? 0} fonction(s) mesurée(s) · complexité max ${explanation.risks.complexity.maxComplexity ?? 'n/a'} · note ${escapeHtml(explanation.risks.complexity.overallRating ?? 'n/a')}</p>` : ''}
      ${hotspotsHtml}
    </section>
    <section id="start">
      <div class="section-number">04</div><h2>Par où commencer</h2>
      <ol class="steps">${pathHtml}</ol>
      ${commandText ? `<h3>Commandes utiles</h3><pre class="commands"><code>${escapeHtml(commandText)}</code></pre>` : ''}
      <div class="grid">
        <div class="card"><strong>Documentation</strong><p>${escapeHtml(explanation.gettingStarted.docs.join(', ') || 'Aucun fichier évident')}</p></div>
        <div class="card"><strong>Tests représentatifs</strong><p>${escapeHtml(explanation.gettingStarted.tests.join(', ') || 'Aucun fichier évident')}</p></div>
      </div>
      <h3>Limites de cette lecture</h3><ul class="plain-list">${limitations}</ul>
    </section>
  </main>
  <footer><div class="shell"><strong>Code Buddy</strong> · Artefact autonome, généré localement sans appel LLM ni ressource réseau.</div></footer>`;

  return exportStandaloneHtmlDocument({
    lang: 'fr',
    title: `${explanation.repo.name} — Comprendre le repo — Code Buddy`,
    styles: REPO_EXPLANATION_CSS,
    bodyHtml: body,
  });
}
