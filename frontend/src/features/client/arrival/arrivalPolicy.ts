import type { Service, Ticket } from '../../../api/client/types';

export interface NearbyVisitState {
  visits: Record<string, { dismissed: boolean }>;
  activeBranchId: string | null;
}

/** Never offer a second ticket until the current owner's ticket state is authoritative. */
export function canShowNearbyBranchCard(ticketsLoading: boolean, hasActiveTicket: boolean): boolean {
  return !ticketsLoading && !hasActiveTicket;
}

/** A dismissal belongs to one branch visit and expires only after a measured exit. */
export function updateNearbyVisits(
  previous: NearbyVisitState,
  distances: { id: string; distanceMeters: number }[],
  reliable = true,
): NearbyVisitState {
  if (!reliable) return { ...previous, activeBranchId: null };
  const visits = { ...previous.visits };
  const valid = distances.filter(branch => Number.isFinite(branch.distanceMeters) && branch.distanceMeters >= 0);
  for (const id of Object.keys(visits)) {
    const branch = valid.find(branch => branch.id === id);
    if (!branch || branch.distanceMeters > 120) delete visits[id];
  }
  for (const branch of valid) {
    if (branch.distanceMeters <= 75 && !visits[branch.id]) visits[branch.id] = { dismissed: false };
  }
  const candidate = valid.filter(branch => visits[branch.id] && !visits[branch.id].dismissed)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  return { visits, activeBranchId: candidate?.id ?? null };
}

export function dismissNearbyVisit(previous: NearbyVisitState, branchId: string): NearbyVisitState {
  return {
    visits: { ...previous.visits, [branchId]: { dismissed: true } },
    activeBranchId: previous.activeBranchId === branchId ? null : previous.activeBranchId,
  };
}

export function isReliableArrival(distance: number, accuracy: number | undefined, threshold: number, measuredAt: number, now = Date.now()): boolean {
  // ArrivalSheet only offers an action; it never issues a ticket automatically.
  // Treat the GPS uncertainty circle intersecting the branch radius as a prompt-worthy arrival.
  return Number.isFinite(distance) && distance >= 0 && typeof accuracy === 'number'
    && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100
    && distance <= threshold + accuracy
    && now >= measuredAt - 5000 && now - measuredAt <= 60000;
}

export function createArrivalIssuer(deps: {
  listServices: (branchId: string) => Promise<Service[]>;
  createQrTicket: (branchId: string, serviceId: string, key: string) => Promise<Ticket>;
  keyFor: (identity: string) => string;
  clearKey: (identity: string) => void;
}) {
  let busy = false;
  return async (branchId: string, serviceId: string, owner: string): Promise<Ticket | undefined> => {
    if (busy) return;
    busy = true;
    try {
      const services = await deps.listServices(branchId);
      if (!services.some(service => service.id === serviceId)) {
        throw new Error('Выбранная услуга недоступна в этом отделении. Выберите другую услугу.');
      }
      const identity = `arrival:${owner}:${branchId}:${serviceId}`;
      const ticket = await deps.createQrTicket(branchId, serviceId, deps.keyFor(identity));
      deps.clearKey(identity);
      return ticket;
    } finally { busy = false; }
  };
}
