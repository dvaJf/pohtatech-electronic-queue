import {
  Branch,
  BranchListResponse,
  Service,
  ServiceListResponse,
  Ticket,
  Appointment,
  NotificationSubscription,
  NotificationChannel,
  NotificationCapabilities,
} from './types';

export class ClientApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

function getApiBaseUrl(): string {
  let envUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_API_BASE_URL : undefined;

  if (typeof window !== 'undefined' && window.location) {
    const isLocalhostHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (envUrl && typeof envUrl === 'string') {
      const isEnvLocalhost = envUrl.includes('localhost') || envUrl.includes('127.0.0.1');
      if (isEnvLocalhost && !isLocalhostHost) {
        envUrl = undefined;
      }
    }
  }

  if (!envUrl || typeof envUrl !== 'string' || envUrl.trim() === '' || envUrl === '/') {
    return '/api/v1';
  }

  const clean = envUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/api/v1')) {
    return clean;
  }
  if (clean.endsWith('/api')) {
    return `${clean}/v1`;
  }
  return `${clean}/api/v1`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ClientApiError(`Некорректное поле ${field}`);
  return value;
}

function parseBranches(value: unknown): BranchListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new ClientApiError('Некорректный формат списка отделений');
  }
  return {
    items: value.items.map((item) => {
      if (!isRecord(item)) throw new ClientApiError('Некорректное отделение');
      // Older/demo branch payloads omit empty rating fields. Treat them as an
      // unrated branch, while continuing to reject malformed values when sent.
      const ratingAverage = item.ratingAverage === undefined || item.ratingAverage === null
        ? null
        : item.ratingAverage;
      const ratingCount = item.ratingCount === undefined ? 0 : item.ratingCount;
      if (ratingAverage !== null && typeof ratingAverage !== 'number') throw new ClientApiError('Некорректный рейтинг отделения');
      if (typeof ratingCount !== 'number' || ratingCount < 0) throw new ClientApiError('Некорректное число оценок');
      return { latitude: typeof item.latitude === 'number' ? item.latitude : undefined, longitude: typeof item.longitude === 'number' ? item.longitude : undefined, isDemo: item.isDemo === true, id: requireString(item.id, 'id'), name: requireString(item.name, 'name'), address: typeof item.address === 'string' ? item.address : undefined, workHours: typeof item.workHours === 'string' ? item.workHours : undefined, ratingAverage, ratingCount };
    }),
  };
}

function parseServices(value: unknown): ServiceListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new ClientApiError('Некорректный формат списка услуг');
  }
  return {
    items: value.items.map((item) => {
      if (!isRecord(item)) throw new ClientApiError('Некорректная услуга');
      return {
        id: requireString(item.id, 'id'),
        code: requireString(item.code, 'code'),
        name: requireString(item.name, 'name'),
      };
    }),
  };
}

