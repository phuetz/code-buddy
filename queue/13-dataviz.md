# Vague — Data-viz partagée (composants de graphes réutilisables)

Zone (fichiers neufs) : `cowork/src/renderer/components/viz/`, tests sous `cowork/tests/`. Composants props-driven, SANS lib externe (SVG/Canvas à la main). Réutilisables par les vues OS/Studio.

## Tranches (1 commit chacune)
1. **Sparkline** (`viz/Sparkline.tsx`) : mini-courbe SVG avec zone remplie + point final accentué. Props `{ values:number[]; width?; height?; tone? }`. `viz/util/scale.ts` (`niceScale`, `pathFromValues`) + test.
2. **BarChart** (`viz/BarChart.tsx`) : barres horizontales/verticales, valeurs, tri. Props `{ data:{label;value}[]; horizontal? }`. `viz/util/bar-model.ts` (`maxValue`, `barWidths`) + test.
3. **Donut** (`viz/Donut.tsx`) : donut SVG segments + légende. Props `{ segments:{label;value;tone?}[] }`. `viz/util/donut-model.ts` (`toArcs`, `percentages`) + test.
4. **Heatmap** (`viz/Heatmap.tsx`) : grille colorée (intensité). Props `{ rows; cols; cells:number[][] }`. `viz/util/heat-model.ts` (`normalizeCells`, `colorFor`) + test.
5. **TimelineChart** (`viz/TimelineChart.tsx`) : événements sur un axe temps. Props `{ events:{t;label;tone?}[] }`. `viz/util/timeline-model.ts` (`layoutEvents`, `timeRange`) + test.
6. **GaugeMeter** (`viz/GaugeMeter.tsx`) : jauge arc (utilisation/santé). Props `{ value; max; tone? }`. `viz/util/gauge-model.ts` (`angleFor`, `zoneOf`) + test.
7. **StackedBar** (`viz/StackedBar.tsx`) : barre empilée (répartition). Props `{ parts:{label;value;tone}[] }`. `viz/util/stacked-model.ts` + test.
8. **Manifeste** `viz/viz-wiring.ts` (data-only).
