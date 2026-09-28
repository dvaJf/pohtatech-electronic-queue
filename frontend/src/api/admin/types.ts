export interface QueuePolicy {
  branchId: string;
  appointmentDuePriority: number;
  qrPriority: number;
  livePriority: number;
  antiStarvationThresholdMinutes: number;
  antiStarvationPointsPerMinute: number;
  appointmentGraceMinutes: number;
  appointmentLatePenaltyPerMinute: number;
  appointmentLatePenaltyMaxPoints: number;
  version: number;
  updatedAt: string;
}

export interface UpdateQueuePolicyRequest {
  appointmentDuePriority: number;
  qrPriority: number;
  livePriority: number;
  antiStarvationThresholdMinutes: number;
  antiStarvationPointsPerMinute: number;
  appointmentGraceMinutes: number;
  appointmentLatePenaltyPerMinute: number;
  appointmentLatePenaltyMaxPoints: number;
  expectedVersion: number;
}

export class AdminApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export interface AdminMetrics {
  waitingClientsCount: number;
  avgWaitTimeMinutes: number;
  maxWaitTimeMinutes: number;
  servedTodayCount: number;
  activeWindowsCount: number;
  totalWindowsCount: number;
  p90WaitMinutes?: number | null;
}

export interface AdminWindowService {
  id: string;
  code: string;
  name: string;
}

export interface AdminWindow {
  id: string;
  number: number;
  status: 'OPEN' | 'CLOSED' | 'CLOSING';
  currentTicketNumber: string | null;
  currentService: string | null;
  services: AdminWindowService[];
  servedCount: number;
  operatorName?: string;
}

export interface AdminQueueTicket {
  id: string;
  publicNumber: string;
  source: 'QR' | 'APPOINTMENT' | 'LIVE';
  serviceName: string;
  queueEnteredAt: string;
  waitTimeMinutes: number;
  status: 'WAITING' | 'CALLED' | 'SERVING';
}

export interface PriorityRule {
  source: 'APPOINTMENT' | 'QR' | 'LIVE';
  name: string;
  weight: number;
  maxWaitLimitMinutes: number;
  description: string;
}

export interface AnomalyTicket {
  id: string;
  publicNumber: string;
  type: 'EXCEEDED_WAIT' | 'UNFINISHED' | 'NO_SHOW' | 'TECH_ISSUE';
  description: string;
  time: string;
  durationMinutes: number;
}

export interface AnomalyPage {
  items: AnomalyTicket[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminBranchOverview {
  branchId: string;
  branchName: string;
  metrics: AdminMetrics;
  windows: AdminWindow[];
  queue: AdminQueueTicket[];
  priorities: PriorityRule[];
  anomalies: AnomalyTicket[];
  quality: {
    ratingAverage: number | null;
    ratingCount: number;
    current30Average: number | null;
    current30Count: number;
    previous30Average: number | null;
    previous30Count: number;
    delta: number | null;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
    lowRatingCount: number;
    recentFeedback: Array<{ rating: number; comment: string; createdAt: string }>;
  };
  windowRecommendation?: {
    recommendedCount: number;
    reason: string;
    severity: 'warning' | 'critical';
    p90WaitMinutes: number;
  } | null;
}
