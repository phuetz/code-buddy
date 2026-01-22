/**
 * Sparkline Generator
 *
 * Generates compact SVG sparkline charts.
 */

import D3Node from 'd3-node';
import type { ChartOptions } from './types.js';
import { DEFAULT_CHART_OPTIONS } from './types.js';

export function generateSparklineSVG(values: number[], options: ChartOptions = {}): string {
  const opts = {
    ...DEFAULT_CHART_OPTIONS,
    width: 100,
    height: 30,
    showGrid: false,
    showLabels: false,
    padding: { top: 5, right: 5, bottom: 5, left: 5 },
    ...options
  };
  const { width, height, padding } = opts;
  const p = padding!;

  const d3n = new D3Node();
  const d3 = d3n.d3;

  const svg = d3n.createSVG(width, height);

  // Transparent background for sparkline
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', opts.backgroundColor || 'transparent');

  if (values.length < 2) return d3n.svgString();

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  const xScale = d3.scaleLinear()
    .domain([0, values.length - 1])
    .range([p.left, width! - p.right]);

  const yScale = d3.scaleLinear()
    .domain([minVal, maxVal])
    .range([height! - p.bottom, p.top]);

  // Determine color based on trend
  const isUp = values[values.length - 1] >= values[0];
  const lineColor = opts.lineColor || (isUp ? '#00ff88' : '#ff4444');

  // Area
  const area = d3.area<number>()
    .x((_d: number, i: number) => xScale(i))
    .y0(height! - p.bottom)
    .y1((d: number) => yScale(d));

  svg.append('path')
    .datum(values)
    .attr('fill', lineColor)
    .attr('fill-opacity', 0.2)
    .attr('d', area);

  // Line
  const line = d3.line<number>()
    .x((_d: number, i: number) => xScale(i))
    .y((d: number) => yScale(d));

  svg.append('path')
    .datum(values)
    .attr('fill', 'none')
    .attr('stroke', lineColor)
    .attr('stroke-width', 1.5)
    .attr('d', line);

  // End point
  svg.append('circle')
    .attr('cx', xScale(values.length - 1))
    .attr('cy', yScale(values[values.length - 1]))
    .attr('r', 2)
    .attr('fill', lineColor);

  return d3n.svgString();
}
