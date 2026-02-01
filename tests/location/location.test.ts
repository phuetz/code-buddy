/**
 * Location Service Tests
 */

import {
  LocationService,
  getLocationService,
  resetLocationService,
  calculateDistance,
  calculateBearing,
  bearingToCardinal,
  isWithinRadius,
  formatCoordinates,
  type GeoCoordinates,
} from '../../src/location/index.js';

describe('Location Utilities', () => {
  describe('calculateDistance', () => {
    it('should calculate distance between two points', () => {
      const paris: GeoCoordinates = { latitude: 48.8566, longitude: 2.3522 };
      const london: GeoCoordinates = { latitude: 51.5074, longitude: -0.1278 };

      const distance = calculateDistance(paris, london);

      // Should be approximately 344km
      expect(distance).toBeGreaterThan(340000);
      expect(distance).toBeLessThan(350000);
    });

    it('should return 0 for same point', () => {
      const point: GeoCoordinates = { latitude: 48.8566, longitude: 2.3522 };

      const distance = calculateDistance(point, point);

      expect(distance).toBe(0);
    });

    it('should handle points across equator', () => {
      const north: GeoCoordinates = { latitude: 10, longitude: 0 };
      const south: GeoCoordinates = { latitude: -10, longitude: 0 };

      const distance = calculateDistance(north, south);

      // About 2220 km
      expect(distance).toBeGreaterThan(2200000);
      expect(distance).toBeLessThan(2250000);
    });
  });

  describe('calculateBearing', () => {
    it('should calculate bearing north', () => {
      const from: GeoCoordinates = { latitude: 0, longitude: 0 };
      const to: GeoCoordinates = { latitude: 10, longitude: 0 };

      const bearing = calculateBearing(from, to);

      expect(bearing).toBeCloseTo(0, 0);
    });

    it('should calculate bearing east', () => {
      const from: GeoCoordinates = { latitude: 0, longitude: 0 };
      const to: GeoCoordinates = { latitude: 0, longitude: 10 };

      const bearing = calculateBearing(from, to);

      expect(bearing).toBeCloseTo(90, 0);
    });

    it('should calculate bearing south', () => {
      const from: GeoCoordinates = { latitude: 10, longitude: 0 };
      const to: GeoCoordinates = { latitude: 0, longitude: 0 };

      const bearing = calculateBearing(from, to);

      expect(bearing).toBeCloseTo(180, 0);
    });

    it('should calculate bearing west', () => {
      const from: GeoCoordinates = { latitude: 0, longitude: 10 };
      const to: GeoCoordinates = { latitude: 0, longitude: 0 };

      const bearing = calculateBearing(from, to);

      expect(bearing).toBeCloseTo(270, 0);
    });
  });

  describe('bearingToCardinal', () => {
    it('should convert bearing to cardinal direction', () => {
      expect(bearingToCardinal(0)).toBe('N');
      expect(bearingToCardinal(45)).toBe('NE');
      expect(bearingToCardinal(90)).toBe('E');
      expect(bearingToCardinal(135)).toBe('SE');
      expect(bearingToCardinal(180)).toBe('S');
      expect(bearingToCardinal(225)).toBe('SW');
      expect(bearingToCardinal(270)).toBe('W');
      expect(bearingToCardinal(315)).toBe('NW');
    });

    it('should handle 360 degrees', () => {
      expect(bearingToCardinal(360)).toBe('N');
    });
  });

  describe('isWithinRadius', () => {
    it('should detect point within radius', () => {
      const center: GeoCoordinates = { latitude: 48.8566, longitude: 2.3522 };
      const nearby: GeoCoordinates = { latitude: 48.8570, longitude: 2.3525 };

      expect(isWithinRadius(nearby, center, 1000)).toBe(true);
    });

    it('should detect point outside radius', () => {
      const center: GeoCoordinates = { latitude: 48.8566, longitude: 2.3522 };
      const far: GeoCoordinates = { latitude: 51.5074, longitude: -0.1278 };

      expect(isWithinRadius(far, center, 1000)).toBe(false);
    });
  });

  describe('formatCoordinates', () => {
    it('should format as decimal', () => {
      const coords: GeoCoordinates = { latitude: 48.8566, longitude: 2.3522 };

      const formatted = formatCoordinates(coords, 'decimal');

      expect(formatted).toBe('48.856600, 2.352200');
    });

    it('should format as DMS', () => {
      const coords: GeoCoordinates = { latitude: 48.8566, longitude: 2.3522 };

      const formatted = formatCoordinates(coords, 'dms');

      expect(formatted).toContain('N');
      expect(formatted).toContain('E');
      expect(formatted).toContain('°');
    });

    it('should handle negative coordinates', () => {
      const coords: GeoCoordinates = { latitude: -33.8688, longitude: -151.2093 };

      const formatted = formatCoordinates(coords, 'dms');

      expect(formatted).toContain('S');
      expect(formatted).toContain('W');
    });
  });
});

