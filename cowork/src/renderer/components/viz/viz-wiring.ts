export type VizWiringEntry = {
  id: string;
  title: string;
  componentFile: string;
  logicFile?: string;
  testFile?: string;
  mount: string;
  needsData: string[];
};

export const vizWiring: VizWiringEntry[] = [
  {
    id: 'sparkline',
    title: 'Sparkline',
    componentFile: 'cowork/src/renderer/components/viz/Sparkline.tsx',
    logicFile: 'cowork/src/renderer/components/viz/util/scale.ts',
    testFile: 'cowork/tests/viz-scale.test.ts',
    mount: 'shared-viz',
    needsData: ['values:number[]'],
  },
  {
    id: 'bar-chart',
    title: 'BarChart',
    componentFile: 'cowork/src/renderer/components/viz/BarChart.tsx',
    logicFile: 'cowork/src/renderer/components/viz/util/bar-model.ts',
    testFile: 'cowork/tests/viz-bar-model.test.ts',
    mount: 'shared-viz',
    needsData: ['data:{label:string;value:number}[]', 'horizontal?:boolean'],
  },
  {
    id: 'donut',
    title: 'Donut',
    componentFile: 'cowork/src/renderer/components/viz/Donut.tsx',
    logicFile: 'cowork/src/renderer/components/viz/util/donut-model.ts',
    testFile: 'cowork/tests/viz-donut-model.test.ts',
    mount: 'shared-viz',
    needsData: ['segments:{label:string;value:number;tone?:string}[]'],
  },
  {
    id: 'heatmap',
    title: 'Heatmap',
    componentFile: 'cowork/src/renderer/components/viz/Heatmap.tsx',
    logicFile: 'cowork/src/renderer/components/viz/util/heat-model.ts',
    testFile: 'cowork/tests/viz-heat-model.test.ts',
    mount: 'shared-viz',
    needsData: ['rows:string[]', 'cols:string[]', 'cells:number[][]'],
  },
  {
    id: 'timeline-chart',
    title: 'TimelineChart',
    componentFile: 'cowork/src/renderer/components/viz/TimelineChart.tsx',
    logicFile: 'cowork/src/renderer/components/viz/util/timeline-model.ts',
    testFile: 'cowork/tests/viz-timeline-model.test.ts',
    mount: 'shared-viz',
    needsData: ['events:{t:number|string|Date;label:string;tone?:string}[]'],
  },
  {
    id: 'gauge-meter',
    title: 'GaugeMeter',
    componentFile: 'cowork/src/renderer/components/viz/GaugeMeter.tsx',
    logicFile: 'cowork/src/renderer/components/viz/util/gauge-model.ts',
    testFile: 'cowork/tests/viz-gauge-model.test.ts',
    mount: 'shared-viz',
    needsData: ['value:number', 'max:number', 'tone?:primary|success|warning|danger'],
  },
  {
    id: 'stacked-bar',
    title: 'StackedBar',
    componentFile: 'cowork/src/renderer/components/viz/StackedBar.tsx',
    logicFile: 'cowork/src/renderer/components/viz/util/stacked-model.ts',
    testFile: 'cowork/tests/viz-stacked-model.test.ts',
    mount: 'shared-viz',
    needsData: ['parts:{label:string;value:number;tone:string}[]'],
  },
];
