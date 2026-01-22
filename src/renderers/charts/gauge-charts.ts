/**
 * Gauge Chart Generators
 *
 * Generates SVG gauge charts including temperature gauge and general gauge.
 */

import D3Node from 'd3-node';
import type { ChartOptions, GaugeData } from './types.js';
import { DEFAULT_CHART_OPTIONS } from './types.js';

/**
 * Generate a temperature gauge (thermometer style).
 */
export function generateTemperatureGaugeSVG(data: GaugeData, options: ChartOptions = {}): string {
  const opts = { ...DEFAULT_CHART_OPTIONS, width: 120, height: 200, ...options };
  const { width, height } = opts;

  const d3n = new D3Node();
  const svg = d3n.createSVG(width, height);

  const min = data.min ?? -20;
  const max = data.max ?? 45;
  const value = Math.max(min, Math.min(max, data.value));

  // Background
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', opts.backgroundColor);

  const centerX = width! / 2;
  const bulbRadius = 20;
  const tubeWidth = 12;
  const tubeHeight = height! - 80;
  const tubeTop = 30;

  // Thermometer tube (outline)
  svg.append('rect')
    .attr('x', centerX - tubeWidth / 2 - 2)
    .attr('y', tubeTop - 2)
    .attr('width', tubeWidth + 4)
    .attr('height', tubeHeight + 4)
    .attr('fill', '#444466')
    .attr('rx', tubeWidth / 2);

  // Thermometer bulb (outline)
  svg.append('circle')
    .attr('cx', centerX)
    .attr('cy', tubeTop + tubeHeight + bulbRadius - 5)
    .attr('r', bulbRadius + 2)
    .attr('fill', '#444466');

  // Thermometer tube (inner)
  svg.append('rect')
    .attr('x', centerX - tubeWidth / 2)
    .attr('y', tubeTop)
    .attr('width', tubeWidth)
    .attr('height', tubeHeight)
    .attr('fill', '#222244')
    .attr('rx', tubeWidth / 2);

  // Calculate fill height
  const fillPercent = (value - min) / (max - min);
  const fillHeight = tubeHeight * fillPercent;

  // Temperature gradient color
  const getColor = (percent: number): string => {
    if (percent < 0.3) return data.colors?.cold || '#4488ff';
    if (percent < 0.6) return data.colors?.warm || '#ffaa00';
    return data.colors?.hot || '#ff4444';
  };

  const fillColor = getColor(fillPercent);

  // Mercury fill
  svg.append('rect')
    .attr('x', centerX - tubeWidth / 2 + 1)
    .attr('y', tubeTop + tubeHeight - fillHeight)
    .attr('width', tubeWidth - 2)
    .attr('height', fillHeight)
    .attr('fill', fillColor)
    .attr('rx', (tubeWidth - 2) / 2);

  // Bulb fill
  svg.append('circle')
    .attr('cx', centerX)
    .attr('cy', tubeTop + tubeHeight + bulbRadius - 5)
    .attr('r', bulbRadius)
    .attr('fill', fillColor);

  // Temperature marks
  const marks = 5;
  for (let i = 0; i <= marks; i++) {
    const y = tubeTop + tubeHeight - (tubeHeight / marks) * i;
    const tempVal = min + ((max - min) / marks) * i;

    svg.append('line')
      .attr('x1', centerX + tubeWidth / 2 + 3)
      .attr('x2', centerX + tubeWidth / 2 + 8)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', opts.textColor)
      .attr('stroke-width', 1);

    svg.append('text')
      .attr('x', centerX + tubeWidth / 2 + 12)
      .attr('y', y + 3)
      .attr('fill', opts.textColor)
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text(`${Math.round(tempVal)}°`);
  }

  // Current value
  svg.append('text')
    .attr('x', centerX)
    .attr('y', height! - 10)
    .attr('text-anchor', 'middle')
    .attr('fill', fillColor)
    .attr('font-size', '16px')
    .attr('font-family', 'monospace')
    .attr('font-weight', 'bold')
    .text(`${Math.round(value)}°C`);

  // Label
  if (data.label) {
    svg.append('text')
      .attr('x', centerX)
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('fill', opts.textColor)
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .text(data.label);
  }

  return d3n.svgString();
}

