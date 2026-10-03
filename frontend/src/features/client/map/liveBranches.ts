import type { Branch, Service } from '../../../api/client/types';
import { calculateSmartRouting, isUsableDurationMinutes, MAX_QUEUE_WAIT_MINUTES, MOSCOW_BRANCHES, type BranchLocation } from './branchLocations';
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

export const DEFAULT_POST_OFFICE_ID = '11111111-1111-1111-1111-111111111111';

export function getUserDefaultBranchId(userId?: string | null): string {
  if (typeof localStorage === 'undefined') return DEFAULT_POST_OFFICE_ID;
  return (
    (userId ? localStorage.getItem(`user_default_branch_id:${userId}`) : null) ||
    localStorage.getItem('user_default_branch_id') ||
    localStorage.getItem('client_selected_branch_id') ||
    DEFAULT_POST_OFFICE_ID
  );
}

/**
 * Resolves the single, unambiguous default branch ID from a list of branches.
 * Guarantees invariant: at most ONE branch can be marked as default.
 */
export function resolveSingleDefaultBranchId<T extends { id: string; address?: string; name?: string; code?: string }>(
  branches: T[],
  defaultBranchId: string | null | undefined
): string | null {
  if (!branches || branches.length === 0 || !defaultBranchId) return null;

  // 1. Direct ID match first
  const exact = branches.find(b => b.id === defaultBranchId);
  if (exact) return exact.id;

  // 2. Canonical default aliases (Kazan Glavpochtamt / legacy demo id)
  if (defaultBranchId === DEFAULT_POST_OFFICE_ID || defaultBranchId === 'c1a06492-4d5b-6923-0d2b-3906a43b0001') {
    const alias = branches.find(b => b.id === 'c1a06492-4d5b-6923-0d2b-3906a43b0001' || b.id === DEFAULT_POST_OFFICE_ID);
    if (alias) return alias.id;
  }

  // 3. Strict match via matchesUserDefaultBranch (taking first match only)
  const matched = branches.find(b => matchesUserDefaultBranch(b, defaultBranchId));
  return matched ? matched.id : null;
}

/**
 * Universal matcher for user's default branch.
 * Seamlessly resolves matches between backend UUIDs and static catalog IDs by ID, address, and name.
 */
export function matchesUserDefaultBranch(
  branch: { id: string; address?: string; name?: string; loc?: { code?: string }; code?: string; postalCode?: string; index?: string } | null | undefined,
  defaultBranchId: string | null | undefined
): boolean {
  if (!branch || !defaultBranchId) return false;
  if (branch.id === defaultBranchId) return true;
  if ((branch.id === 'c1a06492-4d5b-6923-0d2b-3906a43b0001' && defaultBranchId === DEFAULT_POST_OFFICE_ID) ||
      (branch.id === DEFAULT_POST_OFFICE_ID && defaultBranchId === 'c1a06492-4d5b-6923-0d2b-3906a43b0001')) {
    return true;
  }
  const branchCode = branch.code || branch.postalCode || branch.index || branch.loc?.code;
  if (branchCode && branchCode === defaultBranchId) return true;

  const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[.,\s]+/g, ' ').trim();

  // Если defaultBranchId сохранён как статический ID из MOSCOW_BRANCHES или индекс
  const staticBranch = MOSCOW_BRANCHES.find(m => m.id === defaultBranchId || m.code === defaultBranchId);
  if (staticBranch) {
    if (staticBranch.id === branch.id) return true;
    if (branch.address && normalize(branch.address) === normalize(staticBranch.address)) return true;
    const cleanBranchName = (branch.name || '').replace(/^Демо\s*•\s*/, '').replace(/^Отделение\s*/, '').trim().toLowerCase();
    const cleanStaticName = staticBranch.name.replace(/^Отделение\s*/, '').trim().toLowerCase();
    if (cleanBranchName && cleanStaticName && (cleanBranchName.includes(cleanStaticName) || cleanStaticName.includes(cleanBranchName))) return true;
    if (staticBranch.code && branchCode === staticBranch.code) return true;
  }

  // Если defaultBranchId сохранён как серверный ID, сопоставляем через адрес
  const branchLoc = matchBranchLocation(branch as any, MOSCOW_BRANCHES);
  if (branchLoc && (branchLoc.id === defaultBranchId || branchLoc.code === defaultBranchId)) return true;

  return false;
}