const statuses = new Set(['SCHEDULED', 'WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
const sources = new Set(['APPOINTMENT', 'QR', 'LIVE']);

function parseTicket(value: unknown): Ticket {
  if (!isRecord(value)) throw new ClientApiError('Некорректный формат талона');
  if (!statuses.has(value.status as string) || !sources.has(value.source as string)) {
    throw new ClientApiError('Некорректный статус или источник талона');
  }
  const window = value.window;
  if (window !== null && (!isRecord(window) || typeof window.number !== 'number')) {
    throw new ClientApiError('Некорректное окно талона');
  }
  return {
    id: requireString(value.id, 'id'),
    publicNumber: requireString(value.publicNumber, 'publicNumber'),
    branchId: requireString(value.branchId, 'branchId'),
    serviceId: requireString(value.serviceId, 'serviceId'),
    source: value.source as Ticket['source'],
    status: value.status as Ticket['status'],
    window: window === null ? null : {
      id: requireString(window.id, 'window.id'),
      number: window.number as number,
    },
    createdAt: requireString(value.createdAt, 'createdAt'),
    queueEnteredAt: requireString(value.queueEnteredAt, 'queueEnteredAt'),
    calledAt: value.calledAt === null ? null : requireString(value.calledAt, 'calledAt'),
    serviceStartedAt: value.serviceStartedAt === null ? null : requireString(value.serviceStartedAt, 'serviceStartedAt'),
    completedAt: value.completedAt === null ? null : requireString(value.completedAt, 'completedAt'),
    arrivedAt: typeof value.arrivedAt === 'string' ? value.arrivedAt : undefined,
    managementToken: typeof value.managementToken === 'string' ? value.managementToken : undefined,
  };
}

function parseAppointment(value: unknown): Appointment {
  if (!isRecord(value) || !isRecord(value.ticket)) {
    throw new ClientApiError('Некорректный формат записи');
  }
  const scheduledAt = requireString(value.scheduledAt, 'scheduledAt');
  if (Number.isNaN(Date.parse(scheduledAt))) {
    throw new ClientApiError('Некорректное поле scheduledAt');
  }
  const ticket = parseTicket(value.ticket);
  const mgmtToken = typeof value.managementToken === 'string' ? value.managementToken : ticket.managementToken;
  return { ticket, scheduledAt, managementToken: mgmtToken };
}

async function request<T>(path: string, init?: RequestInit, parser?: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', ...init?.headers },
    });
  } catch {
    throw new ClientApiError('Не удалось связаться с сервером');
  }

  if (!response.ok) {
    let message = `Ошибка сервера (${response.status})`;
    console.error('[client-api] request failed', { path, status: response.status, statusText: response.statusText });
    try {
      const body = await response.json() as { error?: { message?: string; code?: string } };
      message = body.error?.message || (response.status >= 500
        ? 'Сервис временно недоступен. Попробуйте обновить страницу.'
        : message);
      throw new ClientApiError(message, response.status, body.error?.code);
    } catch (error) {
      if (error instanceof ClientApiError) throw error;
      if (response.status >= 500) message = 'Сервис временно недоступен. Попробуйте обновить страницу.';
      throw new ClientApiError(message, response.status);
    }
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json();
  return parser ? parser(body) : body as T;
}

async function requestWithNetworkRetry<T>(path: string, init: RequestInit, parser: (value: unknown) => T): Promise<T> {
  try {
    return await request(path, init, parser);
  } catch (error) {
    if (error instanceof ClientApiError && error.status === undefined) {
      return request(path, init, parser);
    }
    throw error;
  }
}

export async function listBranches(signal?: AbortSignal): Promise<Branch[]> {
  const response = await request('/branches', { signal }, parseBranches);
  return response.items;
}


export async function listServices(branchId: string, signal?: AbortSignal): Promise<Service[]> {
  const response = await request(`/branches/${encodeURIComponent(branchId)}/services`, { signal }, parseServices);
  return response.items;
}


export async function createQrTicket(branchId: string, serviceId: string, idempotencyKey: string, signal?: AbortSignal): Promise<Ticket> {
  return request(`/branches/${encodeURIComponent(branchId)}/tickets/qr`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ serviceId }),
  }, parseTicket);
}


export async function getTicket(ticketId: string, signal?: AbortSignal): Promise<Ticket> {
  return request(`/tickets/${encodeURIComponent(ticketId)}`, { signal }, parseTicket);
}

export async function listMyActiveTickets(signal?: AbortSignal): Promise<Ticket[]> {
  try {
    const data = await request<{ items: unknown[] }>('/client/tickets/active', { signal });
    if (!data || !Array.isArray(data.items)) return [];
    return data.items.map(parseTicket);
  } catch {
    return [];
  }
}

