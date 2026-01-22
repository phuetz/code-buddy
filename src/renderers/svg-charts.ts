/**
 * SVG Chart Generator
 *
 * Generates SVG charts and converts them to terminal-displayable images
 * using D3.js for generation, resvg-js for fast SVG→PNG conversion,
 * and terminal-image for display.
 *
 * This module re-exports from the modular charts/ directory for
 * backwards compatibility.
 */

// Re-export all types
export type {
  ChartOptions,
  LineChartData,
  BarChartData,
  GaugeData,
  CandlestickData,
  PieChartData
} from './charts/types.js';

// Re-export default options (for backwards compatibility)
export { DEFAULT_CHART_OPTIONS as DEFAULT_OPTIONS } from './charts/types.js';

// Re-export all chart generators
export { generateLineChartSVG } from './charts/line-chart.js';
export { generateBarChartSVG } from './charts/bar-chart.js';
export { generateTemperatureGaugeSVG, generateGaugeChartSVG } from './charts/gauge-charts.js';
export { generatePieChartSVG, generateCandlestickChartSVG, generateWeatherIconSVG } from './charts/special-charts.js';
export { generateSparklineSVG } from './charts/sparkline.js';

// Re-export render utilities
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
} from './charts/render-utils.js';
