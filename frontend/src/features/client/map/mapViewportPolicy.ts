export type UserLocationUpdateSource = 'automatic' | 'explicit';

export function decideUserLocationUpdate(hasAutoCentered: boolean, source: UserLocationUpdateSource) {
  return {
    shouldCenter: source === 'explicit' || !hasAutoCentered,
    hasAutoCentered: true,
  };
}
