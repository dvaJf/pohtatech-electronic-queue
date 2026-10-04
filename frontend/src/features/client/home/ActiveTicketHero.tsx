import { CheckCircle2, Clock, Loader2, MapPin, Navigation, Ticket as TicketIcon, Users } from 'lucide-react';
import Timeline8 from '@/components/ui/c-timeline-8';
import type { Branch, QueuePosition, Ticket, TicketETA } from '../../../api/client/types';
import { getActiveTicketPresentation } from './activeTicketPresentation';

function getTicketTimelineStep(status: string, isArrived = false): number {
  if (isArrived && status === 'SCHEDULED') {
    return 2;
  }
  switch (status) {
    case 'SCHEDULED':
    case 'WAITING':
      return 1;
    case 'CALLED':
    case 'SERVING':
      return 2;
    case 'COMPLETED':
      return 3;
    default:
      return 1;
  }
}

export function ActiveTicketHero({
  ticket,
  isArrived = false,
  position,
  eta,
  branch,
  onOpenTicket,
  onOpenRoute,
}: {
  ticket: Ticket;
  isArrived?: boolean;
  position?: QueuePosition;
  eta?: TicketETA;
  branch?: Branch;
  onOpenTicket: () => void;
  onOpenRoute: () => void;
}) {
  const peopleAhead = position?.position ?? eta?.position ?? null;
  const isCalledOrServing = ticket.status === 'CALLED' || ticket.status === 'SERVING' || ticket.status === 'COMPLETED';
  const windowNumber = isCalledOrServing ? (ticket.window?.number ?? null) : null;
  const view = getActiveTicketPresentation({
    status: ticket.status,
    peopleAhead: peopleAhead === null ? null : Math.max(0, peopleAhead - 1),
    estimatedWaitSeconds: eta?.estimatedWaitSeconds,
    windowNumber,
  });

  return (
    <section aria-label="Активный талон" className={`rounded-2xl border p-4 shadow-xs sm:p-5 ${ticket.status === 'CALLED' ? 'border-[#054FA6] bg-blue-50/80' : 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 via-teal-50/40 to-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider ${ticket.status === 'CALLED' ? 'border-blue-200 bg-blue-100 text-[#031E56]' : 'border-emerald-200 bg-emerald-100 text-emerald-800'}`}>
            <CheckCircle2 size={11} aria-hidden />
            {view.eyebrow}
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <p className="mb-0 text-sm font-bold leading-none text-slate-600">Талон</p>
            <h2 className="whitespace-nowrap text-2xl font-black leading-none text-[#031E56] sm:text-3xl">{ticket.publicNumber}</h2>
          </div>
          <p className="mt-1 text-sm font-bold text-slate-700" aria-live={view.announce ? 'polite' : undefined}>{view.status}</p>
          {ticket.status === 'SERVING' && windowNumber && <p className="mt-1 text-xs font-semibold text-slate-600">Окно №{windowNumber}</p>}
        </div>
        {view.eta && <div className="shrink-0 rounded-2xl border border-emerald-200/80 bg-white/90 px-3 py-2 text-right shadow-2xs">
          <div className="text-2xl font-black leading-none tabular-nums text-[#031E56] sm:text-3xl">{view.eta}</div>
          {view.etaCaption && <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{view.etaCaption}</div>}
        </div>}
      </div>

      {/* Анимированный таймлайн со статусами талона */}
      <div className="mt-3 pt-3 border-t border-slate-200/60 w-full overflow-x-auto">
        <Timeline8
          currentStep={getTicketTimelineStep(ticket.status, isArrived)}
          status={ticket.status}
          items={[
            { id: 1, title: 'Выдан', description: peopleAhead !== null && peopleAhead > 0 ? `${peopleAhead} в очереди` : 'Талон выдан' },
            { id: 2, title: 'Приглашение к окну', description: isCalledOrServing && windowNumber ? `Окно №${windowNumber}` : (isArrived && ticket.status === 'SCHEDULED' ? 'Ожидание вызова' : 'Приглашение') },
            { id: 3, title: 'Завершён', description: 'Готово' },
          ]}
          className="w-full max-w-full"
        />
      </div>

      {view.peopleAhead && <div className="mt-3 flex min-h-[52px] items-center gap-2 rounded-xl border border-emerald-100/80 bg-white/70 px-3 text-sm font-bold text-slate-800"><Users size={17} className="text-emerald-700" aria-hidden />{view.peopleAhead}</div>}

      <div className="mt-3 flex min-w-0 gap-2 text-xs text-slate-600">
        <MapPin size={16} className="mt-0.5 shrink-0 text-[#054FA6]" aria-hidden />
        <div className="min-w-0"><p className="font-bold text-slate-800 line-clamp-2">{branch?.name || 'Почта России'}</p>{branch?.address && <p className="mt-0.5 line-clamp-2">{branch.address}</p>}</div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onOpenTicket} className="min-h-[44px] flex-1 rounded-xl bg-[#003B73] px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#002D5A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#054FA6]"><TicketIcon size={16} className="mr-2 inline" aria-hidden />Открыть талон</button>
        <button type="button" onClick={onOpenRoute} className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#054FA6]"><Navigation size={16} className="mr-1.5 inline text-slate-500" aria-hidden />Маршрут</button>
      </div>
    </section>
  );
}

export function HomeHeroSkeleton() {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Обновляем данные для главной карточки"
      className="min-h-[230px] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_14px_rgb(13_37_61_/_5%)] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#003B73]">
          <Loader2 size={20} className="animate-spin" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#003B73]">Умный маршрут</p>
          <h2 className="mt-1 text-base font-semibold text-slate-950">Подбираем лучшее отделение…</h2>
          <p className="mt-1 text-sm text-slate-600">Проверяем ваши талоны, дорогу и актуальную очередь.</p>
        </div>
      </div>
      <div className="mt-7 grid grid-cols-3 gap-3" aria-hidden="true">
        {[0, 1, 2].map(item => (
          <div key={item} className="space-y-2 text-center">
            <div className="mx-auto h-7 w-16 animate-pulse rounded-md bg-slate-200" />
            <div className="mx-auto h-3 w-12 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </section>
  );
}
