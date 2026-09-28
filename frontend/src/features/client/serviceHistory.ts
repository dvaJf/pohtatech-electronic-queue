export interface ClientServiceRecord {
  id: string;
  publicNumber: string;
  serviceName: string;
  branchName: string;
  windowText: string;
  operatorName: string;
  date: string;
  timeRange: string;
  duration: string;
  completedAt: string;
}

export const STORAGE_SERVICE_HISTORY_KEY = 'client_service_history';

// Моковая история полностью удалена по требованию пользователя
export const DEFAULT_CLIENT_HISTORY: ClientServiceRecord[] = [];

// Моковые номера талонов, подлежащие очистке из хранилища
const MOCK_PUBLIC_NUMBERS = new Set(['Q-001454', 'Q-000892', 'Q-000341']);

export function getClientServiceHistory(scope: string): ClientServiceRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const key = `${STORAGE_SERVICE_HISTORY_KEY}:${scope}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Очищаем старые тестовые моковые записи, если они были сохранены ранее
        const cleaned = parsed.filter(
          (item: any) =>
            item &&
            typeof item.id === 'string' &&
            !item.id.startsWith('demo-hist-') &&
            !MOCK_PUBLIC_NUMBERS.has(item.publicNumber)
        );
        if (cleaned.length !== parsed.length) {
          try {
            localStorage.setItem(key, JSON.stringify(cleaned));
          } catch {}
        }
        // Сортировка: новые визиты всегда сверху (по убыванию даты completedAt)
        return cleaned.sort(
          (a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime()
        );
      }
    }
  } catch {}
  return [];
}

export function saveClientServiceRecord(scope: string, record: ClientServiceRecord) {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = `${STORAGE_SERVICE_HISTORY_KEY}:${scope}`;
    const existing = getClientServiceHistory(scope);
    // Новые визиты помещаются строго в начало массива (сверху прошлых)
    const updated = [record, ...existing.filter(r => r.id !== record.id)]
      .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime())
      .slice(0, 50);
    localStorage.setItem(key, JSON.stringify(updated));
  } catch {}
}

export function recordTicketOperator(
  ticketId: string,
  operatorName: string,
  windowNumber?: number,
  branchId?: string,
  windowId?: string
) {
  if (typeof localStorage === 'undefined') return;
  const trimmed = operatorName?.trim();
  if (!trimmed) return;
  try {
    if (ticketId) {
      localStorage.setItem(`ticket_operator_name:${ticketId}`, trimmed);
    }
    if (windowId) {
      localStorage.setItem(`window_operator_name:${windowId}`, trimmed);
    }
    if (branchId && windowNumber) {
      localStorage.setItem(`window_num_operator_name:${branchId}:${windowNumber}`, trimmed);
    }
    if (windowNumber) {
      localStorage.setItem(`window_num_operator_name:${windowNumber}`, trimmed);
    }
    localStorage.setItem('operator_fio', trimmed);
  } catch {}
}

export function resolveOperatorName(
  ticket: { id?: string; branchId?: string; window?: { id?: string; number?: number } | null; operatorName?: string | null },
  defaultNames?: Record<number, string>
): string {
  if (ticket.operatorName && ticket.operatorName.trim()) {
    return ticket.operatorName.trim();
  }

  if (typeof localStorage !== 'undefined') {
    // 1. По ID конкретного талона
    if (ticket.id) {
      const fromTicket = localStorage.getItem(`ticket_operator_name:${ticket.id}`);
      if (fromTicket && fromTicket.trim()) {
        return fromTicket.trim();
      }
    }
    // 2. По ID окна
    if (ticket.window?.id) {
      const fromWinId = localStorage.getItem(`window_operator_name:${ticket.window.id}`);
      if (fromWinId && fromWinId.trim()) {
        return fromWinId.trim();
      }
    }
    // 3. По отделению и номеру окна
    if (ticket.branchId && ticket.window?.number) {
      const fromBranchWin = localStorage.getItem(`window_num_operator_name:${ticket.branchId}:${ticket.window.number}`);
      if (fromBranchWin && fromBranchWin.trim()) {
        return fromBranchWin.trim();
      }
    }
    // 4. По номеру окна
    if (ticket.window?.number) {
      const fromWinNum = localStorage.getItem(`window_num_operator_name:${ticket.window.number}`);
      if (fromWinNum && fromWinNum.trim()) {
        return fromWinNum.trim();
      }
    }
    // 5. Имя оператора из профиля
    const opFio = localStorage.getItem('operator_fio');
    if (opFio && opFio.trim()) {
      return opFio.trim();
    }
  }

  const windowNumber = ticket.window?.number;
  if (windowNumber && defaultNames && defaultNames[windowNumber]) {
    return defaultNames[windowNumber];
  }
  if (windowNumber) {
    return `Оператор окна №${windowNumber}`;
  }
  return 'Оператор отделения';
}
