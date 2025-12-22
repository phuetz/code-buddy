/**
 * GPU VRAM Monitor
 *
 * Monitors GPU memory usage for local LLM inference.
 * Supports AMD (ROCm) and NVIDIA (nvidia-smi) GPUs.
 *
 * Features:
 * - Real-time VRAM monitoring
 * - Dynamic offloading recommendations
 * - Warning thresholds
 * - Multi-GPU support
 */

import { EventEmitter } from "events";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);

/**
 * GPU vendor types
 */
export type GPUVendor = "nvidia" | "amd" | "intel" | "apple" | "unknown";

/**
 * GPU information structure
 */
export interface GPUInfo {
  id: number;
  name: string;
  vendor: GPUVendor;
  vramTotal: number; // MB
  vramUsed: number; // MB
  vramFree: number; // MB
  utilization: number; // percentage
  temperature?: number; // Celsius
  powerDraw?: number; // Watts
}

/**
 * VRAM usage statistics
 */
export interface VRAMStats {
  totalVRAM: number;
  usedVRAM: number;
  freeVRAM: number;
  usagePercent: number;
  gpuCount: number;
  gpus: GPUInfo[];
  timestamp: Date;
}

/**
 * Offloading recommendation
 */
export interface OffloadRecommendation {
  shouldOffload: boolean;
  suggestedGpuLayers: number;
  maxGpuLayers: number;
  reason: string;
  estimatedVRAMUsage: number;
  safeVRAMLimit: number;
}

/**
 * Monitor configuration
 */
export interface GPUMonitorConfig {
  /** Polling interval in milliseconds */
  pollInterval: number;
  /** Warning threshold (percentage) */
  warningThreshold: number;
  /** Critical threshold (percentage) */
  criticalThreshold: number;
  /** Enable auto-polling */
  autoPoll: boolean;
  /** Safe VRAM buffer (MB) to keep free */
  safeBuffer: number;
}

/**
 * Default configuration
 */
export const DEFAULT_GPU_MONITOR_CONFIG: GPUMonitorConfig = {
  pollInterval: 5000, // 5 seconds
  warningThreshold: 80, // 80%
  criticalThreshold: 95, // 95%
  autoPoll: false,
  safeBuffer: 512, // Keep 512MB free
};

/**
 * GPU Memory Monitor
 *
 * Monitors GPU VRAM usage and provides recommendations for
 * model layer offloading to prevent OOM errors.
 */
export class GPUMonitor extends EventEmitter {
  private config: GPUMonitorConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastStats: VRAMStats | null = null;
  private detectedVendor: GPUVendor = "unknown";

