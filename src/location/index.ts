/**
 * Location Service Module
 *
 * Provides geographic location context and utilities.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface GeoCoordinates {
  /** Latitude in degrees */
  latitude: number;
  /** Longitude in degrees */
  longitude: number;
  /** Altitude in meters (if available) */
  altitude?: number;
  /** Accuracy in meters */
  accuracy?: number;
  /** Altitude accuracy in meters */
  altitudeAccuracy?: number;
  /** Heading in degrees (0-360) */
  heading?: number;
  /** Speed in m/s */
  speed?: number;
}

export interface GeoLocation extends GeoCoordinates {
  /** Timestamp of the location */
  timestamp: Date;
  /** Source of the location data */
  source: LocationSource;
  /** Location name (if resolved) */
  name?: string;
  /** Address components */
  address?: AddressComponents;
  /** Timezone */
  timezone?: TimezoneInfo;
}

export type LocationSource = 'gps' | 'network' | 'ip' | 'manual' | 'cached' | 'mock';

export interface AddressComponents {
  /** Street number */
  streetNumber?: string;
  /** Street name */
  street?: string;
  /** City */
  city?: string;
  /** State/Province */
  state?: string;
  /** Country */
  country?: string;
  /** Country code (ISO 3166-1) */
  countryCode?: string;
  /** Postal/ZIP code */
  postalCode?: string;
  /** Formatted address */
  formatted?: string;
}

export interface TimezoneInfo {
  /** Timezone ID (e.g., 'America/New_York') */
  id: string;
  /** Timezone abbreviation (e.g., 'EST') */
  abbreviation: string;
  /** UTC offset in minutes */
  offsetMinutes: number;
  /** Current DST status */
  isDST: boolean;
}

export interface LocationConfig {
  /** Enable location services */
  enabled: boolean;
  /** Default source preference */
  preferredSource: LocationSource;
  /** Enable caching */
  cacheEnabled: boolean;
  /** Cache TTL in milliseconds */
  cacheTTLMs: number;
  /** Auto-update interval (ms), 0 to disable */
  autoUpdateIntervalMs: number;
  /** Enable reverse geocoding */
  reverseGeocode: boolean;
  /** IP geolocation API URL */
  ipGeoApiUrl?: string;
  /** Default location (fallback) */
  defaultLocation?: GeoCoordinates;
}

export const DEFAULT_LOCATION_CONFIG: LocationConfig = {
  enabled: true,
  preferredSource: 'ip',
  cacheEnabled: true,
  cacheTTLMs: 5 * 60 * 1000, // 5 minutes
  autoUpdateIntervalMs: 0,
  reverseGeocode: true,
};

