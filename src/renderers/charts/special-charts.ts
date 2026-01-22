/**
 * Special Chart Generators
 *
 * Generates SVG pie charts, candlestick charts, and weather icons.
 */

import D3Node from 'd3-node';
import type { ChartOptions, PieChartData, CandlestickData } from './types.js';
import { DEFAULT_CHART_OPTIONS, formatNumber } from './types.js';

/** Slice data structure for pie chart */
interface PieSlice {
  label: string;
  value: number;
  color?: string;
}

/** D3 pie arc datum structure */
interface PieArcDatum<T> {
  data: T;
  value: number;
  index: number;
  startAngle: number;
  endAngle: number;
  padAngle: number;
}

/**
 * Generate a pie chart.
 */
export function generatePieChartSVG(data: PieChartData, options: ChartOptions = {}): string {
  const opts = { ...DEFAULT_CHART_OPTIONS, width: 300, height: 300, ...options };
  const { width, height } = opts;

  const d3n = new D3Node();
  const d3 = d3n.d3;

  const svg = d3n.createSVG(width, height);

  // Background
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', opts.backgroundColor);

  const radius = Math.min(width!, height!) / 2 - 40;
  const centerX = width! / 2;
  const centerY = height! / 2;

  const total = data.slices.reduce((sum, s) => sum + s.value, 0);

  const pie = d3.pie<PieSlice>()
    .value((d: PieSlice) => d.value)
    .sort(null);

  const arc = d3.arc<PieArcDatum<PieSlice>>()
    .innerRadius(0)
    .outerRadius(radius);

  const defaultColors = ['#00ff88', '#ff4444', '#4488ff', '#ffaa00', '#ff88ff', '#88ffff', '#88ff88'];

  const pieData = pie(data.slices);
  const g = svg.append('g')
    .attr('transform', `translate(${centerX}, ${centerY})`);

  pieData.forEach((d: PieArcDatum<PieSlice>, i: number) => {
    g.append('path')
      .attr('d', arc(d))
      .attr('fill', d.data.color || defaultColors[i % defaultColors.length])
      .attr('stroke', opts.backgroundColor)
      .attr('stroke-width', 2);

    const centroid = arc.centroid(d);
    const percent = (d.data.value / total * 100).toFixed(1);
    g.append('text')
      .attr('transform', `translate(${centroid[0]}, ${centroid[1]})`)
      .attr('text-anchor', 'middle')
      .attr('fill', opts.textColor)
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .text(percent + '%');
  });

  // Legend
  const legend = svg.append('g')
    .attr('transform', `translate(${width! - 100}, 20)`);

  data.slices.forEach((slice, i) => {
    const y = i * 20;
    const color = slice.color || defaultColors[i % defaultColors.length];

    legend.append('rect')
      .attr('x', 0)
      .attr('y', y)
      .attr('width', 12)
      .attr('height', 12)
      .attr('fill', color);

    legend.append('text')
      .attr('x', 18)
      .attr('y', y + 10)
      .attr('fill', opts.textColor)
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text(slice.label);
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

/**
 * Generate a candlestick chart.
 */
export function generateCandlestickChartSVG(data: CandlestickData, options: ChartOptions = {}): string {
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

  const chartWidth = width! - p.left - p.right;
  const chartHeight = height! - p.top - p.bottom;

  const candles = data.candles;
  if (candles.length === 0) return d3n.svgString();

  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minVal = Math.min(...allPrices);
  const maxVal = Math.max(...allPrices);
  const range = maxVal - minVal || 1;

  // Scales
  const xScale = d3.scaleLinear()
    .domain([0, candles.length - 1])
    .range([p.left, width! - p.right]);

  const yScale = d3.scaleLinear()
    .domain([minVal - range * 0.1, maxVal + range * 0.1])
    .range([height! - p.bottom, p.top]);

  const candleWidth = (chartWidth / candles.length) * 0.6;

  // Grid
  if (opts.showGrid) {
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

  // Draw candles
  candles.forEach((candle, i) => {
    const x = xScale(i);
    const isUp = candle.close >= candle.open;
    const color = isUp ? '#00ff88' : '#ff4444';

    const highY = yScale(candle.high);
    const lowY = yScale(candle.low);
    const openY = yScale(candle.open);
    const closeY = yScale(candle.close);

    // Wick (high-low line)
    svg.append('line')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', highY)
      .attr('y2', lowY)
      .attr('stroke', color)
      .attr('stroke-width', 1);

    // Body (open-close rectangle)
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.abs(closeY - openY) || 1;

    svg.append('rect')
      .attr('x', x - candleWidth / 2)
      .attr('y', bodyTop)
      .attr('width', candleWidth)
      .attr('height', bodyHeight)
      .attr('fill', color)
      .attr('stroke', color)
      .attr('stroke-width', 1);
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

    // X-axis labels (dates)
    const step = Math.max(1, Math.ceil(candles.length / 6));
    candles.forEach((candle, i) => {
      if (i % step === 0 || i === candles.length - 1) {
        svg.append('text')
          .attr('x', xScale(i))
          .attr('y', height! - p.bottom + 15)
          .attr('text-anchor', 'middle')
          .attr('fill', opts.textColor)
          .attr('font-size', '9px')
          .attr('font-family', 'monospace')
          .text(candle.date.slice(5)); // MM-DD format
      }
    });
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

/**
 * Generate a weather icon.
 */
export function generateWeatherIconSVG(condition: string, options: ChartOptions = {}): string {
  const opts = { ...DEFAULT_CHART_OPTIONS, width: 80, height: 80, ...options };
  const { width, height } = opts;

  const d3n = new D3Node();
  const svg = d3n.createSVG(width, height);

  const centerX = width! / 2;
  const centerY = height! / 2;

  // Background
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', opts.backgroundColor);

  const cond = condition.toLowerCase();

  if (cond.includes('sun') || cond.includes('clear')) {
    // Sun
    svg.append('circle')
      .attr('cx', centerX)
      .attr('cy', centerY)
      .attr('r', 15)
      .attr('fill', '#ffdd00');

    // Sun rays
    for (let i = 0; i < 8; i++) {
      const angle = (i * 45) * Math.PI / 180;
      const x1 = centerX + Math.cos(angle) * 20;
      const y1 = centerY + Math.sin(angle) * 20;
      const x2 = centerX + Math.cos(angle) * 28;
      const y2 = centerY + Math.sin(angle) * 28;

      svg.append('line')
        .attr('x1', x1)
        .attr('y1', y1)
        .attr('x2', x2)
        .attr('y2', y2)
        .attr('stroke', '#ffdd00')
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round');
    }
  } else if (cond.includes('cloud') || cond.includes('overcast')) {
    // Cloud
    svg.append('ellipse')
      .attr('cx', centerX - 8)
      .attr('cy', centerY)
      .attr('rx', 18)
      .attr('ry', 12)
      .attr('fill', '#aabbcc');

    svg.append('ellipse')
      .attr('cx', centerX + 10)
      .attr('cy', centerY + 3)
      .attr('rx', 15)
      .attr('ry', 10)
      .attr('fill', '#99aabb');

    svg.append('ellipse')
      .attr('cx', centerX)
      .attr('cy', centerY - 8)
      .attr('rx', 12)
      .attr('ry', 10)
      .attr('fill', '#bbccdd');
  } else if (cond.includes('rain') || cond.includes('drizzle') || cond.includes('shower')) {
    // Cloud
    svg.append('ellipse')
      .attr('cx', centerX)
      .attr('cy', centerY - 8)
      .attr('rx', 20)
      .attr('ry', 12)
      .attr('fill', '#667788');

    // Rain drops
    for (let i = 0; i < 3; i++) {
      const x = centerX - 12 + i * 12;
      svg.append('line')
        .attr('x1', x)
        .attr('y1', centerY + 8)
        .attr('x2', x - 3)
        .attr('y2', centerY + 20)
        .attr('stroke', '#4488ff')
        .attr('stroke-width', 2)
        .attr('stroke-linecap', 'round');
    }
  } else if (cond.includes('snow') || cond.includes('sleet')) {
    // Cloud
    svg.append('ellipse')
      .attr('cx', centerX)
      .attr('cy', centerY - 8)
      .attr('rx', 20)
      .attr('ry', 12)
      .attr('fill', '#aabbcc');

    // Snowflakes
    for (let i = 0; i < 3; i++) {
      const x = centerX - 10 + i * 10;
      svg.append('text')
        .attr('x', x)
        .attr('y', centerY + 18)
        .attr('fill', '#ffffff')
        .attr('font-size', '12px')
        .text('*');
    }
  } else if (cond.includes('thunder') || cond.includes('storm')) {
    // Dark cloud
    svg.append('ellipse')
      .attr('cx', centerX)
      .attr('cy', centerY - 5)
      .attr('rx', 22)
      .attr('ry', 14)
      .attr('fill', '#445566');

    // Lightning bolt
    svg.append('polygon')
      .attr('points', `${centerX},${centerY + 5} ${centerX - 5},${centerY + 15} ${centerX + 2},${centerY + 15} ${centerX - 3},${centerY + 28} ${centerX + 8},${centerY + 12} ${centerX + 2},${centerY + 12}`)
      .attr('fill', '#ffdd00');
  } else if (cond.includes('fog') || cond.includes('mist')) {
    // Fog lines
    for (let i = 0; i < 4; i++) {
      svg.append('line')
        .attr('x1', centerX - 20)
        .attr('x2', centerX + 20)
        .attr('y1', centerY - 12 + i * 8)
        .attr('y2', centerY - 12 + i * 8)
        .attr('stroke', '#aabbcc')
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0.7 - i * 0.1);
    }
  } else {
    // Default: partly cloudy
    svg.append('circle')
      .attr('cx', centerX - 5)
      .attr('cy', centerY - 5)
      .attr('r', 12)
      .attr('fill', '#ffdd00');

    svg.append('ellipse')
      .attr('cx', centerX + 8)
      .attr('cy', centerY + 5)
      .attr('rx', 16)
      .attr('ry', 10)
      .attr('fill', '#aabbcc');
  }

  return d3n.svgString();
}