/**
 * Generate a general gauge chart (arc style).
 */
export function generateGaugeChartSVG(data: GaugeData, options: ChartOptions = {}): string {
  const opts = { ...DEFAULT_CHART_OPTIONS, width: 200, height: 150, ...options };
  const { width, height } = opts;

  const d3n = new D3Node();
  const svg = d3n.createSVG(width, height);

  const min = data.min ?? 0;
  const max = data.max ?? 100;
  const value = Math.max(min, Math.min(max, data.value));

  // Background
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', opts.backgroundColor);

  const d3 = d3n.d3;
  const centerX = width! / 2;
  const centerY = height! - 30;
  const radius = Math.min(width!, height!) - 40;

  // Arc generator for gauge background
  const arcBg = d3.arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(radius * 0.7)
    .outerRadius(radius)
    .startAngle(-Math.PI / 2)
    .endAngle(Math.PI / 2);

  // Background arc (gray)
  svg.append('path')
    .attr('transform', `translate(${centerX}, ${centerY})`)
    .attr('d', arcBg({ startAngle: -Math.PI / 2, endAngle: Math.PI / 2 }))
    .attr('fill', '#333355');

  // Colored segments
  const segments = 5;
  const segmentColors = ['#ff4444', '#ff8844', '#ffaa00', '#88ff44', '#00ff88'];
  for (let i = 0; i < segments; i++) {
    const startAngle = -Math.PI / 2 + (Math.PI * i / segments);
    const endAngle = -Math.PI / 2 + (Math.PI * (i + 1) / segments);

    const arcSegment = d3.arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(radius * 0.7)
      .outerRadius(radius)
      .startAngle(startAngle)
      .endAngle(endAngle);

    svg.append('path')
      .attr('transform', `translate(${centerX}, ${centerY})`)
      .attr('d', arcSegment({ startAngle, endAngle }))
      .attr('fill', segmentColors[i])
      .attr('opacity', 0.8);
  }

  // Needle
  const percent = (value - min) / (max - min);
  const needleAngle = -Math.PI / 2 + Math.PI * percent;

  const needleLength = radius * 0.85;
  const needleX = centerX + needleLength * Math.cos(needleAngle);
  const needleY = centerY + needleLength * Math.sin(needleAngle);

  svg.append('line')
    .attr('x1', centerX)
    .attr('y1', centerY)
    .attr('x2', needleX)
    .attr('y2', needleY)
    .attr('stroke', '#ffffff')
    .attr('stroke-width', 3)
    .attr('stroke-linecap', 'round');

  // Center circle
  svg.append('circle')
    .attr('cx', centerX)
    .attr('cy', centerY)
    .attr('r', 6)
    .attr('fill', '#ffffff');

  // Value text
  svg.append('text')
    .attr('x', centerX)
    .attr('y', centerY - 20)
    .attr('text-anchor', 'middle')
    .attr('fill', opts.textColor)
    .attr('font-size', '24px')
    .attr('font-family', 'monospace')
    .attr('font-weight', 'bold')
    .text(Math.round(value));

  // Min/Max labels
  svg.append('text')
    .attr('x', centerX - radius * 0.7)
    .attr('y', centerY + 5)
    .attr('text-anchor', 'middle')
    .attr('fill', opts.textColor)
    .attr('font-size', '10px')
    .attr('font-family', 'monospace')
    .text(min);

  svg.append('text')
    .attr('x', centerX + radius * 0.7)
    .attr('y', centerY + 5)
    .attr('text-anchor', 'middle')
    .attr('fill', opts.textColor)
    .attr('font-size', '10px')
    .attr('font-family', 'monospace')
    .text(max);

  // Label
  if (data.label) {
    svg.append('text')
      .attr('x', centerX)
      .attr('y', height! - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', opts.textColor)
      .attr('font-size', '12px')
      .attr('font-family', 'monospace')
      .text(data.label);
  }

  // Title
  if (opts.title) {
    svg.append('text')
      .attr('x', centerX)
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
