/**
 * Frozen C1-1005 corpus: 10 real loops + 10 legitimate long sessions.
 * Observations feed the real StagnationDetector (no reimplementation).
 */
import type { StagnationObservation } from '../../src/agent/execution/stagnation-detector.js';

export type CorpusKind = 'loop' | 'legit';

export interface CorpusTrajectory {
  id: string;
  kind: CorpusKind;
  label: string;
  /** Ideal: detector should fire (true) or stay silent (false). */
  expectDetect: boolean;
  observations: StagnationObservation[];
}

const view = (path: string, start_line = 1, success = true): StagnationObservation => ({
  name: 'view_file',
  argumentsJson: JSON.stringify({ path, start_line }),
  success,
});
const bash = (command: string, success = true): StagnationObservation => ({
  name: 'bash',
  argumentsJson: JSON.stringify({ command }),
  success,
});
const execCode = (code: string, success = true): StagnationObservation => ({
  name: 'execute_code',
  argumentsJson: JSON.stringify({ code }),
  success,
});
const search = (query: string, success = true): StagnationObservation => ({
  name: 'codebase_search',
  argumentsJson: JSON.stringify({ query }),
  success,
});
const write = (path: string, success = true): StagnationObservation => ({
  name: 'create_file',
  argumentsJson: JSON.stringify({ path, content: 'x' }),
  success,
});
const edit = (path: string, success = true): StagnationObservation => ({
  name: 'str_replace_editor',
  argumentsJson: JSON.stringify({ path, old_str: 'a', new_str: 'b' }),
  success,
});

