interface GeolocationLookupError {
  code: number;
  message?: string;
}

export type GeolocationLookup = Pick<Geolocation, 'getCurrentPosition'>;

/** Try a fresh precise fix first, then accept a cached/coarse fix if GPS times out. */
export function getPositionWithFallback(geolocation: GeolocationLookup): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      resolve,
      (error: GeolocationLookupError) => {
        if (error.code === 1) {
          reject(error);
          return;
        }
        geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 60000,
        });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
}