  constructor(config: Partial<GPUMonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_GPU_MONITOR_CONFIG, ...config };
  }

  /**
   * Initialize monitor and detect GPU vendor
   */
  async initialize(): Promise<GPUVendor> {
    this.detectedVendor = await this.detectGPUVendor();
    logger.debug(`GPU Monitor initialized: ${this.detectedVendor}`);

    if (this.config.autoPoll) {
      this.startPolling();
    }

    return this.detectedVendor;
  }

  /**
   * Detect GPU vendor
   */
  private async detectGPUVendor(): Promise<GPUVendor> {
    // Check NVIDIA first (most common for ML)
    try {
      await execAsync("nvidia-smi --version");
      return "nvidia";
    } catch {
      // Not NVIDIA
    }

    // Check AMD ROCm
    try {
      await execAsync("rocm-smi --version");
      return "amd";
    } catch {
      // Not AMD ROCm
    }

    // Check AMD via amdgpu (Linux)
    try {
      const { stdout } = await execAsync("ls /sys/class/drm/card*/device/vendor 2>/dev/null | head -1");
      if (stdout.trim()) {
        const vendor = await execAsync(`cat ${stdout.trim()}`);
        if (vendor.stdout.includes("0x1002")) {
          return "amd";
        }
      }
    } catch {
      // Not AMD
    }

    // Check Intel
    try {
      const { stdout } = await execAsync("ls /sys/class/drm/card*/device/vendor 2>/dev/null | head -1");
      if (stdout.trim()) {
        const vendor = await execAsync(`cat ${stdout.trim()}`);
        if (vendor.stdout.includes("0x8086")) {
          return "intel";
        }
      }
    } catch {
      // Not Intel
    }

    // Check Apple Silicon (macOS)
    try {
      const { stdout } = await execAsync("sysctl -n machdep.cpu.brand_string 2>/dev/null");
      if (stdout.toLowerCase().includes("apple")) {
        return "apple";
      }
    } catch {
      // Not Apple
    }

    return "unknown";
  }

  /**
   * Get current VRAM statistics
   */
  async getStats(): Promise<VRAMStats> {
    const gpus = await this.queryGPUs();

    const stats: VRAMStats = {
      totalVRAM: gpus.reduce((sum, g) => sum + g.vramTotal, 0),
      usedVRAM: gpus.reduce((sum, g) => sum + g.vramUsed, 0),
      freeVRAM: gpus.reduce((sum, g) => sum + g.vramFree, 0),
      usagePercent: 0,
      gpuCount: gpus.length,
      gpus,
      timestamp: new Date(),
    };

    stats.usagePercent = stats.totalVRAM > 0
      ? (stats.usedVRAM / stats.totalVRAM) * 100
      : 0;

    this.lastStats = stats;
    this.checkThresholds(stats);

    return stats;
  }

  /**
   * Query GPU information based on vendor
   */
  private async queryGPUs(): Promise<GPUInfo[]> {
    switch (this.detectedVendor) {
      case "nvidia":
        return this.queryNVIDIA();
      case "amd":
        return this.queryAMD();
      case "apple":
        return this.queryApple();
      case "intel":
        return this.queryIntel();
      default:
        return this.queryGeneric();
    }
  }

  /**
   * Query NVIDIA GPUs via nvidia-smi
   */
  private async queryNVIDIA(): Promise<GPUInfo[]> {
    try {
      const { stdout } = await execAsync(
        "nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits"
      );

      return stdout.trim().split("\n").map((line) => {
        const [id, name, total, used, free, util, temp, power] = line.split(",").map((s) => s.trim());
        return {
          id: parseInt(id),
          name,
          vendor: "nvidia" as GPUVendor,
          vramTotal: parseInt(total),
          vramUsed: parseInt(used),
          vramFree: parseInt(free),
          utilization: parseInt(util),
          temperature: parseInt(temp),
          powerDraw: parseFloat(power),
        };
      });
    } catch (error) {
      logger.warn("Failed to query NVIDIA GPU", { error });
      return [];
    }
  }

  /**
   * Query AMD GPUs via rocm-smi or sysfs
   */
  private async queryAMD(): Promise<GPUInfo[]> {
    // Try rocm-smi first
    try {
      const { stdout } = await execAsync(
        "rocm-smi --showmeminfo vram --json 2>/dev/null"
      );
      const data = JSON.parse(stdout);
      const gpus: GPUInfo[] = [];

      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("card")) {
          const cardData = value as Record<string, string>;
          const total = parseInt(cardData["VRAM Total Memory (B)"] || "0") / (1024 * 1024);
          const used = parseInt(cardData["VRAM Total Used Memory (B)"] || "0") / (1024 * 1024);

          gpus.push({
            id: parseInt(key.replace("card", "")),
            name: `AMD GPU ${key}`,
            vendor: "amd",
            vramTotal: Math.round(total),
            vramUsed: Math.round(used),
            vramFree: Math.round(total - used),
            utilization: 0,
          });
        }
      }

      if (gpus.length > 0) return gpus;
    } catch {
      // rocm-smi failed, try sysfs
    }

    // Fallback to sysfs for AMD GPUs
    try {
      const { stdout: cards } = await execAsync(
        "ls -d /sys/class/drm/card[0-9]*/device/mem_info_vram_total 2>/dev/null || true"
      );

      const gpus: GPUInfo[] = [];
      const cardPaths = cards.trim().split("\n").filter(Boolean);

      for (let i = 0; i < cardPaths.length; i++) {
        const basePath = cardPaths[i].replace("/mem_info_vram_total", "");

        try {
          const { stdout: totalStr } = await execAsync(`cat ${basePath}/mem_info_vram_total`);
          const { stdout: usedStr } = await execAsync(`cat ${basePath}/mem_info_vram_used`);

          const total = parseInt(totalStr.trim()) / (1024 * 1024);
          const used = parseInt(usedStr.trim()) / (1024 * 1024);

          gpus.push({
            id: i,
            name: `AMD GPU ${i}`,
            vendor: "amd",
            vramTotal: Math.round(total),
            vramUsed: Math.round(used),
            vramFree: Math.round(total - used),
            utilization: 0,
          });
        } catch {
          // Skip this card
        }
      }

      return gpus;
    } catch {
      return [];
    }
  }

  /**
   * Query Apple Silicon unified memory
   */
  private async queryApple(): Promise<GPUInfo[]> {
    try {
      // Apple Silicon uses unified memory
      const { stdout: memInfo } = await execAsync(
        "sysctl -n hw.memsize"
      );
      const totalRAM = parseInt(memInfo.trim()) / (1024 * 1024);

      // GPU can use up to ~75% of unified memory
      const gpuAvailable = totalRAM * 0.75;

      // Get current memory pressure
      const { stdout: pressure } = await execAsync(
        "memory_pressure 2>/dev/null | grep 'System-wide memory' || echo '0%'"
      );
      const usageMatch = pressure.match(/(\d+)%/);
      const usage = usageMatch ? parseInt(usageMatch[1]) : 0;

      return [{
        id: 0,
        name: "Apple Silicon GPU",
        vendor: "apple",
        vramTotal: Math.round(gpuAvailable),
        vramUsed: Math.round(gpuAvailable * (usage / 100)),
        vramFree: Math.round(gpuAvailable * (1 - usage / 100)),
        utilization: usage,
      }];
    } catch {
      return [];
    }
  }

  /**
   * Query Intel GPUs
   */
  private async queryIntel(): Promise<GPUInfo[]> {
    try {
      // Intel integrated graphics typically share system RAM
      const { stdout: memInfo } = await execAsync("cat /proc/meminfo | grep MemTotal");
      const match = memInfo.match(/(\d+)/);
      const totalRAM = match ? parseInt(match[1]) / 1024 : 8192; // KB to MB

      // Intel iGPU typically can use 1-2GB
      const gpuAvailable = Math.min(2048, totalRAM * 0.25);

      return [{
        id: 0,
        name: "Intel Integrated GPU",
        vendor: "intel",
        vramTotal: Math.round(gpuAvailable),
        vramUsed: 0, // Hard to determine
        vramFree: Math.round(gpuAvailable),
        utilization: 0,
      }];
    } catch {
      return [];
    }
  }

  /**
   * Generic GPU query (fallback)
   */
  private async queryGeneric(): Promise<GPUInfo[]> {
    // Return a conservative estimate
    return [{
      id: 0,
      name: "Unknown GPU",
      vendor: "unknown",
      vramTotal: 4096, // Assume 4GB
      vramUsed: 0,
      vramFree: 4096,
      utilization: 0,
    }];
  }

  /**
   * Check usage thresholds and emit warnings
   */
  private checkThresholds(stats: VRAMStats): void {
    if (stats.usagePercent >= this.config.criticalThreshold) {
      this.emit("vram:critical", stats);
      logger.warn(`VRAM critical: ${stats.usagePercent.toFixed(1)}%`);
    } else if (stats.usagePercent >= this.config.warningThreshold) {
      this.emit("vram:warning", stats);
      logger.debug(`VRAM warning: ${stats.usagePercent.toFixed(1)}%`);
    }
  }

  /**
   * Calculate offloading recommendation for a model
   *
   * @param modelSizeMB - Model size in MB (e.g., 7000 for 7B Q4)
   * @param totalLayers - Total number of layers in the model
   * @param contextSize - Context size in tokens
   */
  calculateOffloadRecommendation(
    modelSizeMB: number,
    totalLayers: number = 32,
    contextSize: number = 4096
  ): OffloadRecommendation {
    const stats = this.lastStats;
    if (!stats || stats.gpuCount === 0) {
      return {
        shouldOffload: true,
        suggestedGpuLayers: 0,
        maxGpuLayers: totalLayers,
        reason: "No GPU detected - full CPU offload recommended",
        estimatedVRAMUsage: 0,
        safeVRAMLimit: 0,
      };
    }

    // Calculate safe VRAM limit (total - buffer)
    const safeVRAMLimit = stats.totalVRAM - this.config.safeBuffer;
    const availableVRAM = stats.freeVRAM - this.config.safeBuffer;

    // Estimate VRAM per layer (rough approximation)
    // Model weights + KV cache per layer
    const kvCachePerLayer = (contextSize * 2 * 2 * 128) / (1024 * 1024); // ~2MB per 4K context
    const weightsPerLayer = modelSizeMB / totalLayers;
    const vramPerLayer = weightsPerLayer + kvCachePerLayer;

    // Calculate how many layers can fit
    const maxLayersInVRAM = Math.floor(availableVRAM / vramPerLayer);
    const suggestedGpuLayers = Math.min(maxLayersInVRAM, totalLayers);

    // Estimate total VRAM usage
    const estimatedVRAMUsage = suggestedGpuLayers * vramPerLayer;

    const shouldOffload = suggestedGpuLayers < totalLayers;

    let reason: string;
    if (suggestedGpuLayers === 0) {
      reason = `Insufficient VRAM (${stats.freeVRAM}MB free) - full CPU offload`;
    } else if (suggestedGpuLayers === totalLayers) {
      reason = `Full GPU acceleration - ${estimatedVRAMUsage.toFixed(0)}MB estimated`;
    } else {
      reason = `Partial offload: ${suggestedGpuLayers}/${totalLayers} layers on GPU`;
    }

    return {
      shouldOffload,
      suggestedGpuLayers,
      maxGpuLayers: totalLayers,
      reason,
      estimatedVRAMUsage,
      safeVRAMLimit,
    };
  }

  /**
   * Get recommended GPU layers for common model sizes
   */
  async getRecommendedLayers(modelSize: "3b" | "7b" | "13b" | "30b" | "70b"): Promise<number> {
    // Approximate model sizes in MB (Q4 quantization)
    const modelSizes: Record<string, number> = {
      "3b": 2000,
      "7b": 4000,
      "13b": 7500,
      "30b": 17000,
      "70b": 40000,
    };

    const modelMB = modelSizes[modelSize] || 4000;
    const layerCount = modelSize === "70b" ? 80 : modelSize === "30b" ? 60 : 32;

    const recommendation = this.calculateOffloadRecommendation(modelMB, layerCount);
    return recommendation.suggestedGpuLayers;
  }

  /**
   * Format stats for display
   */
  formatStats(): string {
    if (!this.lastStats) {
      return "GPU Monitor: No data available. Run getStats() first.";
    }

    const stats = this.lastStats;
    const lines = [
      "🎮 GPU Memory Status",
      "",
    ];

    for (const gpu of stats.gpus) {
      const usagePercent = (gpu.vramUsed / gpu.vramTotal) * 100;
      const bar = this.createProgressBar(usagePercent);

      lines.push(`  GPU ${gpu.id}: ${gpu.name}`);
      lines.push(`  ${bar} ${usagePercent.toFixed(1)}%`);
      lines.push(`  Used: ${gpu.vramUsed}MB / ${gpu.vramTotal}MB (Free: ${gpu.vramFree}MB)`);

      if (gpu.temperature) {
        lines.push(`  Temp: ${gpu.temperature}°C | Power: ${gpu.powerDraw?.toFixed(1)}W`);
      }
      lines.push("");
    }

    lines.push(`  Total: ${stats.usedVRAM}MB / ${stats.totalVRAM}MB`);

    return lines.join("\n");
  }

  /**
   * Create ASCII progress bar
   */
  private createProgressBar(percent: number, width: number = 20): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;

    let color = "🟢";
    if (percent >= this.config.criticalThreshold) {
      color = "🔴";
    } else if (percent >= this.config.warningThreshold) {
      color = "🟡";
    }

    return `${color} [${"█".repeat(filled)}${"░".repeat(empty)}]`;
  }

  /**
   * Start automatic polling
   */
  startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(async () => {
      await this.getStats();
      this.emit("vram:update", this.lastStats);
    }, this.config.pollInterval);

    logger.debug(`GPU polling started (${this.config.pollInterval}ms interval)`);
  }

  /**
   * Stop automatic polling
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.debug("GPU polling stopped");
    }
  }

  /**
   * Get detected vendor
   */
  getVendor(): GPUVendor {
    return this.detectedVendor;
  }

  /**
   * Get last cached stats
   */
  getLastStats(): VRAMStats | null {
    return this.lastStats;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<GPUMonitorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): GPUMonitorConfig {
    return { ...this.config };
  }

  /**
   * Dispose monitor
   */
  dispose(): void {
    this.stopPolling();
    this.removeAllListeners();
  }
}

// Singleton instance
let gpuMonitorInstance: GPUMonitor | null = null;

/**
 * Get or create GPU monitor instance
 */
export function getGPUMonitor(config?: Partial<GPUMonitorConfig>): GPUMonitor {
  if (!gpuMonitorInstance) {
    gpuMonitorInstance = new GPUMonitor(config);
  }
  return gpuMonitorInstance;
}

/**
 * Initialize GPU monitor (async)
 */
export async function initializeGPUMonitor(
  config?: Partial<GPUMonitorConfig>
): Promise<GPUMonitor> {
  const monitor = getGPUMonitor(config);
  await monitor.initialize();
  return monitor;
}

/**
 * Reset GPU monitor singleton
 */
export function resetGPUMonitor(): void {
  if (gpuMonitorInstance) {
    gpuMonitorInstance.dispose();
    gpuMonitorInstance = null;
  }
}

export default {
  GPUMonitor,
  getGPUMonitor,
  initializeGPUMonitor,
  resetGPUMonitor,
  DEFAULT_GPU_MONITOR_CONFIG,
};
