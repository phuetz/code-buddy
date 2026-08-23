#!/usr/bin/env node
/**
 * Cold-start bench for ST3c. Not part of the product.
 *
 * Usage:
 *   node docs/perf/_bench-st3c.mjs probe
 *   node docs/perf/_bench-st3c.mjs tui
 *   node docs/perf/_bench-st3c.mjs tui --runs 12
 *
 * Compares origin/main (frozen dist-main-bench) vs serial / prefetch / light
 * (compiled dist/index.js + CODEBUDDY_COLD_START_VARIANT). Unset default of
 * dist/ is `light` (ST3c winner). TUI runs are interleaved so the four trees
 * share the same thermal regime.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2] || 'tui';
const runsArg = process.argv.indexOf('--runs');
const TUI_RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 12;
const TUI_TIMEOUT_MS = 8000;
const node = process.execPath;

const TARGETS = [
  {
    label: 'main',
    dist: resolve('dist-main-bench/index.js'),
    env: {},
  },
  {
    label: 'serial',
    dist: resolve('dist/index.js'),
    env: { CODEBUDDY_COLD_START_VARIANT: 'serial' },
  },
  {
    label: 'prefetch',
    dist: resolve('dist/index.js'),
    env: { CODEBUDDY_COLD_START_VARIANT: 'prefetch' },
  },
  {
    label: 'light',
    dist: resolve('dist/index.js'),
    env: { CODEBUDDY_COLD_START_VARIANT: 'light' },
  },
];

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const pct = (p) => {
    const i = (n - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  return {
    n,
    min: s[0],
    p10: pct(0.1),
    median: pct(0.5),
    p90: pct(0.9),
    max: s[n - 1],
    mean,
    stddev: Math.sqrt(variance),
  };
}

function fmt(ms) {
  return `${ms.toFixed(2)}`;
}

function parsePhases(text) {
  const phases = {};
  const re = /(?:INFO|WARN|ERROR)\s+(.+?):\s+(\d+)ms/g;
  let m;
  while ((m = re.exec(text))) {
    phases[m[1].trim()] = Number(m[2]);
  }
  const totals = [...text.matchAll(/Total time:\s+(\d+)ms/g)];
  if (totals.length) phases.__total = Number(totals[totals.length - 1][1]);
  return phases;
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra, NO_COLOR: '1' };
  delete env.FORCE_COLOR;
  return env;
}

function measureTuiOnce(dist, extraEnv = {}) {
  return new Promise((resolveOnce) => {
    const t0 = process.hrtime.bigint();
    const wall = {
      firstPaintAppMs: null,
      firstPaintWallMs: null,
      assistantLineWallMs: null,
      bannerWallMs: null,
      agentReadyAppMs: null,
      uiRenderAppMs: null,
      splashRenderDoneAppMs: null,
      renderersAwaitStartAppMs: null,
    };
    const child = spawn(
      'script',
      [
        '-qec',
        `${node} ${JSON.stringify(dist)} --no-alt-screen --ephemeral`,
        '/dev/null',
      ],
      {
        env: cleanEnv({
          PERF_TIMING: 'true',
          CODEBUDDY_PROVIDER: 'chatgpt',
          ...extraEnv,
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    const onData = (buf) => {
      const chunk = buf.toString('utf8');
      out += chunk;
      const now = Number(process.hrtime.bigint() - t0) / 1e6;
      if (wall.firstPaintWallMs == null && /ui-first-render:\s+\d+ms/.test(out)) {
        wall.firstPaintWallMs = now;
      }
      if (wall.assistantLineWallMs == null && /Starting Code Buddy Conversational Assistant/.test(out)) {
        wall.assistantLineWallMs = now;
      }
      if (wall.bannerWallMs == null && /██████╗ █████╗ ██████╗ ███████╗/.test(out)) {
        wall.bannerWallMs = now;
      }
      if (wall.bannerWallMs != null && wall.assistantLineWallMs != null) {
        child.kill('SIGTERM');
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const killer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 400);
    }, TUI_TIMEOUT_MS);
    child.on('close', () => {
      clearTimeout(killer);
      const phases = parsePhases(out);
      wall.firstPaintAppMs = phases['ui-first-render'] ?? null;
      wall.agentReadyAppMs = phases['agent-ready-render'] ?? null;
      wall.uiRenderAppMs = phases['ui-render'] ?? null;
      wall.splashRenderDoneAppMs = phases['splash-render-done'] ?? null;
      wall.renderersAwaitStartAppMs = phases['renderers-await-start'] ?? null;
      resolveOnce({ phases, wall, sawBanner: wall.bannerWallMs != null, outTail: out.slice(-2500) });
    });
  });
}

function summarize(name, s) {
  return s
    ? `${name}: n=${s.n} median=${fmt(s.median)} mean=${fmt(s.mean)} p10=${fmt(s.p10)} p90=${fmt(s.p90)} min=${fmt(s.min)} max=${fmt(s.max)} sd=${fmt(s.stddev)}`
    : `${name}: (no samples)`;
}

function collect() {
  return {
    firstPaintApp: [],
    uiRenderApp: [],
    agentReadyApp: [],
    firstPaintWall: [],
    assistantLineWall: [],
    bannerWall: [],
    splashRenderDoneApp: [],
    renderersAwaitStartApp: [],
    raw: [],
  };
}

function pushSample(bucket, sample) {
  bucket.raw.push({ phases: sample.phases, wall: sample.wall, sawBanner: sample.sawBanner });
  const { phases, wall } = sample;
  if (typeof wall.firstPaintAppMs === 'number') bucket.firstPaintApp.push(wall.firstPaintAppMs);
  if (typeof wall.uiRenderAppMs === 'number') bucket.uiRenderApp.push(wall.uiRenderAppMs);
  if (typeof wall.agentReadyAppMs === 'number') bucket.agentReadyApp.push(wall.agentReadyAppMs);
  if (typeof wall.firstPaintWallMs === 'number') bucket.firstPaintWall.push(wall.firstPaintWallMs);
  if (typeof wall.assistantLineWallMs === 'number') bucket.assistantLineWall.push(wall.assistantLineWallMs);
  if (typeof wall.bannerWallMs === 'number') bucket.bannerWall.push(wall.bannerWallMs);
  if (typeof wall.splashRenderDoneAppMs === 'number') bucket.splashRenderDoneApp.push(wall.splashRenderDoneAppMs);
  if (typeof wall.renderersAwaitStartAppMs === 'number') bucket.renderersAwaitStartApp.push(wall.renderersAwaitStartAppMs);
  void phases;
}

function bucketStats(bucket) {
  return {
    firstPaintApp: stats(bucket.firstPaintApp),
    uiRenderApp: stats(bucket.uiRenderApp),
    agentReadyApp: stats(bucket.agentReadyApp),
    firstPaintWall: stats(bucket.firstPaintWall),
    assistantLineWall: stats(bucket.assistantLineWall),
    bannerWall: stats(bucket.bannerWall),
    splashRenderDoneApp: stats(bucket.splashRenderDoneApp),
    renderersAwaitStartApp: stats(bucket.renderersAwaitStartApp),
    raw: bucket.raw,
  };
}

async function main() {
  for (const t of TARGETS) {
    if (!existsSync(t.dist)) {
      console.error(`missing dist: ${t.dist}`);
      process.exit(1);
    }
  }

  const report = {
    mode,
    node: process.version,
    startedAt: new Date().toISOString(),
    runs: mode === 'probe' ? 1 : TUI_RUNS,
    targets: TARGETS.map((t) => ({ label: t.label, dist: t.dist, env: t.env })),
  };

  if (mode === 'probe') {
    for (const t of TARGETS) {
      console.error(`[probe] ${t.label}`);
      const sample = await measureTuiOnce(t.dist, t.env);
      report[t.label] = sample;
      console.error(
        `  appFirst=${sample.wall.firstPaintAppMs ?? '-'} appUiRender=${sample.wall.uiRenderAppMs ?? '-'} appAgentReady=${sample.wall.agentReadyAppMs ?? '-'} wallFirst=${sample.wall.firstPaintWallMs?.toFixed(0) ?? '-'} wallBanner=${sample.wall.bannerWallMs?.toFixed(0) ?? '-'} wallAssist=${sample.wall.assistantLineWallMs?.toFixed(0) ?? '-'}`,
      );
      console.error(`  phases=${JSON.stringify(sample.phases)}`);
    }
  } else {
    const buckets = Object.fromEntries(TARGETS.map((t) => [t.label, collect()]));
    console.error(`[tui] interleaved n=${TUI_RUNS} targets=${TARGETS.map((t) => t.label).join(',')}`);
    for (let i = 0; i < TUI_RUNS; i++) {
      for (const t of TARGETS) {
        const sample = await measureTuiOnce(t.dist, t.env);
        pushSample(buckets[t.label], sample);
        console.error(
          `  ${t.label} ${i + 1}/${TUI_RUNS} appFirst=${sample.wall.firstPaintAppMs ?? '-'} appUiRender=${sample.wall.uiRenderAppMs ?? '-'} wallFirst=${sample.wall.firstPaintWallMs?.toFixed(0) ?? '-'} wallBanner=${sample.wall.bannerWallMs?.toFixed(0) ?? '-'} keys=${Object.keys(sample.phases).join(',')}`,
        );
      }
    }
    for (const t of TARGETS) {
      report[t.label] = bucketStats(buckets[t.label]);
    }
  }

  const outPath = resolve(`docs/perf/_bench-st3c-${mode}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.error(`wrote ${outPath}`);

  if (mode !== 'probe') {
    for (const t of TARGETS) {
      const s = report[t.label];
      console.error(`\n=== ${t.label} ===`);
      console.error(summarize('TUI app ui-first-render', s.firstPaintApp));
      console.error(summarize('TUI app ui-render (agent-ready)', s.uiRenderApp));
      console.error(summarize('TUI app agent-ready-render', s.agentReadyApp));
      console.error(summarize('TUI wall to ui-first-render line', s.firstPaintWall));
      console.error(summarize('TUI wall to assistant line', s.assistantLineWall));
      console.error(summarize('TUI wall to ASCII banner', s.bannerWall));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
