import type { ReactNode } from 'react';
import type { Branch, QueuePosition, Ticket, TicketETA } from '../../../api/client/types';
import { ActiveTicketHero, HomeHeroSkeleton } from './ActiveTicketHero';
import { isActiveTicketStatus } from './activeTicketPresentation';

export function HomeHero({
  ticketsLoading,
  error,
  activeTicket,
  position,
  eta,
  branch,
  onRetry,
  onOpenTicket,
  onOpenRoute,
  smartRoute,
}: {
  ticketsLoading: boolean;
  error: string | null;
  activeTicket: Ticket | null;
  position?: QueuePosition;
  eta?: TicketETA;
  branch?: Branch;
  onRetry: () => void;
  onOpenTicket: () => void;
  onOpenRoute: () => void;
  smartRoute: ReactNode;
}) {
  if (ticketsLoading) return <HomeHeroSkeleton />;
  if (error && !activeTicket) {
    return <section role="alert" className="rounded-2xl border border-red-200 bg-red-50/80 p-4 shadow-xs"><p className="text-sm font-bold text-red-900">Не удалось проверить активный талон</p><p className="mt-1 text-xs text-red-700">Повторите проверку, чтобы не пропустить вызов.</p><button type="button" onClick={onRetry} className="mt-3 min-h-[44px] rounded-xl border border-red-200 bg-white px-4 text-sm font-bold text-red-800 hover:bg-red-100">Повторить</button></section>;
  }
  if (activeTicket && isActiveTicketStatus(activeTicket.status)) return <ActiveTicketHero ticket={activeTicket} position={position} eta={eta} branch={branch} onOpenTicket={onOpenTicket} onOpenRoute={onOpenRoute} />;
  return <>{smartRoute}</>;
}
