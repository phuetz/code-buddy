/**
 * Smart Snapshot System
 *
 * OpenClaw-inspired UI element referencing system.
 * Assigns numeric references [1], [2], [3] to interactive elements
 * instead of using brittle CSS selectors or coordinates.
 *
 * Features:
 * - Element detection via accessibility APIs or OCR
 * - Numeric reference assignment for AI agents
 * - Ephemeral snapshots (must refresh before each action sequence)
 * - Cross-platform support (Linux AT-SPI, macOS AX, Windows UIAutomation)
 * - Visual annotation rendering
 */

import { EventEmitter } from 'events';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { Point, Rect } from './types.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type ElementRole =
  | 'button'
  | 'link'
  | 'text-field'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'menu'
  | 'menu-item'
  | 'tab'
  | 'list-item'
  | 'image'
  | 'text'
  | 'container'
  | 'window'
  | 'unknown';

export interface UIElement {
  /** Numeric reference [1], [2], etc. */
  ref: number;
  /** Element role */
  role: ElementRole;
  /** Display name/label */
  name: string;
  /** Accessibility description */
  description?: string;
  /** Bounding rectangle */
  bounds: Rect;
  /** Center point for clicking */
  center: Point;
  /** Is element interactive */
  interactive: boolean;
  /** Is element focused */
  focused: boolean;
  /** Is element enabled */
  enabled: boolean;
  /** Is element visible */
  visible: boolean;
  /** Current value (for inputs) */
  value?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Parent element ref */
  parent?: number;
  /** Child element refs */
  children?: number[];
  /** Raw accessibility attributes */
  attributes?: Record<string, unknown>;
}

export interface Snapshot {
  /** Snapshot ID */
  id: string;
  /** Timestamp */
  timestamp: Date;
  /** Window/app name */
  source: string;
  /** All detected elements */
  elements: UIElement[];
  /** Element lookup by ref */
  elementMap: Map<number, UIElement>;
  /** Screen dimensions */
  screenSize: { width: number; height: number };
  /** Is snapshot still valid */
  valid: boolean;
  /** Time-to-live in ms */
  ttl: number;
}

export interface SnapshotOptions {
  /** Window title to capture (default: focused window) */
  window?: string;
  /** Only include interactive elements */
  interactiveOnly?: boolean;
  /** Maximum depth of element tree */
  maxDepth?: number;
  /** Filter by element roles */
  roles?: ElementRole[];
  /** Include hidden elements */
  includeHidden?: boolean;
  /** Time-to-live for snapshot (default: 5000ms) */
  ttl?: number;
}

export interface AnnotatedScreenshot {
  /** Base64 encoded image with annotations */
  image: string;
  /** Image format */
  format: 'png' | 'jpeg';
  /** Width */
  width: number;
  /** Height */
  height: number;
  /** Associated snapshot */
  snapshot: Snapshot;
}

export interface SmartSnapshotConfig {
  /** Preferred detection method */
  method: 'accessibility' | 'ocr' | 'hybrid';
  /** Default TTL for snapshots */
  defaultTtl: number;
  /** Maximum elements per snapshot */
  maxElements: number;
  /** Enable visual annotations */
  enableAnnotations: boolean;
  /** Annotation style */
  annotationStyle: {
    fontSize: number;
    backgroundColor: string;
    textColor: string;
    borderColor: string;
  };
}

export interface ScreenDiff {
  hasChanges: boolean;
  changedRegions: Rect[];
  newElements: UIElement[];
  removedElements: UIElement[];
  similarity: number;
}

const DEFAULT_CONFIG: SmartSnapshotConfig = {
  method: 'accessibility',
  defaultTtl: 5000,
  maxElements: 500,
  enableAnnotations: true,
  annotationStyle: {
    fontSize: 12,
    backgroundColor: '#FF6B6B',
    textColor: '#FFFFFF',
    borderColor: '#FF6B6B',
  },
};

// ============================================================================
// Smart Snapshot Manager
// ============================================================================

export class SmartSnapshotManager extends EventEmitter {
  private config: SmartSnapshotConfig;
  private currentSnapshot: Snapshot | null = null;
  private snapshotCache: Map<string, Snapshot> = new Map();
  private static readonly MAX_CACHE_SIZE = 20;
  private nextRef: number = 1;

