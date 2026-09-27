import type { Branch, Service } from '../../../api/client/types';
import { calculateSmartRouting, isUsableDurationMinutes, MAX_QUEUE_WAIT_MINUTES, type BranchLocation } from './branchLocations';
import type { BranchWorkload } from '../../../api/client/clientApi';

// IDs in demo databases can refer to a different address. Never locate by ID alone.
export function matchBranchLocation(branch: Branch, catalog: BranchLocation[]): BranchLocation | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[.,\s]+/g, ' ').trim();
  if (!branch.address) return undefined;
  const reference = catalog.find(location => normalize(location.address) === normalize(branch.address!));
  if (typeof branch.latitude === 'number' && Number.isFinite(branch.latitude) && Math.abs(branch.latitude) <= 90
      && typeof branch.longitude === 'number' && Number.isFinite(branch.longitude) && Math.abs(branch.longitude) <= 180) {
    return { code: '', metro: '', metroColor: '', rating: 0, reviewCount: 0,
      services: [], activeQueueCount: 0, activeWindows: 0, amenities: [], photos: [], walkingMinutes: 0, distanceKm: 0,
      ...reference, ...branch, id: branch.id, address: branch.address, workHours: branch.workHours || '',
      lat: branch.latitude, lng: branch.longitude };
  }
  return reference;
}

export function liveWaitMinutes(workload: BranchWorkload | undefined, now = Date.now()): number | undefined {
  if (!workload || !workload.calculatedAt || typeof workload.activeWindows !== 'number'
      || !Number.isFinite(workload.activeWindows) || workload.activeWindows <= 0) return undefined;
  const age = now - Date.parse(workload.calculatedAt);
  const seconds = workload.estimatedWaitSeconds;
  if (!Number.isFinite(age) || age < -5000 || age > 60000 || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return undefined;
  const minutes = Math.ceil(seconds / 60);
  return isUsableDurationMinutes(minutes, MAX_QUEUE_WAIT_MINUTES) ? minutes : undefined;
}

export function calculatePersonalRouting(
  coordinates: { lat: number; lng: number },
  branches: BranchLocation[],
  hasReliableGpsFix: boolean,
  simulationMode: string,
) {
  if (!hasReliableGpsFix || simulationMode !== 'real_gps') return { rankedBranches: [] };
  return calculateSmartRouting(coordinates.lat, coordinates.lng, branches);
}

/** The public services endpoint returns the services enabled for that branch. */
export function recommendationActions(branchId: string, confirmedServices: Record<string, Service[] | null>) {
  const actions: ('ticket' | 'route' | 'appointment')[] = ['ticket', 'route'];
  if (confirmedServices[branchId]?.length) actions.push('appointment');
  return actions;
}