export const STAGNATION_CORPUS: CorpusTrajectory[] = [
  {
    id: 'R01', kind: 'loop', label: 'relecture même fichier plages différentes',
    expectDetect: true,
    observations: Array.from({ length: 55 }, (_, i) => view('src/config/model-price-data.ts', i * 40 + 1)),
  },
  {
    id: 'R02', kind: 'loop', label: 'alternance view a.ts / b.ts',
    expectDetect: true,
    observations: Array.from({ length: 55 }, (_, i) => view(i % 2 ? 'a.ts' : 'b.ts', i)),
  },
  {
    id: 'R03', kind: 'loop', label: 'même view_file path+start_line identiques',
    expectDetect: true,
    observations: Array.from({ length: 55 }, () => view('stuck.ts', 1)),
  },
  {
    id: 'R04', kind: 'loop', label: 'execute_code sed -n même fichier',
    expectDetect: true,
    observations: Array.from({ length: 55 }, (_, i) =>
      execCode(`sed -n '${i},${i + 40}p' src/config/model-price-data.ts`)),
  },
  {
    id: 'R05', kind: 'loop', label: 'codebase_search sans écriture ×90',
    expectDetect: true,
    observations: Array.from({ length: 90 }, (_, i) => search(`how does X work variant ${i}`)),
  },
  {
    id: 'R06', kind: 'loop', label: 'bash npm test répété sans edit',
    expectDetect: true,
    observations: Array.from({ length: 70 }, () => bash('npm test -- --run tests/foo.test.ts')),
  },
  {
    id: 'R07', kind: 'loop', label: 'écritures refusées puis relectures',
    expectDetect: true,
    observations: [
      ...Array.from({ length: 10 }, () => write('/outside/x.md', false)),
      ...Array.from({ length: 50 }, (_, i) => view('a.ts', i)),
    ],
  },
  {
    id: 'R08', kind: 'loop', label: 'cycle grep A/B sans progression',
    expectDetect: true,
    observations: Array.from({ length: 55 }, (_, i) =>
      bash(`grep -n pattern ${i % 2 ? 'src/a.ts' : 'src/b.ts'}`)),
  },
  {
    id: 'R09', kind: 'loop', label: '3 fichiers relus en boucle',
    expectDetect: true,
    observations: Array.from({ length: 55 }, (_, i) => view(`f${i % 3}.ts`, Math.floor(i / 3))),
  },
  {
    id: 'R10', kind: 'loop', label: 'search+view même cible sans write',
    expectDetect: true,
    observations: Array.from({ length: 55 }, (_, i) =>
      (i % 2 === 0 ? search('auth middleware') : view('src/auth.ts', i))),
  },
  {
    id: 'L01', kind: 'legit', label: 'refactor multi-fichiers view+edit',
    expectDetect: false,
    observations: Array.from({ length: 80 }, (_, i) => {
      const f = `src/mod${i % 20}.ts`;
      return i % 4 === 3 ? edit(f, true) : view(f, (i % 10) + 1);
    }),
  },
  {
    id: 'L02', kind: 'legit', label: 'edit puis npm test qui progresse',
    expectDetect: false,
    observations: Array.from({ length: 60 }, (_, i) => {
      if (i % 3 === 0) return edit('src/feature.ts', true);
      if (i % 3 === 1) return bash('npm test -- --run tests/feature.test.ts');
      return view('src/feature.ts', i);
    }),
  },
  {
    id: 'L03', kind: 'legit', label: 'lecture 55 fichiers distincts puis write',
    expectDetect: false,
    observations: [
      ...Array.from({ length: 55 }, (_, i) => view(`pkg/file${i}.ts`, 1)),
      write('notes/summary.md', true),
      ...Array.from({ length: 10 }, (_, i) => view(`pkg/file${i}.ts`, 2)),
    ],
  },
  {
    id: 'L04', kind: 'legit', label: 'migration write cible différente chaque fois',
    expectDetect: false,
    observations: Array.from({ length: 80 }, (_, i) =>
      (i % 2 === 0 ? view(`legacy/m${i}.ts`, 1) : edit(`legacy/m${i - 1}.ts`, true))),
  },
  {
    id: 'L05', kind: 'legit', label: 'gros fichier lu en 40 chunks (légitime)',
    expectDetect: false,
    observations: [
      ...Array.from({ length: 40 }, (_, i) => view('src/huge-generated.ts', i * 100 + 1)),
      write('out/analysis.md', true),
    ],
  },
  {
    id: 'L06', kind: 'legit', label: '45 fichiers distincts sans write (sous streakAlone)',
    expectDetect: false,
    observations: Array.from({ length: 45 }, (_, i) => view(`lib/c${i}.ts`, 1)),
  },
  {
    id: 'L07', kind: 'legit', label: '40 fichiers avec au plus 2 lectures chacun',
    expectDetect: false,
    observations: Array.from({ length: 40 }, (_, i) => view(`src/s${Math.floor(i / 2)}.ts`, i % 5)),
  },
  {
    id: 'L08', kind: 'legit', label: 'build/test + writes livrables',
    expectDetect: false,
    observations: Array.from({ length: 70 }, (_, i) => {
      if (i % 5 === 4) return write(`dist-notes/step${Math.floor(i / 5)}.md`, true);
      if (i % 5 === 3) return bash('npm run build');
      return view(`src/app${i % 8}.ts`, i);
    }),
  },
  {
    id: 'L09', kind: 'legit', label: 'search puis view résultats distincts + write',
    expectDetect: false,
    observations: [
      ...Array.from({ length: 20 }, (_, i) => search(`api endpoint ${i}`)),
      ...Array.from({ length: 20 }, (_, i) => view(`src/api/route${i}.ts`, 1)),
      write('docs/api-map.md', true),
      ...Array.from({ length: 15 }, (_, i) => view(`src/api/route${i}.ts`, 20)),
    ],
  },
  {
    id: 'L10', kind: 'legit', label: '100 tours avec write tous les 15',
    expectDetect: false,
    observations: Array.from({ length: 100 }, (_, i) =>
      (i > 0 && i % 15 === 0 ? edit(`src/w${i}.ts`, true) : view(`src/r${i % 30}.ts`, (i % 7) + 1))),
  },
];