export async function submitFeedback(ticketId: string, rating: number, comment: string, token?: string): Promise<void> {
  await request(`/tickets/${encodeURIComponent(ticketId)}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...managementHeaders(token) }, body: JSON.stringify({ rating, comment }) }, () => undefined);
}

function managementHeaders(token?: string): Record<string, string> { return token ? { 'X-Ticket-Manage-Token': token } : {}; }
export async function telegramLink(ticketId: string, token?: string): Promise<string> {
  const result = await request<{ url: string }>(`/tickets/${encodeURIComponent(ticketId)}/notifications/telegram/link`, { method: 'POST', headers: managementHeaders(token) });
  return result.url;
}
export async function saveNotificationSubscription(ticketId: string, channel: NotificationChannel, destination: string, token?: string): Promise<NotificationSubscription> {
  return request(`/tickets/${encodeURIComponent(ticketId)}/notifications/${channel}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...managementHeaders(token) }, body: JSON.stringify({ destination }) });
}
export async function removeNotificationSubscription(ticketId: string, channel: NotificationChannel, subscriptionId: string, token?: string): Promise<void> {
  await request(`/tickets/${encodeURIComponent(ticketId)}/notifications/${channel}/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE', headers: managementHeaders(token) }, () => undefined);
}
export async function getNotificationCapabilities(): Promise<NotificationCapabilities> { return request('/notification-capabilities'); }
export async function listNotificationSubscriptions(ticketId: string, token?: string): Promise<NotificationSubscription[]> { const data = await request<{ items: NotificationSubscription[] }>(`/tickets/${encodeURIComponent(ticketId)}/notifications`, { headers: managementHeaders(token) }); return Array.isArray(data.items) ? data.items : []; }

export async function createAppointment(
  branchId: string,
  serviceId: string,
  scheduledAt: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Appointment> {
  return requestWithNetworkRetry(`/branches/${encodeURIComponent(branchId)}/tickets/appointment`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ serviceId, scheduledAt }),
  }, parseAppointment);
}

export async function cancelAppointment(ticketId: string, token?: string, signal?: AbortSignal): Promise<Appointment> {
  const headers: Record<string, string> = {};
  if (token) headers['X-Ticket-Manage-Token'] = token;
  return request(`/appointments/${encodeURIComponent(ticketId)}/cancel`, {
    method: 'POST',
    signal,
    headers,
  }, parseAppointment);
}

export async function cancelTicket(ticketId: string, token?: string, signal?: AbortSignal): Promise<Ticket> {
  const headers: Record<string, string> = {};
  if (token) headers['X-Ticket-Manage-Token'] = token;
  return request(`/tickets/${encodeURIComponent(ticketId)}/cancel`, {
    method: 'POST',
    signal,
    headers,
  }, parseTicket);
}

export async function arriveAppointment(ticketId: string, signal?: AbortSignal): Promise<Appointment> {
  return request(`/appointments/${encodeURIComponent(ticketId)}/arrive`, { method: 'POST', signal }, parseAppointment);
}

function parseQueuePosition(value: unknown): import('./types').QueuePosition {
  if (!isRecord(value)) throw new ClientApiError('Некорректный формат позиции очереди');
  const reasons = new Set(['AVAILABLE', 'NOT_ELIGIBLE_YET', 'NO_OPEN_COMPATIBLE_WINDOW', 'NOT_QUEUED']);
  if (!reasons.has(String(value.reason))) throw new ClientApiError('Некорректная причина позиции очереди');
  return {
    ticketId: requireString(value.ticketId, 'ticketId'), ticketStatus: value.ticketStatus as import('./types').TicketStatus,
    reason: value.reason as import('./types').QueuePositionReason,
    position: typeof value.position === 'number' ? value.position : null,
    referenceWindow: isRecord(value.referenceWindow) ? { id: requireString(value.referenceWindow.id, 'referenceWindow.id'), number: value.referenceWindow.number as number } : null,
    calculatedAt: requireString(value.calculatedAt, 'calculatedAt'),
    effectivePriority: typeof value.effectivePriority === 'number' ? value.effectivePriority : null,
    effectiveQueueTime: value.effectiveQueueTime === null ? null : requireString(value.effectiveQueueTime, 'effectiveQueueTime'),
  };
}

export async function getQueuePosition(ticketId: string, signal?: AbortSignal): Promise<import('./types').QueuePosition> {
  return request(`/tickets/${encodeURIComponent(ticketId)}/position`, { signal }, parseQueuePosition);
}

export async function getTicketETA(ticketId: string, signal?: AbortSignal): Promise<import('./types').TicketETA> {
  return request(`/tickets/${encodeURIComponent(ticketId)}/eta`, { signal }, value => {
    if (!isRecord(value) || value.ticketId !== ticketId || typeof value.sampleSize !== 'number' || typeof value.usedFallback !== 'boolean' || (value.estimatedWaitSeconds !== null && typeof value.estimatedWaitSeconds !== 'number')) throw new ClientApiError('Некорректный ответ оценки ожидания');
    return value as unknown as import('./types').TicketETA;
  });
}

export type HourlyWorkload = {
  hour: number;
  loadPercent: number;
  waitMinutes: number;
  isPeak: boolean;
};

export type BranchWorkload = {
  activeWindows?: number;
  estimatedWaitSeconds?: number | null;
  calculatedAt?: string;
  usedFallback?: boolean;
  branchId: string;
  currentHour: number;
  currentWaiting: number;
  sampleCount: number;
  isHistorical: boolean;
  hourly: HourlyWorkload[];
};

export async function getBranchWorkload(branchId: string, signal?: AbortSignal): Promise<BranchWorkload> {
  return request(`/branches/${encodeURIComponent(branchId)}/workload`, { signal });
}
