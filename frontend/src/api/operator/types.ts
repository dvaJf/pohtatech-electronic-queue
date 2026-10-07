export type Branch = {
  id: string;
  name: string;
  workHours?: string;
  scheduledWorkHours?: string;
  scheduledEffectiveDate?: string;
};

export type BranchListResponse = {
  items: Branch[];
};

export type WindowStatus = 'CLOSED' | 'OPEN' | 'CLOSING';

export type WindowService = {
  id: string;
  code: string;
  name: string;
};

export type OperatorWindow = {
  id: string;
  number: number;
  status: WindowStatus;
  services: WindowService[];
};

export type WindowListResponse = {
  items: OperatorWindow[];
};

export type TicketStatus =
  | 'SCHEDULED'
  | 'WAITING'
  | 'CALLED'
  | 'SERVING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type TicketSource = 'APPOINTMENT' | 'QR' | 'LIVE';

export type TicketWindow = {
  id: string;
  number: number;
};

export type Ticket = {
  id: string;
  publicNumber: string;
  branchId: string;
  serviceId: string;
  serviceName?: string;
  source: TicketSource;
  status: TicketStatus;
  window: TicketWindow | null;
  createdAt: string;
  queueEnteredAt: string;
  calledAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  arrivedAt?: string | null;
};

export type ApiErrorDetail = {
  code: string;
  message: string;
  requestId?: string;
};

export type ApiErrorResponse = {
  error: ApiErrorDetail;
};

export class OperatorApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'OperatorApiError';
  }
}
