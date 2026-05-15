/**
 * Platform-specific Commands
 *
 * Maps device capabilities to platform-specific shell commands.
 * Used by device-node.ts to execute actions on different OS types.
 */

// ============================================================================
// Types
// ============================================================================

export interface PlatformCommands {
  /** Take a screenshot */
  screenshot(outputPath: string): string;
  /** Capture from camera */
  cameraSnap(outputPath: string): string;
  /** Record the screen */
  screenRecord(outputPath: string, durationSec: number): string;
  /** Get device location (if available) */
  getLocation?: () => string;
}

// ============================================================================
// macOS Commands
// ============================================================================

export const MacOSCommands: PlatformCommands = {
  screenshot(outputPath: string): string {
    return `screencapture -x ${outputPath}`;
  },
  cameraSnap(outputPath: string): string {
    return `imagesnap -w 1 ${outputPath}`;
  },
  screenRecord(outputPath: string, durationSec: number): string {
    return `screencapture -V ${durationSec} ${outputPath}`;
  },
  getLocation(): string {
    return `CoreLocationCLI`;
  },
};

// ============================================================================
// Linux Commands
// ============================================================================

export const LinuxCommands: PlatformCommands = {
  screenshot(outputPath: string): string {
    return `scrot ${outputPath} 2>/dev/null || gnome-screenshot -f ${outputPath} 2>/dev/null || import -window root ${outputPath}`;
  },
  cameraSnap(outputPath: string): string {
    return `ffmpeg -y -f v4l2 -i /dev/video0 -frames:v 1 ${outputPath} 2>/dev/null`;
  },
  screenRecord(outputPath: string, durationSec: number): string {
    return `ffmpeg -y -f x11grab -t ${durationSec} -i :0.0 ${outputPath} 2>/dev/null`;
  },
};

// ============================================================================
// Android Commands (via ADB shell)
// ============================================================================

export const AndroidCommands: PlatformCommands = {
  screenshot(outputPath: string): string {
    return `screencap -p ${outputPath}`;
  },
  cameraSnap(_outputPath: string): string {
    // Android camera capture is complex; use activity intent
    return `am start -a android.media.action.STILL_IMAGE_CAMERA`;
  },
  screenRecord(outputPath: string, durationSec: number): string {
    return `screenrecord --time-limit ${durationSec} ${outputPath}`;
  },
};

// ============================================================================
// Platform Detection
// ============================================================================

export type DevicePlatform = 'macos' | 'linux' | 'android' | 'unknown';

/**
 * Get platform-specific commands for a device type.
 */
export function getPlatformCommands(platform: DevicePlatform): PlatformCommands | null {
  switch (platform) {
    case 'macos': return MacOSCommands;
    case 'linux': return LinuxCommands;
    case 'android': return AndroidCommands;
    default: return null;
  }
}
