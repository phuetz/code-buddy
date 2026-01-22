/**
 * Line Chart Generator
 *
 * Generates SVG line charts with optional area fill.
 */

import D3Node from 'd3-node';
import type { ChartOptions, LineChartData } from './types.js';
import { DEFAULT_CHART_OPTIONS, formatNumber } from './types.js';

export function generateLineChartSVG(data: LineChartData, options: ChartOptions = {}): string {
  const opts = { ...DEFAULT_CHART_OPTIONS, ...options };
  const { width, height, padding } = opts;
  const p = padding!;

  const d3n = new D3Node();
  const d3 = d3n.d3;

  const svg = d3n.createSVG(width, height);

  // Background
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', opts.backgroundColor);

  const chartHeight = height! - p.top - p.bottom;

  const values = data.values;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Scales
  const xScale = d3.scaleLinear()
    .domain([0, values.length - 1])
    .range([p.left, width! - p.right]);

  const yScale = d3.scaleLinear()
    .domain([minVal - range * 0.1, maxVal + range * 0.1])
    .range([height! - p.bottom, p.top]);

  // Grid
  if (opts.showGrid) {
    // Horizontal grid lines
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = p.top + (chartHeight / yTicks) * i;
      svg.append('line')
        .attr('x1', p.left)
        .attr('x2', width! - p.right)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', opts.gridColor)
        .attr('stroke-width', 0.5);
    }
  }

  // Area fill
  const area = d3.area<number>()
    .x((_d: number, i: number) => xScale(i))
    .y0(height! - p.bottom)
    .y1((d: number) => yScale(d));

  svg.append('path')
    .datum(values)
    .attr('fill', opts.fillColor)
    .attr('d', area);

  // Line
  const line = d3.line<number>()
    .x((_d: number, i: number) => xScale(i))
    .y((d: number) => yScale(d));

  svg.append('path')
    .datum(values)
    .attr('fill', 'none')
    .attr('stroke', opts.lineColor)
    .attr('stroke-width', 2)
    .attr('d', line);

  // Data points
  values.forEach((val, i) => {
    svg.append('circle')
      .attr('cx', xScale(i))
      .attr('cy', yScale(val))
      .attr('r', 3)
      .attr('fill', opts.lineColor);
  });

  // Y-axis labels
  if (opts.showLabels) {
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const val = minVal + (range / yTicks) * (yTicks - i);
      const y = p.top + (chartHeight / yTicks) * i;
      svg.append('text')
        .attr('x', p.left - 5)
        .attr('y', y + 4)
        .attr('text-anchor', 'end')
        .attr('fill', opts.textColor)
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .text(formatNumber(val));
    }

    // X-axis labels
    if (data.labels && data.labels.length > 0) {
      const step = Math.ceil(data.labels.length / 6);
      data.labels.forEach((label, i) => {
        if (i % step === 0 || i === data.labels!.length - 1) {
          svg.append('text')
            .attr('x', xScale(i))
            .attr('y', height! - p.bottom + 15)
            .attr('text-anchor', 'middle')
            .attr('fill', opts.textColor)
            .attr('font-size', '9px')
            .attr('font-family', 'monospace')
            .text(label);
        }
      });
    }
  }

  // Title
  if (opts.title) {
    svg.append('text')
      .attr('x', width! / 2)
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('fill', opts.textColor)
      .attr('font-size', '12px')
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .text(opts.title);
  }

  return d3n.svgString();
}
