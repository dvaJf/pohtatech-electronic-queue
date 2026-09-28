import { isReliableArrival } from './arrivalPolicy';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MOSCOW_BRANCHES, BranchLocation } from '../map/branchLocations';
import { getCurrentPositionFast, isUsableGeoPosition } from '../map/geolocation';

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
  requestGpsPermission: (options?: { centerMap?: boolean }) => void;
  locationCenterRequest: number;
  hasReliableGpsFix: boolean;
}

/**
 * React hook that determines client coordinates via real device GPS (navigator.geolocation),
 * calculates distance to postal branches using Haversine formula,
 * detects nearby branches using the configured entry radius,
 * and exposes permission request mechanism when client denied or ignored prompt.
 */
export function useGeofencing(options: UseGeofencingOptions = {}): UseGeofencingResult {
  const {
    branches = MOSCOW_BRANCHES,
    initialMode = 'real_gps',
    thresholdMeters = DEFAULT_GEOFENCE_THRESHOLD_METERS,
  } = options;

  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const modeRef = useRef(initialMode);
  const [simulationMode, setSimulationMode] = useState<GeofenceSimulationMode>(initialMode);
  const [hasRealGpsFix, setHasRealGpsFix] = useState<boolean>(initialMode !== 'real_gps');
  const [gpsPermissionStatus, setGpsPermissionStatus] = useState<GpsPermissionState>('prompt');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const requestInFlightRef = useRef<Promise<GeolocationPosition> | null>(null);
  const watchRef = useRef<{ geolocation: Geolocation; id: number } | null>(null);
  const lifecycleRef = useRef({ active: true, generation: 0 });
  const pendingExplicitRef = useRef(false);
  const newestMeasurementRef = useRef(-1);
  const latestPositionRef = useRef<GeoCoordinates | null>(null);
  const [locationCenterRequest, setLocationCenterRequest] = useState(0);
  const stopTracking = useCallback(() => {
    lifecycleRef.current.generation++;
    requestInFlightRef.current = null;
    if (watchRef.current) {
      watchRef.current.geolocation.clearWatch(watchRef.current.id);
      watchRef.current = null;
    }
  }, []);

  const [currentCoordinates, setCurrentCoordinates] = useState<GeoCoordinates>(() => {
    if (initialMode === 'home_1500m') return GEOFENCE_PRESETS.home_1500m;
    if (initialMode === 'near_101000') return GEOFENCE_PRESETS.near_101000;
    // Moscow city center neutral position away from branch geofences until real GPS arrives
    return { lat: 55.7558, lng: 37.6173 };
  });

  const requestGpsPermission = useCallback((requestOptions: { centerMap?: boolean } = {}) => {
    if (requestOptions.centerMap) setLocationCenterRequest(value => value + 1);
    if (modeRef.current !== 'real_gps') {
      modeRef.current = 'real_gps';
      pendingExplicitRef.current = true;
      setSimulationMode('real_gps');
      setHasRealGpsFix(false);
      return;
    }
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGpsPermissionStatus('unavailable');
      setGpsError('Геолокация не поддерживается вашим браузером');
      return;
    }

    const latest = latestPositionRef.current;
    if (latest && isReliableArrival(0, latest.accuracy, 0, latest.measuredAt ?? 0)) return;
    if (requestInFlightRef.current) return;
    setGpsError(null);
    setGpsPermissionStatus('locating');
    // Starting a tracking session supersedes any pending mount permission query.
    if (!watchRef.current) lifecycleRef.current.generation++;
    const generation = lifecycleRef.current.generation;
    const isActive = () => lifecycleRef.current.active && lifecycleRef.current.generation === generation && modeRef.current === 'real_gps';
    const publishPosition = (pos: GeolocationPosition) => {
      if (!isActive() || !isUsableGeoPosition(pos) || pos.timestamp < newestMeasurementRef.current) return;
      newestMeasurementRef.current = pos.timestamp;
      const coordinates = { lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy, measuredAt: pos.timestamp };
      latestPositionRef.current = coordinates;
      setCurrentCoordinates(coordinates);
      setHasRealGpsFix(true);
      setGpsPermissionStatus('granted');
      setGpsError(null);
    };
    const failPosition = (err: GeolocationPositionError) => {
      if (!isActive()) return;
      stopTracking();
      setHasRealGpsFix(false);
      setGpsPermissionStatus(err.code === 1 ? 'denied' : 'unavailable');
      setGpsError(err.code === 1 ? 'Доступ к геолокации отклонен' : `GPS недоступен (${err.message})`);
    };
    const startWatching = () => {
      if (!isActive() || watchRef.current) return;
      const geolocation = navigator.geolocation;
      const id = geolocation.watchPosition(publishPosition, failPosition, {
        enableHighAccuracy: true, maximumAge: 5000, timeout: 15000,
      });
      watchRef.current = { geolocation, id };
    };
    const request = getCurrentPositionFast(navigator.geolocation);
    requestInFlightRef.current = request;
    request.then(position => {
      publishPosition(position);
      startWatching();
    }).catch(failPosition).finally(() => {
        if (requestInFlightRef.current === request) requestInFlightRef.current = null;
      });
  }, [stopTracking]);

  const handleSetSimulationMode = useCallback((mode: GeofenceSimulationMode) => {
    if (modeRef.current === mode) return;
    stopTracking();
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
      latestPositionRef.current = null;
      setHasRealGpsFix(false);
    }
  }, [stopTracking]);

  useEffect(() => {
    lifecycleRef.current.active = true;
    return () => { lifecycleRef.current.active = false; stopTracking(); };
  }, [stopTracking]);

  // Start one browser-owned location session on mount. The native prompt is
  // intentionally allowed here: a granted permission needs no extra click,
  // and browsers without Permissions API still receive a normal lookup.
  useEffect(() => {
    let active = true;
    if (simulationMode === 'real_gps') {
      if (typeof window !== 'undefined' && navigator.geolocation) {
        if (pendingExplicitRef.current) {
          pendingExplicitRef.current = false;
          requestGpsPermission();
        } else if (navigator.permissions?.query) {
          const generation = lifecycleRef.current.generation;
          const isCurrentQuery = () => active && lifecycleRef.current.active
            && lifecycleRef.current.generation === generation && modeRef.current === 'real_gps';
          navigator.permissions.query({ name: 'geolocation' as PermissionName })
            .then(permission => {
              if (!isCurrentQuery()) return;
              if (watchRef.current) return;
              setGpsPermissionStatus(permission.state === 'denied' ? 'denied' : 'prompt');
              if (permission.state !== 'denied') requestGpsPermission();
            })
            .catch(() => {
              if (!isCurrentQuery()) return;
              setGpsPermissionStatus('prompt');
              requestGpsPermission();
            });
        } else {
          requestGpsPermission();
        }
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
    return () => { active = false; stopTracking(); };
  }, [simulationMode, requestGpsPermission, stopTracking]);

  const hasReliableGpsFix = simulationMode !== 'real_gps' || (hasRealGpsFix
    && isReliableArrival(0, currentCoordinates.accuracy, 0, currentCoordinates.measuredAt ?? 0, now));

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
    const canTrigger = hasReliableGpsFix && minDistance !== null && minDistance <= thresholdMeters;
    const isNearby = simulationMode !== 'real_gps'
      ? (minDistance !== null && minDistance <= thresholdMeters)
      : canTrigger;
    const inside = isNearby ? closest : null;

    return {
      nearestBranch: closest,
      distanceToNearestMeters: minDistance,
      activeBranchInsideGeofence: inside,
    };
  }, [branches, currentCoordinates.lat, currentCoordinates.lng, thresholdMeters, simulationMode, hasReliableGpsFix]);

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
    locationCenterRequest,
    hasReliableGpsFix,
  };
}
