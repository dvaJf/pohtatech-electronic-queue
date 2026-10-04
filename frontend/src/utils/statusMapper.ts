import type { TicketStatus, TicketSource } from '../api/client/types';

/**
 * Returns authentic Russian label for any ticket status.
 * Never outputs raw English backend enums like 'SCHEDULED' or 'WAITING' to the user.
 */
export function getTicketStatusLabel(status: TicketStatus | string, source?: TicketSource | string): string {
  switch (status) {
    case 'PENDING_CONFIRMATION':
      return 'Ожидает подтверждения';
    case 'SCHEDULED':
      return source === 'APPOINTMENT' ? 'Запись запланирована' : 'Запись подтверждена';
    case 'WAITING':
      return 'В очереди';
    case 'CALLED':
      return 'Вас вызывают к окну';
    case 'SERVING':
      return 'Идёт обслуживание';
    case 'COMPLETED':
      return 'Обслуживание завершено';
    case 'CANCELLED':
      return source === 'APPOINTMENT' ? 'Запись отменена' : 'Талон отменён';
    case 'NO_SHOW':
      return 'Неявка';
    default:
      return 'Статус обновляется';
  }
}

export function getTicketStatusBadgeClass(status: TicketStatus | string): string {
  switch (status) {
    case 'PENDING_CONFIRMATION':
      return 'bg-amber-100 text-amber-900 border-amber-200';
    case 'SCHEDULED':
      return 'bg-sky-100 text-sky-900 border-sky-200';
    case 'WAITING':
      return 'bg-blue-100 text-blue-900 border-blue-200';
    case 'CALLED':
      return 'bg-amber-100 text-amber-900 border-amber-300 animate-pulse';
    case 'SERVING':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300';
    case 'COMPLETED':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'bg-rose-100 text-rose-900 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}