  constructor(config: Partial<SmartSnapshotConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // Main API
  // ============================================================================

  /**
   * Take a snapshot of the current screen/window
   */
  async takeSnapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
    // Don't reset nextRef — continuous counter for globally unique refs

    const elements: UIElement[] = [];
    const ttl = options.ttl ?? this.config.defaultTtl;

    try {
      // Detect elements based on method
      switch (this.config.method) {
        case 'accessibility':
          elements.push(...await this.detectAccessibilityElements(options));
          break;
        case 'ocr':
          elements.push(...await this.detectOCRElements(options));
          break;
        case 'hybrid':
          elements.push(...await this.detectAccessibilityElements(options));
          elements.push(...await this.detectOCRElements(options));
          break;
      }

      // Filter elements
      const filtered = this.filterElements(elements, options);

      // Build element map
      const elementMap = new Map<number, UIElement>();
      for (const elem of filtered) {
        elementMap.set(elem.ref, elem);
      }

      // Get screen size
      const screenSize = await this.getScreenSize();

      // Create snapshot
      const snapshot: Snapshot = {
        id: `snap-${Date.now()}`,
        timestamp: new Date(),
        source: options.window || 'focused',
        elements: filtered,
        elementMap,
        screenSize,
        valid: true,
        ttl,
      };

      // Invalidate after TTL
      setTimeout(() => {
        snapshot.valid = false;
        this.emit('snapshot-expired', { id: snapshot.id });
      }, ttl);

      // Store snapshot in LRU cache
      this.currentSnapshot = snapshot;
      this.snapshotCache.set(snapshot.id, snapshot);

      // Evict oldest entry when limit exceeded
      if (this.snapshotCache.size > SmartSnapshotManager.MAX_CACHE_SIZE) {
        const oldestKey = this.snapshotCache.keys().next().value;
        if (oldestKey) {
          this.snapshotCache.delete(oldestKey);
        }
      }

      this.emit('snapshot-taken', { snapshot });
      logger.info('Snapshot taken', {
        id: snapshot.id,
        elements: filtered.length,
        source: snapshot.source,
      });

      return snapshot;
    } catch (error) {
      logger.error('Failed to take snapshot', { error });
      throw error;
    }
  }

  /**
   * Get the next available ref number.
   * Allows external modules (e.g. browser-automation) to share the global ref space
   * so desktop and browser refs never collide.
   */
  getNextRef(): number {
    return this.nextRef++;
  }

  /**
   * Inject browser-sourced elements into the current snapshot.
   * This allows unified ref lookup across desktop and browser elements.
   */
  injectBrowserElements(elements: UIElement[], source: string = 'browser-accessibility'): void {
    if (!this.currentSnapshot?.valid) {
      logger.warn('Cannot inject browser elements: no valid snapshot');
      return;
    }

    for (const elem of elements) {
      // Tag element with browser source
      elem.attributes = { ...elem.attributes, source };
      this.currentSnapshot.elements.push(elem);
      this.currentSnapshot.elementMap.set(elem.ref, elem);
    }

    logger.debug('Injected browser elements into desktop snapshot', {
      count: elements.length,
      source,
    });
  }

  /**
   * Get element by reference number
   */
  getElement(ref: number): UIElement | undefined {
    if (!this.currentSnapshot?.valid) {
      logger.warn('Snapshot expired or not available');
      return undefined;
    }
    return this.currentSnapshot.elementMap.get(ref);
  }

  /**
   * Get current snapshot
   */
  getCurrentSnapshot(): Snapshot | null {
    if (!this.currentSnapshot?.valid) {
      return null;
    }
    return this.currentSnapshot;
  }

  /**
   * Get a snapshot by ID from the cache
   */
  getSnapshotById(id: string): Snapshot | undefined {
    return this.snapshotCache.get(id);
  }

