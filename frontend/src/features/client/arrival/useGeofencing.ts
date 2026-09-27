import { isReliableArrival } from './arrivalPolicy';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MOSCOW_BRANCHES, BranchLocation } from '../map/branchLocations';
import { getCurrentPositionFast } from '../map/geolocation';

export type GeofenceSimulationMode = 'near_101000' | 'home_1500m' | 'real_gps';

export type GpsPermissionState = 'prompt' | 'locating' | 'granted' | 'denied' | 'unavailable';

export interface GeoCoordinates {
  lat: number;
  lng: number;
  accuracy?: number;
  measuredAt?: number;
}

export interface GeofencePreset {
  lat: number;
  lng: number;
  label: string;
  description: string;
}

/**
 * Presets retained for testing and coordinates reference:
 * - 'near_101000': Myasnitskaya 26 (distance ~15m -> within 75m threshold)
 * - 'home_1500m': ~1.5 km away (outside 75m threshold)
 */
export const GEOFENCE_PRESETS: Record<'near_101000' | 'home_1500m', GeofencePreset> = {
  near_101000: {
    lat: 55.76194,
    lng: 37.63869,
    label: 'У входа отделения (15 м)',
    description: 'Мясницкая, 26 — внутри геозоны (15 м до входа)',
  },
  home_1500m: {
    lat: 55.77139,
    lng: 37.65548,
    label: 'Вне зоны (1.5 км)',
    description: '1.5 км от отделения — за пределами порога 75 м',
  },
};

export const DEFAULT_GEOFENCE_THRESHOLD_METERS = 75;
export const DEFAULT_ARRIVAL_THRESHOLD_METERS = 20;

/**
 * Calculates great-circle distance between two geographic coordinates in meters
 * using the Haversine formula.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371000; // Earth mean radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export interface UseGeofencingOptions {
  branches?: BranchLocation[];
  initialMode?: GeofenceSimulationMode;
  thresholdMeters?: number;
}

export interface UseGeofencingResult {
  currentCoordinates: GeoCoordinates;
  activeBranchInsideGeofence: BranchLocation | null;
  nearestBranch: BranchLocation | null;
  simulationMode: GeofenceSimulationMode;
  setSimulationMode: (mode: GeofenceSimulationMode) => void;
  distanceToNearestMeters: number | null;
  isInsideGeofence: boolean;
  hasRealGpsFix: boolean;
  thresholdMeters: number;
  gpsError: string | null;
  gpsPermissionStatus: GpsPermissionState;
  requestGpsPermission: () => void;
}

/**
 * React hook that determines client coordinates via real device GPS (navigator.geolocation),
 * calculates distance to postal branches using Haversine formula,
 * detects when client is inside branch geofence (radius <= 15-20 meters for instant arrival),
 * and exposes permission request mechanism when client denied or ignored prompt.
 */
