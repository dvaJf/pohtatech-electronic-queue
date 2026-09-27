export type UserLocationUpdateSource = 'automatic' | 'explicit';

export function decideUserLocationUpdate(hasAutoCentered: boolean, source: UserLocationUpdateSource) {
  return {
    shouldCenter: source === 'explicit' || !hasAutoCentered,
    hasAutoCentered: true,
  };
}

export function decideLocationCenterRequest(consumedSequence: number, requestedSequence: number, hasCoordinates: boolean) {
  const shouldCenter = hasCoordinates && requestedSequence !== consumedSequence;
  return { shouldCenter, consumedSequence: shouldCenter ? requestedSequence : consumedSequence };
}