describe('LocationService', () => {
  let service: LocationService;

  beforeEach(() => {
    resetLocationService();
    service = new LocationService({
      cacheEnabled: false,
      reverseGeocode: false,
    });
  });

  afterEach(() => {
    service.shutdown();
    resetLocationService();
  });

  describe('Configuration', () => {
    it('should get configuration', () => {
      const config = service.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.cacheEnabled).toBe(false);
    });

    it('should update configuration', () => {
      service.updateConfig({ preferredSource: 'manual' });

      expect(service.getConfig().preferredSource).toBe('manual');
    });
  });

  describe('Location Retrieval', () => {
    it('should get current location', async () => {
      const location = await service.getCurrentLocation();

      expect(location.latitude).toBeDefined();
      expect(location.longitude).toBeDefined();
      expect(location.timestamp).toBeInstanceOf(Date);
      expect(location.source).toBe('ip');
    });

    it('should use mock location', async () => {
      const mockLoc = service.createMockLocation(40.7128, -74.0060, {
        name: 'New York',
      });
      service.setMockLocation(mockLoc);

      const location = await service.getCurrentLocation();

      expect(location.latitude).toBe(40.7128);
      expect(location.longitude).toBe(-74.0060);
      expect(location.source).toBe('mock');
    });

    it('should emit location-update event', async () => {
      let eventLocation = null;
      service.on('location-update', loc => { eventLocation = loc; });

      await service.getCurrentLocation();

      expect(eventLocation).not.toBeNull();
    });
  });

  describe('Caching', () => {
    beforeEach(() => {
      service.updateConfig({ cacheEnabled: true, cacheTTLMs: 60000 });
    });

    it('should cache location', async () => {
      await service.getCurrentLocation();

      expect(service.getCachedLocation()).not.toBeNull();
    });

    it('should return cached location', async () => {
      const first = await service.getCurrentLocation();
      const second = await service.getCurrentLocation();

      expect(first.timestamp.getTime()).toBe(second.timestamp.getTime());
    });

    it('should force refresh', async () => {
      await service.getCurrentLocation();
      await new Promise(resolve => setTimeout(resolve, 10));
      const second = await service.getCurrentLocation({ forceRefresh: true });

      // Force refresh should get new timestamp
      expect(second.timestamp.getTime()).toBeGreaterThan(0);
    });

    it('should clear cache', async () => {
      await service.getCurrentLocation();
      service.clearCache();

      expect(service.getCachedLocation()).toBeNull();
    });
  });

  describe('Reverse Geocoding', () => {
    beforeEach(() => {
      service.updateConfig({ reverseGeocode: true });
    });

    it('should add address to location', async () => {
      const location = await service.getCurrentLocation();

      expect(location.address).toBeDefined();
      expect(location.address?.city).toBe('Paris');
    });
  });

  describe('Timezone', () => {
    it('should add timezone to location', async () => {
      const location = await service.getCurrentLocation();

      expect(location.timezone).toBeDefined();
      expect(location.timezone?.id).toBeDefined();
    });
  });

  describe('Source Management', () => {
    it('should get current source', () => {
      expect(service.getSource()).toBe('ip');
    });

    it('should set source', () => {
      service.setSource('manual');

      expect(service.getSource()).toBe('manual');
    });

    it('should emit source-change event', () => {
      let newSource = null;
      service.on('source-change', src => { newSource = src; });

      service.setSource('manual');

      expect(newSource).toBe('manual');
    });
  });

  describe('Distance & Direction', () => {
    beforeEach(() => {
      const mockLoc = service.createMockLocation(48.8566, 2.3522);
      service.setMockLocation(mockLoc);
    });

    it('should get distance to point', async () => {
      const london: GeoCoordinates = { latitude: 51.5074, longitude: -0.1278 };

      const distance = await service.getDistanceTo(london);

      expect(distance).toBeGreaterThan(340000);
      expect(distance).toBeLessThan(350000);
    });

    it('should get bearing to point', async () => {
      const north: GeoCoordinates = { latitude: 58.8566, longitude: 2.3522 };

      const bearing = await service.getBearingTo(north);

      expect(bearing).toBeCloseTo(0, 0);
    });

    it('should check if within radius', async () => {
      const nearby: GeoCoordinates = { latitude: 48.8570, longitude: 2.3525 };

      expect(await service.isWithinRadius(nearby, 1000)).toBe(true);
      expect(await service.isWithinRadius(nearby, 10)).toBe(false);
    });
  });

  describe('Auto-Update', () => {
    it('should start auto-update', () => {
      service.updateConfig({ autoUpdateIntervalMs: 1000 });
      service.startAutoUpdate();

      expect(service.getStats().isAutoUpdating).toBe(true);

      service.stopAutoUpdate();
    });

    it('should stop auto-update', () => {
      service.updateConfig({ autoUpdateIntervalMs: 1000 });
      service.startAutoUpdate();
      service.stopAutoUpdate();

      expect(service.getStats().isAutoUpdating).toBe(false);
    });
  });

  describe('Statistics', () => {
    it('should return stats', () => {
      const stats = service.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.source).toBe('ip');
      expect(stats.hasCachedLocation).toBe(false);
      expect(stats.isAutoUpdating).toBe(false);
    });
  });

  describe('Manual Location', () => {
    it('should use default location for manual source', async () => {
      service.updateConfig({
        defaultLocation: { latitude: 35.6762, longitude: 139.6503 },
      });

      const location = await service.getCurrentLocation({ source: 'manual' });

      expect(location.latitude).toBe(35.6762);
      expect(location.longitude).toBe(139.6503);
      expect(location.source).toBe('manual');
    });

    it('should throw without default location for manual', async () => {
      await expect(
        service.getCurrentLocation({ source: 'manual' })
      ).rejects.toThrow('No default location configured');
    });
  });
});

describe('Singleton', () => {
  beforeEach(() => {
    resetLocationService();
  });

  afterEach(() => {
    resetLocationService();
  });

  it('should return same instance', () => {
    const service1 = getLocationService();
    const service2 = getLocationService();

    expect(service1).toBe(service2);
  });

  it('should reset instance', () => {
    const service1 = getLocationService();
    resetLocationService();
    const service2 = getLocationService();

    expect(service1).not.toBe(service2);
  });
});
