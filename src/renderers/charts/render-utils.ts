/**
 * Render Utilities
 *
 * Utilities for converting SVG charts to terminal-displayable images.
 */

import { Resvg } from '@resvg/resvg-js';
import terminalImage from 'terminal-image';
import type { ChartOptions, DisplayOptions, LineChartData, BarChartData, GaugeData, PieChartData, CandlestickData } from './types.js';
import { generateLineChartSVG } from './line-chart.js';
import { generateBarChartSVG } from './bar-chart.js';
import { generateTemperatureGaugeSVG, generateGaugeChartSVG } from './gauge-charts.js';
import { generatePieChartSVG, generateCandlestickChartSVG, generateWeatherIconSVG } from './special-charts.js';
import { generateSparklineSVG } from './sparkline.js';

/**
 * Convert SVG string to terminal-displayable image.
 */
export async function svgToTerminalImage(
  svgString: string,
  options: DisplayOptions = {}
): Promise<string> {
  try {
    // Convert SVG to PNG using resvg-js (faster and more accurate than sharp for SVG)
    const resvg = new Resvg(svgString, {
      fitTo: {
        mode: 'original',
      },
      font: {
        loadSystemFonts: false, // Faster rendering
      },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    // Convert to terminal image
    return await terminalImage.buffer(pngBuffer, {
      width: options.width || '50%',
      height: options.height,
      preserveAspectRatio: true,
    });
  } catch {
    // Fallback: return ASCII representation
    return '[Chart rendering failed - terminal may not support graphics]';
  }
}

// ============================================================================
// Convenience Render Functions
// ============================================================================

export async function renderLineChart(
  data: LineChartData,
  chartOptions?: ChartOptions,
  displayOptions?: DisplayOptions
): Promise<string> {
  const svg = generateLineChartSVG(data, chartOptions);
  return svgToTerminalImage(svg, displayOptions);
}

export async function renderBarChart(
  data: BarChartData,
  chartOptions?: ChartOptions,
  displayOptions?: DisplayOptions
): Promise<string> {
  const svg = generateBarChartSVG(data, chartOptions);
  return svgToTerminalImage(svg, displayOptions);
}

export async function renderTemperatureGauge(
  data: GaugeData,
  chartOptions?: ChartOptions,
  displayOptions?: DisplayOptions
): Promise<string> {
  const svg = generateTemperatureGaugeSVG(data, chartOptions);
  return svgToTerminalImage(svg, displayOptions);
}

export async function renderWeatherIcon(
  condition: string,
  chartOptions?: ChartOptions,
  displayOptions?: DisplayOptions
): Promise<string> {
  const svg = generateWeatherIconSVG(condition, chartOptions);
  return svgToTerminalImage(svg, displayOptions);
}

export async function renderSparkline(
  values: number[],
  chartOptions?: ChartOptions,
  displayOptions?: DisplayOptions
): Promise<string> {
  const svg = generateSparklineSVG(values, chartOptions);
  return svgToTerminalImage(svg, displayOptions);
}

export async function renderCandlestickChart(
  data: CandlestickData,
  chartOptions?: ChartOptions,
  displayOptions?: DisplayOptions
): Promise<string> {
  const svg = generateCandlestickChartSVG(data, chartOptions);
  return svgToTerminalImage(svg, displayOptions);
}

export async function renderPieChart(
  data: PieChartData,
  chartOptions?: ChartOptions,
  displayOptions?: DisplayOptions
): Promise<string> {
  const svg = generatePieChartSVG(data, chartOptions);
  return svgToTerminalImage(svg, displayOptions);
}

export async function renderGaugeChart(
  data: GaugeData,
  chartOptions?: ChartOptions,
  displayOptions?: DisplayOptions
): Promise<string> {
  const svg = generateGaugeChartSVG(data, chartOptions);
  return svgToTerminalImage(svg, displayOptions);
}