export function useGeofencing(options: UseGeofencingOptions = {}): UseGeofencingResult {
  const {
    branches = MOSCOW_BRANCHES,
    initialMode = 'real_gps',
    thresholdMeters = DEFAULT_ARRIVAL_THRESHOLD_METERS,
  } = options;

  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const modeRef = useRef(initialMode);
  const [simulationMode, setSimulationMode] = useState<GeofenceSimulationMode>(initialMode);
  const [hasRealGpsFix, setHasRealGpsFix] = useState<boolean>(initialMode !== 'real_gps');
  const [gpsPermissionStatus, setGpsPermissionStatus] = useState<GpsPermissionState>('prompt');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const requestInFlightRef = useRef<Promise<GeolocationPosition> | null>(null);

  const [currentCoordinates, setCurrentCoordinates] = useState<GeoCoordinates>(() => {
    if (initialMode === 'home_1500m') return GEOFENCE_PRESETS.home_1500m;
    if (initialMode === 'near_101000') return GEOFENCE_PRESETS.near_101000;
    // Moscow city center neutral position away from branch geofences until real GPS arrives
    return { lat: 55.7558, lng: 37.6173 };
  });

  const requestGpsPermission = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGpsPermissionStatus('unavailable');
      setGpsError('Геолокация не поддерживается вашим браузером');
      return;
    }

    if (requestInFlightRef.current) return;
    setGpsError(null);
    setGpsPermissionStatus('locating');
    const request = getCurrentPositionFast(navigator.geolocation);
    requestInFlightRef.current = request;
    request.then((pos) => {
        if (modeRef.current !== 'real_gps') return;
        setCurrentCoordinates({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          measuredAt: pos.timestamp,
        });
        setHasRealGpsFix(true);
        setGpsPermissionStatus('granted');
        setGpsError(null);
      }).catch((err: GeolocationPositionError) => {
        if (modeRef.current !== 'real_gps') return;
        if (err.code === 1) {
          setHasRealGpsFix(false);
          setGpsPermissionStatus('denied');
          setGpsError('Доступ к геолокации отклонен');
        } else {
          setGpsPermissionStatus('unavailable');
          setGpsError(`GPS недоступен (${err.message})`);
        }
      }).finally(() => {
        if (requestInFlightRef.current === request) requestInFlightRef.current = null;
      });
  }, []);

  const handleSetSimulationMode = useCallback((mode: GeofenceSimulationMode) => {
    modeRef.current = mode;
    setSimulationMode(mode);
    if (mode === 'near_101000') {
      setCurrentCoordinates(GEOFENCE_PRESETS.near_101000);
      setHasRealGpsFix(true);
      setGpsError(null);
    } else if (mode === 'home_1500m') {
      setCurrentCoordinates(GEOFENCE_PRESETS.home_1500m);
      setHasRealGpsFix(true);
      setGpsError(null);
    } else if (mode === 'real_gps') {
      setHasRealGpsFix(false);
    }
  }, []);

  // Reuse an already granted permission on mount. When permission is still in
  // the prompt state, the browser request starts only from the user's click.
  useEffect(() => {
    if (simulationMode === 'real_gps') {
      if (typeof window !== 'undefined' && navigator.geolocation) {
        if (navigator.permissions?.query) {
          let active = true;
          navigator.permissions.query({ name: 'geolocation' as PermissionName })
            .then(permission => {
              if (!active || modeRef.current !== 'real_gps') return;
              setGpsPermissionStatus(permission.state === 'denied' ? 'denied' : 'prompt');
              if (permission.state === 'granted') requestGpsPermission();
            })
            .catch(() => { if (active) setGpsPermissionStatus('prompt'); });
          return () => { active = false; };
        }
        requestGpsPermission();
      } else {
        setGpsPermissionStatus('unavailable');
        setGpsError('Геолокация не поддерживается в этом браузере');
      }
    } else if (simulationMode === 'near_101000') {
      setCurrentCoordinates(GEOFENCE_PRESETS.near_101000);
      setHasRealGpsFix(true);
      setGpsError(null);
    } else if (simulationMode === 'home_1500m') {
      setCurrentCoordinates(GEOFENCE_PRESETS.home_1500m);
      setHasRealGpsFix(true);
      setGpsError(null);
    }
  }, [simulationMode, requestGpsPermission]);

  // Compute distance to branches and determine geofence status
  const { nearestBranch, distanceToNearestMeters, activeBranchInsideGeofence } = useMemo(() => {
    const list = branches;
    let closest: BranchLocation | null = null;
    let minDistance: number | null = null;

    for (const b of list) {
      if (typeof b.lat !== 'number' || typeof b.lng !== 'number') continue;
      const d = calculateHaversineDistanceMeters(
        currentCoordinates.lat,
        currentCoordinates.lng,
        b.lat,
        b.lng
      );
      if (minDistance === null || d < minDistance) {
        minDistance = d;
        closest = b;
      }
    }

    // Only activate geofence if simulation mode is active OR a real GPS fix has been acquired
    const canTrigger = simulationMode !== 'real_gps' || (hasRealGpsFix && minDistance !== null && isReliableArrival(minDistance, currentCoordinates.accuracy, thresholdMeters, currentCoordinates.measuredAt ?? 0, now));
    const isNearby = simulationMode !== 'real_gps'
      ? (minDistance !== null && minDistance <= thresholdMeters)
      : canTrigger;
    const inside = isNearby ? closest : null;

    return {
      nearestBranch: closest,
      distanceToNearestMeters: minDistance,
      activeBranchInsideGeofence: inside,
    };
  }, [branches, currentCoordinates.lat, currentCoordinates.lng, thresholdMeters, simulationMode, hasRealGpsFix, currentCoordinates.accuracy, currentCoordinates.measuredAt, now]);

  return {
    currentCoordinates,
    activeBranchInsideGeofence,
    nearestBranch,
    simulationMode,
    setSimulationMode: handleSetSimulationMode,
    distanceToNearestMeters,
    isInsideGeofence: activeBranchInsideGeofence !== null,
    hasRealGpsFix,
    thresholdMeters,
    gpsError,
    gpsPermissionStatus,
    requestGpsPermission,
  };
}
