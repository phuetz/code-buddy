/**
 * SVG Charts Module
 *
 * Exports chart generators, types, and rendering utilities.
 */

// Types
export type {
  ChartOptions,
  LineChartData,
  BarChartData,
  GaugeData,
  CandlestickData,
  PieChartData,
  DisplayOptions
} from './types.js';

export { DEFAULT_CHART_OPTIONS, formatNumber } from './types.js';

// Chart generators
export { generateLineChartSVG } from './line-chart.js';
export { generateBarChartSVG } from './bar-chart.js';
export { generateTemperatureGaugeSVG, generateGaugeChartSVG } from './gauge-charts.js';
export { generatePieChartSVG, generateCandlestickChartSVG, generateWeatherIconSVG } from './special-charts.js';
export { generateSparklineSVG } from './sparkline.js';

// Render utilities
export {
  svgToTerminalImage,
  renderLineChart,
  renderBarChart,
  renderTemperatureGauge,
  renderWeatherIcon,
  renderSparkline,
  renderCandlestickChart,
  renderPieChart,
  renderGaugeChart
} from './render-utils.js';