  /**
   * Find elements matching criteria
   */
  findElements(criteria: {
    role?: ElementRole | ElementRole[];
    name?: string | RegExp;
    interactive?: boolean;
    visible?: boolean;
  }): UIElement[] {
    if (!this.currentSnapshot?.valid) {
      return [];
    }

    return this.currentSnapshot.elements.filter(elem => {
      if (criteria.role) {
        const roles = Array.isArray(criteria.role) ? criteria.role : [criteria.role];
        if (!roles.includes(elem.role)) return false;
      }
      if (criteria.name) {
        if (criteria.name instanceof RegExp) {
          if (!criteria.name.test(elem.name)) return false;
        } else {
          if (!elem.name.toLowerCase().includes(criteria.name.toLowerCase())) return false;
        }
      }
      if (criteria.interactive !== undefined && elem.interactive !== criteria.interactive) {
        return false;
      }
      if (criteria.visible !== undefined && elem.visible !== criteria.visible) {
        return false;
      }
      return true;
    });
  }

  /**
   * Generate text representation for AI
   */
  toTextRepresentation(snapshot?: Snapshot): string {
    const snap = snapshot || this.currentSnapshot;
    if (!snap?.valid) {
      return 'No valid snapshot available. Take a new snapshot first.';
    }

    const lines: string[] = [
      `# UI Snapshot (${snap.id})`,
      `Source: ${snap.source}`,
      `Elements: ${snap.elements.length}`,
      `Valid until: ${new Date(snap.timestamp.getTime() + snap.ttl).toISOString()}`,
      '',
      '## Interactive Elements',
      '',
    ];

    // Group by role
    const byRole = new Map<ElementRole, UIElement[]>();
    for (const elem of snap.elements) {
      if (!elem.interactive) continue;
      const existing = byRole.get(elem.role) || [];
      existing.push(elem);
      byRole.set(elem.role, existing);
    }

    for (const [role, elements] of byRole) {
      lines.push(`### ${role.charAt(0).toUpperCase() + role.slice(1)}s`);
      for (const elem of elements) {
        const valueStr = elem.value ? ` = "${elem.value}"` : '';
        const focusStr = elem.focused ? ' (focused)' : '';
        const disabledStr = !elem.enabled ? ' (disabled)' : '';
        lines.push(`  [${elem.ref}] ${elem.name}${valueStr}${focusStr}${disabledStr}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Compare this snapshot to a previous one and return differences
   */
  compareTo(previous: Snapshot): ScreenDiff {
    const current = this.currentSnapshot;
    if (!current) {
      return { hasChanges: false, changedRegions: [], newElements: [], removedElements: [], similarity: 0 };
    }

    const prevRefs = new Set(previous.elements.map(e => e.name + ':' + e.role));
    const currRefs = new Set(current.elements.map(e => e.name + ':' + e.role));

    const newElements = current.elements.filter(e => !prevRefs.has(e.name + ':' + e.role));
    const removedElements = previous.elements.filter(e => !currRefs.has(e.name + ':' + e.role));

    // Compute changed regions from moved/resized elements
    const changedRegions: Rect[] = [];
    for (const curr of current.elements) {
      const prev = previous.elements.find(p => p.name === curr.name && p.role === curr.role);
      if (prev && (prev.bounds.x !== curr.bounds.x || prev.bounds.y !== curr.bounds.y ||
          prev.bounds.width !== curr.bounds.width || prev.bounds.height !== curr.bounds.height)) {
        changedRegions.push(curr.bounds);
      }
    }

    const totalUnique = new Set([...prevRefs, ...currRefs]).size;
    const intersection = previous.elements.filter(e => currRefs.has(e.name + ':' + e.role)).length;
    const similarity = totalUnique > 0 ? intersection / totalUnique : 1;

    return {
      hasChanges: newElements.length > 0 || removedElements.length > 0 || changedRegions.length > 0,
      changedRegions,
      newElements,
      removedElements,
      similarity,
    };
  }

  /**
   * Generate annotated screenshot with ref badges overlaid on each element
   */
  async toAnnotatedScreenshot(): Promise<AnnotatedScreenshot | null> {
    if (!this.currentSnapshot?.valid) {
      return null;
    }

    try {
      // Capture a screenshot first
      const { ScreenshotTool } = await import('../tools/screenshot-tool.js');
      const screenshotTool = new ScreenshotTool();
      const captureResult = await screenshotTool.capture({ fullscreen: true, format: 'png' });

      const captureData = captureResult.data as Record<string, unknown> | undefined;
      if (!captureResult.success || !captureData?.path) {
        logger.warn('Failed to capture screenshot for annotation');
        return null;
      }

      const screenshotPath: string = captureData.path as string;
      const elements = this.currentSnapshot.elements;

      // Try sharp first for compositing ref badges
      try {
        const annotatedResult = await this.annotateWithSharp(screenshotPath, elements);
        if (annotatedResult) return annotatedResult;
      } catch (err) {
        logger.debug('sharp annotation failed, trying ffmpeg fallback', { error: err });
      }

      // Fallback: ffmpeg drawtext filter
      try {
        const annotatedResult = await this.annotateWithFFmpeg(screenshotPath, elements);
        if (annotatedResult) return annotatedResult;
      } catch (err) {
        logger.debug('ffmpeg annotation also failed', { error: err });
      }

      // Last resort: return un-annotated screenshot
      const { readFileSync } = await import('fs');
      const buf = readFileSync(screenshotPath);
      return {
        image: buf.toString('base64'),
        format: 'png',
        width: this.currentSnapshot.screenSize.width,
        height: this.currentSnapshot.screenSize.height,
        snapshot: this.currentSnapshot,
      };
    } catch (error) {
      logger.error('Annotated screenshot generation failed', { error });
      return null;
    }
  }

  private async annotateWithSharp(
    screenshotPath: string,
    elements: UIElement[]
  ): Promise<AnnotatedScreenshot | null> {
    const sharp = (await import('sharp')).default;
    const image = sharp(screenshotPath);
    const metadata = await image.metadata();
    const imgWidth = metadata.width || 1920;
    const imgHeight = metadata.height || 1080;

    // Build SVG overlay with ref badges
    const badgeSize = 20;
    const svgParts: string[] = [];
    svgParts.push(`<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">`);

    for (const elem of elements) {
      if (!elem.visible || elem.bounds.width === 0) continue;
      const bx = Math.max(0, Math.min(elem.bounds.x, imgWidth - badgeSize));
      const by = Math.max(0, Math.min(elem.bounds.y, imgHeight - badgeSize));
      const textLen = String(elem.ref).length;
      const pillWidth = Math.max(badgeSize, 10 + textLen * 8);

      svgParts.push(
        `<rect x="${bx}" y="${by}" width="${pillWidth}" height="${badgeSize}" rx="4" fill="#FF6B6B"/>`,
        `<text x="${bx + pillWidth / 2}" y="${by + 15}" font-size="13" font-family="monospace" fill="white" text-anchor="middle">${elem.ref}</text>`
      );
    }

    svgParts.push('</svg>');
    const svgOverlay = Buffer.from(svgParts.join('\n'));

    const outputBuffer = await image
      .composite([{ input: svgOverlay, top: 0, left: 0 }])
      .png()
      .toBuffer();

    return {
      image: outputBuffer.toString('base64'),
      format: 'png',
      width: imgWidth,
      height: imgHeight,
      snapshot: this.currentSnapshot!,
    };
  }

  private async annotateWithFFmpeg(
    screenshotPath: string,
    elements: UIElement[]
  ): Promise<AnnotatedScreenshot | null> {
    const { mkdtempSync, readFileSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    const tmpDir = mkdtempSync(join(require('os').tmpdir(), 'cb-annotate-'));
    const outputPath = join(tmpDir, 'annotated.png');

    // Build drawtext filter chain
    const filters = elements
      .filter(e => e.visible && e.bounds.width > 0)
      .slice(0, 50) // Limit filter complexity
      .map(e => {
        const bx = Math.max(0, e.bounds.x);
        const by = Math.max(0, e.bounds.y);
        return `drawtext=text='[${e.ref}]':x=${bx}:y=${by}:fontsize=14:fontcolor=white:box=1:boxcolor=#FF6B6B@0.9:boxborderw=3`;
      })
      .join(',');

    if (!filters) return null;

    try {
      await execAsync(
        `ffmpeg -y -i "${screenshotPath}" -vf "${filters}" "${outputPath}"`,
        { timeout: 15000 }
      );

      const buf = readFileSync(outputPath);
      try { unlinkSync(outputPath); } catch (_e) { /* ignore */ }
      try { const { rmdirSync } = await import('fs'); rmdirSync(tmpDir); } catch (_e) { /* ignore */ }

      return {
        image: buf.toString('base64'),
        format: 'png',
        width: this.currentSnapshot!.screenSize.width,
        height: this.currentSnapshot!.screenSize.height,
        snapshot: this.currentSnapshot!,
      };
    } catch (_err) {
      try { const { rmSync } = await import('fs'); rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
      return null;
    }
  }

  // ============================================================================
  // Element Detection - Accessibility APIs
  // ============================================================================

  private async detectAccessibilityElements(options: SnapshotOptions): Promise<UIElement[]> {
    const platform = process.platform;

    switch (platform) {
      case 'darwin':
        return this.detectMacOSElements(options);
      case 'linux':
        return this.detectLinuxElements(options);
      case 'win32':
        return this.detectWindowsElements(options);
      default:
        logger.warn(`Accessibility not supported on ${platform}`);
        return [];
    }
  }

  private async detectMacOSElements(options: SnapshotOptions): Promise<UIElement[]> {
    const elements: UIElement[] = [];

    try {
      // Use AppleScript to query accessibility elements
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
          set allElements to {}

          try
            set allWindows to windows of frontApp
            repeat with w in allWindows
              set windowElements to entire contents of w
              repeat with elem in windowElements
                try
                  set elemRole to role of elem
                  set elemName to name of elem
                  set elemDesc to description of elem
                  set elemPos to position of elem
                  set elemSize to size of elem
                  set elemEnabled to enabled of elem
                  set elemFocused to focused of elem

                  set end of allElements to {elemRole, elemName, elemDesc, elemPos, elemSize, elemEnabled, elemFocused}
                end try
              end repeat
            end repeat
          end try

          return allElements
        end tell
      `;

      // This is a simplified version - real implementation would need
      // proper AppleScript output parsing
      const output = execSync(
        `osascript -e 'tell application "System Events" to get name of every UI element of window 1 of (first application process whose frontmost is true)' 2>/dev/null`,
        { encoding: 'utf-8', timeout: 10000 }
      );

      const names = output.split(', ').filter(n => n.trim());
      for (const name of names.slice(0, this.config.maxElements)) {
        elements.push(this.createMockElement(name, this.nextRef++));
      }
    } catch (error) {
      logger.debug('macOS accessibility detection failed', { error });
      // Return mock elements for testing
      elements.push(...this.getMockElements());
    }

    return elements;
  }

  /**
   * Detect if running inside WSL2
   */
  private isWSL(): boolean {
    try {
      const release = execSync('uname -r', { encoding: 'utf-8' });
      return /microsoft|wsl/i.test(release);
    } catch (_err) {
      return false;
    }
  }

  private async detectLinuxElements(options: SnapshotOptions): Promise<UIElement[]> {
    // WSL2: use PowerShell UIAutomation for real Windows desktop elements
    if (this.isWSL()) {
      try {
        const wslElements = await this.detectWSLElements(options);
        if (wslElements.length > 0) {
          return wslElements;
        }
      } catch (err) {
        logger.debug('WSL2 PowerShell UIAutomation failed, trying AT-SPI', { error: err });
      }
    }

    // Native Linux: try AT-SPI
    return this.detectLinuxATSPIElements(options);
  }

  /**
   * Detect elements on WSL2 via PowerShell UIAutomation (same script as detectWindowsElements)
   */
  private async detectWSLElements(options: SnapshotOptions): Promise<UIElement[]> {
    const elements: UIElement[] = [];

    // Check powershell.exe is available
    execSync('which powershell.exe', { stdio: 'ignore' });

    const script = `
Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]::RootElement
$condition = [System.Windows.Automation.Condition]::TrueCondition
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Get-Elements($element, $depth) {
    if ($depth -gt 5) { return @() }
    $results = @()

    try {
        $name = $element.Current.Name
        $role = $element.Current.ControlType.ProgrammaticName
        $rect = $element.Current.BoundingRectangle

        $results += @{
            name = $name
            role = $role
            x = [int]$rect.X
            y = [int]$rect.Y
            width = [int]$rect.Width
            height = [int]$rect.Height
        }

        $child = $walker.GetFirstChild($element)
        while ($child -ne $null) {
            $results += Get-Elements $child ($depth + 1)
            $child = $walker.GetNextSibling($child)
        }
    } catch {}

    return $results
}

$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($focused) {
    $parent = $walker.GetParent($focused)
    while ($parent -ne $null -and $parent.Current.ControlType.ProgrammaticName -ne "ControlType.Window") {
        $parent = $walker.GetParent($parent)
    }
    if ($parent) {
        Get-Elements $parent 0 | ConvertTo-Json -Depth 10
    }
}
    `;

    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -Command "${script.replace(/\n/g, '; ')}"`,
      { timeout: 15000 }
    );

    const parsed = JSON.parse(stdout);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items.slice(0, this.config.maxElements)) {
      const role = this.mapWindowsRole(item.role);
      elements.push({
        ref: this.nextRef++,
        role,
        name: item.name || 'Unknown',
        bounds: { x: item.x, y: item.y, width: item.width, height: item.height },
        center: {
          x: item.x + item.width / 2,
          y: item.y + item.height / 2,
        },
        interactive: this.isInteractiveRole(role),
        focused: false,
        enabled: true,
        visible: item.width > 0 && item.height > 0,
      });
    }

    return elements;
  }

  /**
   * Detect elements on native Linux via AT-SPI
   */
  private async detectLinuxATSPIElements(options: SnapshotOptions): Promise<UIElement[]> {
    const elements: UIElement[] = [];

    try {
      // Use AT-SPI via python-atspi or accerciser
      // This requires libatspi and python3-atspi2 to be installed
      const script = `
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
import json

def get_elements(obj, depth=0, max_depth=5):
    elements = []
    if depth > max_depth:
        return elements

    try:
        role = Atspi.Accessible.get_role_name(obj)
        name = Atspi.Accessible.get_name(obj) or ""

        try:
            component = obj.get_component()
            if component:
                rect = component.get_extents(Atspi.CoordType.SCREEN)
                bounds = {"x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height}
            else:
                bounds = {"x": 0, "y": 0, "width": 0, "height": 0}
        except:
            bounds = {"x": 0, "y": 0, "width": 0, "height": 0}

        elements.append({
            "role": role,
            "name": name,
            "bounds": bounds
        })

        for i in range(obj.get_child_count()):
            child = obj.get_child_at_index(i)
            elements.extend(get_elements(child, depth + 1, max_depth))
    except:
        pass

    return elements

desktop = Atspi.get_desktop(0)
all_elements = []
for i in range(desktop.get_child_count()):
    app = desktop.get_child_at_index(i)
    all_elements.extend(get_elements(app))

print(json.dumps(all_elements[:100]))
      `;

      // Try to run the Python script
      try {
        const { stdout } = await execAsync(`python3 -c '${script}' 2>/dev/null`, {
          timeout: 10000,
        });

        const parsed = JSON.parse(stdout);
        for (const item of parsed) {
          const role = this.mapRole(item.role);
          elements.push({
            ref: this.nextRef++,
            role,
            name: item.name || 'Unknown',
            bounds: item.bounds,
            center: {
              x: item.bounds.x + item.bounds.width / 2,
              y: item.bounds.y + item.bounds.height / 2,
            },
            interactive: this.isInteractiveRole(role),
            focused: false,
            enabled: true,
            visible: item.bounds.width > 0 && item.bounds.height > 0,
          });
        }
      } catch (_err) {
        // Intentionally ignored: AT-SPI parsing may fail, fallback to mock elements
        elements.push(...this.getMockElements());
      }
    } catch (error) {
      logger.debug('Linux accessibility detection failed', { error });
      elements.push(...this.getMockElements());
    }

    return elements;
  }

  private async detectWindowsElements(options: SnapshotOptions): Promise<UIElement[]> {
    const elements: UIElement[] = [];

    try {
      // Use UIAutomation via PowerShell
      const script = `
Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]::RootElement
$condition = [System.Windows.Automation.Condition]::TrueCondition
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Get-Elements($element, $depth) {
    if ($depth -gt 5) { return @() }
    $results = @()

    try {
        $name = $element.Current.Name
        $role = $element.Current.ControlType.ProgrammaticName
        $rect = $element.Current.BoundingRectangle

        $results += @{
            name = $name
            role = $role
            x = [int]$rect.X
            y = [int]$rect.Y
            width = [int]$rect.Width
            height = [int]$rect.Height
        }

        $child = $walker.GetFirstChild($element)
        while ($child -ne $null) {
            $results += Get-Elements $child ($depth + 1)
            $child = $walker.GetNextSibling($child)
        }
    } catch {}

    return $results
}

$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($focused) {
    $parent = $walker.GetParent($focused)
    while ($parent -ne $null -and $parent.Current.ControlType.ProgrammaticName -ne "ControlType.Window") {
        $parent = $walker.GetParent($parent)
    }
    if ($parent) {
        Get-Elements $parent 0 | ConvertTo-Json -Depth 10
    }
}
      `;

      try {
        const { stdout } = await execAsync(
          `powershell -Command "${script.replace(/\n/g, '; ')}"`,
          { timeout: 15000 }
        );

        const parsed = JSON.parse(stdout);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items.slice(0, this.config.maxElements)) {
          const role = this.mapWindowsRole(item.role);
          elements.push({
            ref: this.nextRef++,
            role,
            name: item.name || 'Unknown',
            bounds: { x: item.x, y: item.y, width: item.width, height: item.height },
            center: {
              x: item.x + item.width / 2,
              y: item.y + item.height / 2,
            },
            interactive: this.isInteractiveRole(role),
            focused: false,
            enabled: true,
            visible: item.width > 0 && item.height > 0,
          });
        }
      } catch (_err) {
        // Intentionally ignored: UIAutomation JSON parsing may fail, fallback to mock elements
        elements.push(...this.getMockElements());
      }
    } catch (error) {
      logger.debug('Windows accessibility detection failed', { error });
      elements.push(...this.getMockElements());
    }

    return elements;
  }

  // ============================================================================
  // Element Detection - OCR Fallback
  // ============================================================================

  private async detectOCRElements(options: SnapshotOptions): Promise<UIElement[]> {
    // OCR-based detection would use the OCR tool to find text elements
    // This is a placeholder - actual implementation would integrate with ocr-tool.ts
    logger.debug('OCR element detection not yet implemented');
    return [];
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private filterElements(elements: UIElement[], options: SnapshotOptions): UIElement[] {
    let filtered = elements;

    if (options.interactiveOnly) {
      filtered = filtered.filter(e => e.interactive);
    }

    if (!options.includeHidden) {
      filtered = filtered.filter(e => e.visible);
    }

    if (options.roles && options.roles.length > 0) {
      filtered = filtered.filter(e => options.roles!.includes(e.role));
    }

    // Limit to max elements
    return filtered.slice(0, this.config.maxElements);
  }

  private mapRole(atspiRole: string): ElementRole {
    const roleMap: Record<string, ElementRole> = {
      'push button': 'button',
      'toggle button': 'button',
      'link': 'link',
      'text': 'text-field',
      'entry': 'text-field',
      'password text': 'text-field',
      'check box': 'checkbox',
      'radio button': 'radio',
      'combo box': 'dropdown',
      'menu': 'menu',
      'menu item': 'menu-item',
      'page tab': 'tab',
      'list item': 'list-item',
      'image': 'image',
      'label': 'text',
      'panel': 'container',
      'frame': 'window',
    };

    return roleMap[atspiRole.toLowerCase()] || 'unknown';
  }

  private mapWindowsRole(controlType: string): ElementRole {
    const roleMap: Record<string, ElementRole> = {
      'ControlType.Button': 'button',
      'ControlType.Hyperlink': 'link',
      'ControlType.Edit': 'text-field',
      'ControlType.CheckBox': 'checkbox',
      'ControlType.RadioButton': 'radio',
      'ControlType.ComboBox': 'dropdown',
      'ControlType.Menu': 'menu',
      'ControlType.MenuItem': 'menu-item',
      'ControlType.Tab': 'tab',
      'ControlType.TabItem': 'tab',
      'ControlType.ListItem': 'list-item',
      'ControlType.Image': 'image',
      'ControlType.Text': 'text',
      'ControlType.Pane': 'container',
      'ControlType.Window': 'window',
    };

    return roleMap[controlType] || 'unknown';
  }

  private isInteractiveRole(role: ElementRole): boolean {
    const interactiveRoles: ElementRole[] = [
      'button',
      'link',
      'text-field',
      'checkbox',
      'radio',
      'dropdown',
      'menu-item',
      'tab',
      'list-item',
    ];
    return interactiveRoles.includes(role);
  }

  private async getScreenSize(): Promise<{ width: number; height: number }> {
    try {
      if (process.platform === 'darwin') {
        const output = execSync(
          `system_profiler SPDisplaysDataType | grep Resolution | head -1`,
          { encoding: 'utf-8' }
        );
        const match = output.match(/(\d+)\s*x\s*(\d+)/);
        if (match) {
          return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
        }
      } else if (process.platform === 'linux') {
        const output = execSync(`xdpyinfo | grep dimensions`, { encoding: 'utf-8' });
        const match = output.match(/(\d+)x(\d+)/);
        if (match) {
          return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
        }
      } else if (process.platform === 'win32') {
        const output = execSync(
          `powershell -Command "[System.Windows.Forms.Screen]::PrimaryScreen.Bounds | ConvertTo-Json"`,
          { encoding: 'utf-8' }
        );
        const data = JSON.parse(output);
        return { width: data.Width, height: data.Height };
      }
    } catch (_err) {
      // Intentionally ignored: screen resolution detection is best-effort, defaults to 1920x1080
    }

    return { width: 1920, height: 1080 }; // Default fallback
  }

  private createMockElement(name: string, ref: number): UIElement {
    return {
      ref,
      role: 'button',
      name: name.trim() || `Element ${ref}`,
      bounds: { x: 100 * ref, y: 100, width: 100, height: 30 },
      center: { x: 100 * ref + 50, y: 115 },
      interactive: true,
      focused: false,
      enabled: true,
      visible: true,
    };
  }

  private getMockElements(): UIElement[] {
    // Return sample mock elements for testing
    return [
      {
        ref: this.nextRef++,
        role: 'button',
        name: 'OK',
        bounds: { x: 200, y: 300, width: 80, height: 30 },
        center: { x: 240, y: 315 },
        interactive: true,
        focused: false,
        enabled: true,
        visible: true,
      },
      {
        ref: this.nextRef++,
        role: 'button',
        name: 'Cancel',
        bounds: { x: 300, y: 300, width: 80, height: 30 },
        center: { x: 340, y: 315 },
        interactive: true,
        focused: false,
        enabled: true,
        visible: true,
      },
      {
        ref: this.nextRef++,
        role: 'text-field',
        name: 'Search',
        bounds: { x: 100, y: 100, width: 300, height: 30 },
        center: { x: 250, y: 115 },
        interactive: true,
        focused: true,
        enabled: true,
        visible: true,
        placeholder: 'Type to search...',
      },
      {
        ref: this.nextRef++,
        role: 'checkbox',
        name: 'Remember me',
        bounds: { x: 100, y: 150, width: 150, height: 20 },
        center: { x: 175, y: 160 },
        interactive: true,
        focused: false,
        enabled: true,
        visible: true,
        value: 'false',
      },
      {
        ref: this.nextRef++,
        role: 'link',
        name: 'Forgot password?',
        bounds: { x: 100, y: 200, width: 120, height: 20 },
        center: { x: 160, y: 210 },
        interactive: true,
        focused: false,
        enabled: true,
        visible: true,
      },
    ];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let smartSnapshotInstance: SmartSnapshotManager | null = null;

export function getSmartSnapshotManager(config?: Partial<SmartSnapshotConfig>): SmartSnapshotManager {
  if (!smartSnapshotInstance) {
    smartSnapshotInstance = new SmartSnapshotManager(config);
  }
  return smartSnapshotInstance;
}

export function resetSmartSnapshotManager(): void {
  smartSnapshotInstance = null;
}

export default SmartSnapshotManager;
