import type { Service, Ticket } from '../../../api/client/types';

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
