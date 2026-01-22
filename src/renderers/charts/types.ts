/**
 * SVG Chart Types
 *
 * Type definitions for the SVG chart system.
 */

export interface ChartOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  lineColor?: string;
  fillColor?: string;
  gridColor?: string;
  textColor?: string;
  showGrid?: boolean;
  showLabels?: boolean;
  title?: string;
  padding?: { top: number; right: number; bottom: number; left: number };
}

export interface LineChartData {
  values: number[];
  labels?: string[];
}

export interface BarChartData {
  values: { label: string; value: number; color?: string }[];
}

export interface GaugeData {
  value: number;
  min?: number;
  max?: number;
  label?: string;
  colors?: { cold: string; warm: string; hot: string };
}

export interface CandlestickData {
  candles: { date: string; open: number; high: number; low: number; close: number; volume?: number }[];
}

export interface PieChartData {
  slices: { label: string; value: number; color?: string }[];
}

export interface DisplayOptions {
  width?: string | number;
  height?: string | number;
}

// Default options
export const DEFAULT_CHART_OPTIONS: ChartOptions = {
  width: 400,
  height: 200,
  backgroundColor: '#1a1a2e',
  lineColor: '#00ff88',
  fillColor: 'rgba(0, 255, 136, 0.2)',
  gridColor: '#333355',
  textColor: '#aaaaaa',
  showGrid: true,
  showLabels: true,
  padding: { top: 30, right: 20, bottom: 40, left: 50 },
};

/**
 * Format a number for display on charts.
 */
export function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  }
  if (Math.abs(value) >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  if (Math.abs(value) < 1) {
    return value.toFixed(4);
  }
  return value.toFixed(2);
}
