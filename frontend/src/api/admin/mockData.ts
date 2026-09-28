import { AdminBranchOverview, QueuePolicy } from './types';

export const DEMO_QUEUE_POLICY: QueuePolicy = {
  branchId: '11111111-1111-1111-1111-111111111111',
  appointmentDuePriority: 100,
  qrPriority: 10,
  livePriority: 10,
  antiStarvationThresholdMinutes: 15,
  antiStarvationPointsPerMinute: 10,
  appointmentGraceMinutes: 15,
  appointmentLatePenaltyPerMinute: 5,
  appointmentLatePenaltyMaxPoints: 90,
  version: 1,
  updatedAt: '2026-09-16T20:00:00Z',
};

let mockPolicyState: QueuePolicy = { ...DEMO_QUEUE_POLICY };

export function getMockQueuePolicy(): QueuePolicy {
  return { ...mockPolicyState };
}

export function updateMockQueuePolicy(
  appointmentDuePriority: number,
  qrPriority: number,
  expectedVersion: number
): QueuePolicy {
  if (expectedVersion !== mockPolicyState.version) {
    throw new Error('POLICY_VERSION_CONFLICT');
  }
  mockPolicyState = {
    ...mockPolicyState,
    appointmentDuePriority,
    qrPriority,
    version: mockPolicyState.version + 1,
    updatedAt: new Date().toISOString(),
  };
  return { ...mockPolicyState };
}

export const DEMO_ADMIN_OVERVIEW: AdminBranchOverview = {
  branchId: '11111111-1111-1111-1111-111111111111',
  branchName: 'Демо-отделение №1 (ул. Ленина, д. 10)',
  quality: { ratingAverage: null, ratingCount: 0, current30Average: null, current30Count: 0, previous30Average: null, previous30Count: 0, delta: null, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }, lowRatingCount: 0, recentFeedback: [] },
  metrics: {
    waitingClientsCount: 5,
    avgWaitTimeMinutes: 6.5,
    maxWaitTimeMinutes: 14.0,
    servedTodayCount: 78,
    activeWindowsCount: 3,
    totalWindowsCount: 4,
  },
  windows: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      number: 1,
      status: 'OPEN',
      currentTicketNumber: 'Q-000012',
      currentService: 'Посылки',
      servedCount: 28,
      operatorName: 'Иванова Анна',
      services: [
        { id: '22222222-2222-2222-2222-222222222222', code: 'PARCELS', name: 'Посылки' },
      ],
    },
    {
      id: '44444444-4444-4444-4444-444444444444',
      number: 2,
      status: 'OPEN',
      currentTicketNumber: 'П-000004',
      currentService: 'Платежи',
      servedCount: 22,
      operatorName: 'Смирнов Дмитрий',
      services: [
        { id: '55555555-5555-5555-5555-555555555555', code: 'PAYMENTS', name: 'Платежи' },
      ],
    },
    {
      id: '66666666-6666-6666-6666-666666666666',
      number: 3,
      status: 'OPEN',
      currentTicketNumber: null,
      currentService: null,
      servedCount: 28,
      operatorName: 'Ковалев Михаил',
      services: [
        { id: '22222222-2222-2222-2222-222222222222', code: 'PARCELS', name: 'Посылки' },
      ],
    },
    {
      id: '77777777-7777-7777-7777-777777777777',
      number: 4,
      status: 'CLOSED',
      currentTicketNumber: null,
      currentService: null,
      servedCount: 0,
      operatorName: 'Резервное окно',
      services: [
        { id: '22222222-2222-2222-2222-222222222222', code: 'PARCELS', name: 'Посылки' },
        { id: '55555555-5555-5555-5555-555555555555', code: 'PAYMENTS', name: 'Платежи' },
      ],
    },
  ],
  queue: [
    {
      id: 't-01',
      publicNumber: 'Q-000013',
      source: 'QR',
      serviceName: 'Посылки',
      queueEnteredAt: '17:35:10',
      waitTimeMinutes: 12,
      status: 'WAITING',
    },
    {
      id: 't-02',
      publicNumber: 'А-000005',
      source: 'APPOINTMENT',
      serviceName: 'Посылки',
      queueEnteredAt: '17:38:00',
      waitTimeMinutes: 9,
      status: 'WAITING',
    },
    {
      id: 't-03',
      publicNumber: 'Q-000014',
      source: 'QR',
      serviceName: 'Платежи',
      queueEnteredAt: '17:40:20',
      waitTimeMinutes: 7,
      status: 'WAITING',
    },
    {
      id: 't-04',
      publicNumber: 'Ж-000002',
      source: 'LIVE',
      serviceName: 'Платежи',
      queueEnteredAt: '17:42:00',
      waitTimeMinutes: 5,
      status: 'WAITING',
    },
    {
      id: 't-05',
      publicNumber: 'Q-000015',
      source: 'QR',
      serviceName: 'Посылки',
      queueEnteredAt: '17:45:10',
      waitTimeMinutes: 2,
      status: 'WAITING',
    },
  ],
  priorities: [
    {
      source: 'APPOINTMENT',
      name: 'Предварительная запись',
      weight: 1.5,
      maxWaitLimitMinutes: 10,
      description: 'Клиенты, записавшиеся ко времени. Приоритет активируется в назначенное время.',
    },
    {
      source: 'QR',
      name: 'Электронный талон (QR-код)',
      weight: 1.0,
      maxWaitLimitMinutes: 15,
      description: 'Основной поток клиентов отделения через цифровой вход.',
    },
    {
      source: 'LIVE',
      name: 'Живая очередь (добавлена оператором)',
      weight: 0.8,
      maxWaitLimitMinutes: 20,
      description: 'Клиенты без смартфона, добавленные сотрудником на месте.',
    },
  ],
  anomalies: [
    {
      id: 'an-01',
      publicNumber: 'Q-000009',
      type: 'EXCEEDED_WAIT',
      description: 'Превышено максимальное время ожидания (> 15 мин)',
      time: '17:20:00',
      durationMinutes: 18,
    },
    {
      id: 'an-02',
      publicNumber: 'Q-000007',
      type: 'NO_SHOW',
      description: 'Клиент не подошел к Окну №2 после 3 вызовов',
      time: '17:05:40',
      durationMinutes: 4,
    },
    {
      id: 'an-03',
      publicNumber: 'Q-000003',
      type: 'UNFINISHED',
      description: 'Обслуживание прервано из-за сбоя терминала оплаты',
      time: '16:42:15',
      durationMinutes: 11,
    },
  ],
};
