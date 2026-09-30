import type { TicketStatus } from '../../../api/client/types';

const ACTIVE_TICKET_STATUSES = new Set<TicketStatus>(['SCHEDULED', 'WAITING', 'CALLED', 'SERVING']);

export type ActiveTicketPresentation = {
  eyebrow: string;
  status: string;
  peopleAhead: string | null;
  eta: string | null;
  etaCaption: string | null;
  announce: boolean;
};

export function isActiveTicketStatus(status: TicketStatus): boolean {
  return ACTIVE_TICKET_STATUSES.has(status);
}

function formatPeopleAhead(value: number | null | undefined): string {
  if (!value || value <= 0) return 'Вы следующий';
  return `Перед вами ${value} ${value >= 2 && value <= 4 ? 'человека' : 'человек'}`;
}

function formatEta(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  return `≈${Math.max(1, Math.ceil(seconds / 60))} мин`;
}

export function getActiveTicketPresentation({
  status,
  peopleAhead,
  estimatedWaitSeconds,
  windowNumber,
}: {
  status: TicketStatus;
  peopleAhead?: number | null;
  estimatedWaitSeconds?: number | null;
  windowNumber?: number | null;
}): ActiveTicketPresentation {
  if (status === 'CALLED') {
    return {
      eyebrow: 'Ваша очередь',
      status: windowNumber ? `Подойдите к окну №${windowNumber}` : 'Подойдите к окну',
      peopleAhead: null,
      eta: 'Сейчас',
      etaCaption: null,
      announce: true,
    };
  }
  if (status === 'SERVING') {
    return {
      eyebrow: 'Активный талон',
      status: 'Вас обслуживают',
      peopleAhead: null,
      eta: null,
      etaCaption: null,
      announce: false,
    };
  }
  return {
    eyebrow: 'Активный талон',
    status: status === 'SCHEDULED' ? 'Запись подтверждена' : 'Ожидайте вызова',
    peopleAhead: formatPeopleAhead(peopleAhead),
    eta: formatEta(estimatedWaitSeconds),
    etaCaption: 'до вашей очереди',
    announce: false,
  };
}
