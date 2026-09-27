interface GeolocationLookupError {
  code: number;
  message?: string;
}

export type GeolocationLookup = Pick<Geolocation, 'getCurrentPosition'>;

const inFlightLookups = new WeakMap<object, Promise<GeolocationPosition>>();

/**
 * Resolve a useful location quickly. A cached network/Wi-Fi fix is sufficient
 * for sorting branches and drawing the user marker; arrival validation still
 * checks the accuracy reported by the browser.
 *
 * Consumers share the same in-flight browser request. This prevents the
 * header, geofence hook and map from opening concurrent GPS lookups.
 */
export function getCurrentPositionFast(geolocation: GeolocationLookup): Promise<GeolocationPosition> {
  const key = geolocation as object;
  const activeLookup = inFlightLookups.get(key);
  if (activeLookup) return activeLookup;

  const lookup = new Promise<GeolocationPosition>((resolve, reject) => {
    geolocation.getCurrentPosition(
      resolve,
      (error: GeolocationLookupError) => reject(error),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 },
    );
  });

  inFlightLookups.set(key, lookup);
  void lookup.finally(() => {
    if (inFlightLookups.get(key) === lookup) inFlightLookups.delete(key);
  }).catch(() => {});
  return lookup;
}