export interface LocationEvents {
  'location-update': (location: GeoLocation) => void;
  'location-error': (error: Error) => void;
  'source-change': (source: LocationSource) => void;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate distance between two points (Haversine formula)
 * @returns Distance in meters
 */
export function calculateDistance(
  point1: GeoCoordinates,
  point2: GeoCoordinates
): number {
  const R = 6371000; // Earth's radius in meters
  const lat1 = toRadians(point1.latitude);
  const lat2 = toRadians(point2.latitude);
  const deltaLat = toRadians(point2.latitude - point1.latitude);
  const deltaLon = toRadians(point2.longitude - point1.longitude);

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate bearing between two points
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(
  from: GeoCoordinates,
  to: GeoCoordinates
): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  let bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * Get cardinal direction from bearing
 */
export function bearingToCardinal(bearing: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
}

/**
 * Check if a point is within a radius of another point
 */
export function isWithinRadius(
  point: GeoCoordinates,
  center: GeoCoordinates,
  radiusMeters: number
): boolean {
  return calculateDistance(point, center) <= radiusMeters;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Format coordinates as string
 */
export function formatCoordinates(
  coords: GeoCoordinates,
  format: 'decimal' | 'dms' = 'decimal'
): string {
  if (format === 'decimal') {
    return `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
  }

  // DMS format
  const latDir = coords.latitude >= 0 ? 'N' : 'S';
  const lonDir = coords.longitude >= 0 ? 'E' : 'W';

  const formatDMS = (decimal: number): string => {
    const abs = Math.abs(decimal);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = ((minFloat - min) * 60).toFixed(1);
    return `${deg}°${min}'${sec}"`;
  };

  return `${formatDMS(coords.latitude)}${latDir}, ${formatDMS(coords.longitude)}${lonDir}`;
}

// ============================================================================
// Location Service
// ============================================================================

export class LocationService extends EventEmitter {
  private config: LocationConfig;
  private cachedLocation: GeoLocation | null = null;
  private cacheTimestamp: number = 0;
  private autoUpdateInterval: NodeJS.Timeout | null = null;
  private currentSource: LocationSource = 'ip';

  // Mock location for testing
  private mockLocation: GeoLocation | null = null;

  constructor(config: Partial<LocationConfig> = {}) {
    super();
    this.config = { ...DEFAULT_LOCATION_CONFIG, ...config };
    this.currentSource = this.config.preferredSource;
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get current configuration
   */
  getConfig(): LocationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LocationConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart auto-update if interval changed
    if (config.autoUpdateIntervalMs !== undefined) {
      this.stopAutoUpdate();
      if (config.autoUpdateIntervalMs > 0) {
        this.startAutoUpdate();
      }
    }
  }

  // ============================================================================
  // Location Retrieval
  // ============================================================================

  /**
   * Get current location
   */
  async getCurrentLocation(options?: {
    forceRefresh?: boolean;
    source?: LocationSource;
  }): Promise<GeoLocation> {
    // Check mock first
    if (this.mockLocation) {
      return this.mockLocation;
    }

    // Check cache
    if (
      !options?.forceRefresh &&
      this.config.cacheEnabled &&
      this.cachedLocation &&
      Date.now() - this.cacheTimestamp < this.config.cacheTTLMs
    ) {
      return this.cachedLocation;
    }

    const source = options?.source || this.currentSource;
    let location: GeoLocation;

    try {
      switch (source) {
        case 'ip':
          location = await this.getLocationByIP();
          break;
        case 'manual':
          if (this.config.defaultLocation) {
            location = this.createLocation(
              this.config.defaultLocation,
              'manual'
            );
          } else {
            throw new Error('No default location configured');
          }
          break;
        case 'cached':
          if (this.cachedLocation) {
            location = this.cachedLocation;
          } else {
            throw new Error('No cached location available');
          }
          break;
        default:
          // For GPS/network, fall back to IP in mock implementation
          location = await this.getLocationByIP();
      }

      // Reverse geocode if enabled
      if (this.config.reverseGeocode && !location.address) {
        location.address = await this.reverseGeocode(location);
      }

      // Add timezone
      if (!location.timezone) {
        location.timezone = this.getTimezone(location);
      }

      // Update cache
      if (this.config.cacheEnabled) {
        this.cachedLocation = location;
        this.cacheTimestamp = Date.now();
      }

      this.emit('location-update', location);
      return location;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('location-error', err);
      throw err;
    }
  }

  /**
   * Get location by IP (mock implementation)
   */
  private async getLocationByIP(): Promise<GeoLocation> {
    // Mock IP geolocation response
    // In real implementation, this would call an IP geolocation API
    await new Promise(resolve => setTimeout(resolve, 50));

    return this.createLocation(
      {
        latitude: 48.8566,
        longitude: 2.3522,
        accuracy: 1000, // 1km accuracy for IP-based
      },
      'ip',
      'Paris, France'
    );
  }

  /**
   * Create a GeoLocation object
   */
  private createLocation(
    coords: GeoCoordinates,
    source: LocationSource,
    name?: string
  ): GeoLocation {
    return {
      ...coords,
      timestamp: new Date(),
      source,
      name,
    };
  }

  /**
   * Reverse geocode coordinates to address
   */
  private async reverseGeocode(location: GeoLocation): Promise<AddressComponents | undefined> {
    // Mock reverse geocoding
    // In real implementation, this would call a geocoding API
    await new Promise(resolve => setTimeout(resolve, 50));

    // Return mock address based on known locations
    if (Math.abs(location.latitude - 48.8566) < 0.1 &&
        Math.abs(location.longitude - 2.3522) < 0.1) {
      return {
        city: 'Paris',
        state: 'Île-de-France',
        country: 'France',
        countryCode: 'FR',
        postalCode: '75001',
        formatted: 'Paris, France',
      };
    }

    return {
      formatted: `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`,
    };
  }

  /**
   * Get timezone for location
   */
  private getTimezone(location: GeoLocation): TimezoneInfo {
    // Simple timezone estimation based on longitude
    // Real implementation would use a timezone database
    const offsetHours = Math.round(location.longitude / 15);

    return {
      id: 'Europe/Paris', // Mock
      abbreviation: 'CET',
      offsetMinutes: offsetHours * 60,
      isDST: false,
    };
  }

  // ============================================================================
  // Auto-Update
  // ============================================================================

  /**
   * Start auto-updating location
   */
  startAutoUpdate(): void {
    if (this.autoUpdateInterval) return;

    if (this.config.autoUpdateIntervalMs > 0) {
      this.autoUpdateInterval = setInterval(() => {
        this.getCurrentLocation({ forceRefresh: true }).catch(error => {
          this.emit('location-error', error instanceof Error ? error : new Error(String(error)));
        });
      }, this.config.autoUpdateIntervalMs);
    }
  }

  /**
   * Stop auto-updating location
   */
  stopAutoUpdate(): void {
    if (this.autoUpdateInterval) {
      clearInterval(this.autoUpdateInterval);
      this.autoUpdateInterval = null;
    }
  }

  // ============================================================================
  // Source Management
  // ============================================================================

  /**
   * Get current location source
   */
  getSource(): LocationSource {
    return this.currentSource;
  }

  /**
   * Set location source
   */
  setSource(source: LocationSource): void {
    this.currentSource = source;
    this.emit('source-change', source);
  }

  // ============================================================================
  // Mock Support (for testing)
  // ============================================================================

  /**
   * Set mock location (for testing)
   */
  setMockLocation(location: GeoLocation | null): void {
    this.mockLocation = location;
  }

  /**
   * Create mock location from coordinates
   */
  createMockLocation(
    latitude: number,
    longitude: number,
    options?: Partial<GeoLocation>
  ): GeoLocation {
    return {
      latitude,
      longitude,
      timestamp: new Date(),
      source: 'mock',
      ...options,
    };
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Clear location cache
   */
  clearCache(): void {
    this.cachedLocation = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Get cached location
   */
  getCachedLocation(): GeoLocation | null {
    return this.cachedLocation;
  }

  // ============================================================================
  // Distance & Direction
  // ============================================================================

  /**
   * Get distance to a point from current location
   */
  async getDistanceTo(point: GeoCoordinates): Promise<number> {
    const current = await this.getCurrentLocation();
    return calculateDistance(current, point);
  }

  /**
   * Get bearing to a point from current location
   */
  async getBearingTo(point: GeoCoordinates): Promise<number> {
    const current = await this.getCurrentLocation();
    return calculateBearing(current, point);
  }

  /**
   * Check if within radius of a point
   */
  async isWithinRadius(center: GeoCoordinates, radiusMeters: number): Promise<boolean> {
    const current = await this.getCurrentLocation();
    return isWithinRadius(current, center, radiusMeters);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Shutdown the service
   */
  shutdown(): void {
    this.stopAutoUpdate();
    this.clearCache();
    this.mockLocation = null;
  }

  /**
   * Get service stats
   */
  getStats(): {
    enabled: boolean;
    source: LocationSource;
    hasCachedLocation: boolean;
    cacheAge: number;
    isAutoUpdating: boolean;
  } {
    return {
      enabled: this.config.enabled,
      source: this.currentSource,
      hasCachedLocation: this.cachedLocation !== null,
      cacheAge: this.cachedLocation ? Date.now() - this.cacheTimestamp : 0,
      isAutoUpdating: this.autoUpdateInterval !== null,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let locationServiceInstance: LocationService | null = null;

export function getLocationService(config?: Partial<LocationConfig>): LocationService {
  if (!locationServiceInstance) {
    locationServiceInstance = new LocationService(config);
  }
  return locationServiceInstance;
}

export function resetLocationService(): void {
  if (locationServiceInstance) {
    locationServiceInstance.shutdown();
    locationServiceInstance = null;
  }
}
