/**
 * Bar Chart Generator
 *
 * Generates SVG bar charts with customizable colors.
 */

import D3Node from 'd3-node';
import type { ChartOptions, BarChartData } from './types.js';
import { DEFAULT_CHART_OPTIONS, formatNumber } from './types.js';

export function generateBarChartSVG(data: BarChartData, options: ChartOptions = {}): string {
  const opts = { ...DEFAULT_CHART_OPTIONS, ...options };
  const { width, height, padding } = opts;
  const p = padding!;

  const d3n = new D3Node();

  const svg = d3n.createSVG(width, height);

  // Background
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', opts.backgroundColor);

  const chartWidth = width! - p.left - p.right;
  const chartHeight = height! - p.top - p.bottom;

  const values = data.values.map(v => v.value);
  const maxVal = Math.max(...values, 0);

  const barWidth = chartWidth / data.values.length * 0.8;
  const barGap = chartWidth / data.values.length * 0.2;

  // Bars
  data.values.forEach((item, i) => {
    const barHeight = (item.value / maxVal) * chartHeight;
    const x = p.left + i * (barWidth + barGap) + barGap / 2;
    const y = height! - p.bottom - barHeight;

    const color = item.color || (item.value >= 0 ? '#00ff88' : '#ff4444');

    svg.append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', barWidth)
      .attr('height', barHeight)
      .attr('fill', color)
      .attr('rx', 2);

    // Value label
    svg.append('text')
      .attr('x', x + barWidth / 2)
      .attr('y', y - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', opts.textColor)
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .text(formatNumber(item.value));

    // Label
    svg.append('text')
      .attr('x', x + barWidth / 2)
      .attr('y', height! - p.bottom + 15)
      .attr('text-anchor', 'middle')
      .attr('fill', opts.textColor)
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text(item.label);
  });

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
