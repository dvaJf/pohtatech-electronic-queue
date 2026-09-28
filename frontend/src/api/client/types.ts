export type Branch = {
  latitude?: number;
  longitude?: number;
  isDemo?: boolean;
  id: string;
  name: string;
  address?: string;
  workHours?: string;
};

export type BranchListResponse = {
  items: Branch[];
};

export type Service = {
  id: string;
  code: string;
  name: string;
};

export type ServiceListResponse = {
  items: Service[];
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
  source: TicketSource;
  status: TicketStatus;
  window: TicketWindow | null;
  createdAt: string;
  queueEnteredAt: string;
  calledAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  arrivedAt?: string | null;
  managementToken?: string | null;
  operatorName?: string | null;
};

export type Appointment = {
  ticket: Ticket;
  scheduledAt: string;
  managementToken?: string | null;
};

export type NotificationChannel = 'TELEGRAM' | 'WEB_PUSH' | 'SMS' | 'EMAIL';
export type NotificationSubscription = { id: string; ticketId: string; channel: NotificationChannel; destination?: string; enabled: boolean };
export type NotificationCapabilities = Record<'telegram' | 'webPush' | 'sms' | 'email', { enabled: boolean; mode: 'real' | 'demo' | 'smtp'; vapidPublicKey?: string }>;

export type QueuePositionReason = 'AVAILABLE' | 'NOT_ELIGIBLE_YET' | 'NO_OPEN_COMPATIBLE_WINDOW' | 'NOT_QUEUED';
export type QueuePosition = {
  ticketId: string;
  ticketStatus: TicketStatus;
  reason: QueuePositionReason;
  position: number | null;
  referenceWindow: TicketWindow | null;
  calculatedAt: string;
  effectivePriority: number | null;
  effectiveQueueTime: string | null;
};

export type CreateAppointmentRequest = {
  serviceId: string;
  scheduledAt: string;
};

export type TicketETA = {
  ticketId: string;
  ticketStatus: TicketStatus;
  reason: QueuePositionReason;
  estimatedWaitSeconds: number | null;
  estimatedCallAt: string | null;
  position: number | null;
  referenceWindow: TicketWindow | null;
  sampleSize: number;
  usedFallback: boolean;
  weightedWaitSeconds?: number;
  medianSeconds?: number;
  p90WaitSeconds?: number;
  distribution?: {
    avg: number;
    weightedAvg: number;
    median: number;
    p90: number;
    samples?: number[];
  };
  calculatedAt: string;
};
