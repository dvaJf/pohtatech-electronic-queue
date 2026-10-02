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

// Вымышленные случайные имена операторов, подлежащие безусловной замене на реальные профили
export const MOCK_OPERATOR_NAMES = new Set([
  'Иванова Анна',
  'Смирнов Дмитрий',
  'Ковалев Михаил',
  'Кузнецова Ольга',
  'Морозов Алексей',
  'Соколова Екатерина',
  'Попов Андрей',
  'Васильева Елена',
  'Новиков Сергей',
  'Федорова Мария',
]);

function extractWindowNumber(windowText?: string): number | undefined {
  if (!windowText) return undefined;
  const match = windowText.match(/\d+/);
  return match ? parseInt(match[0], 10) : undefined;
}

export function getClientServiceHistory(scope: string): ClientServiceRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const key = `${STORAGE_SERVICE_HISTORY_KEY}:${scope}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        let changed = false;
        // Очищаем старые тестовые моковые записи и заменяем вымышленные имена операторов
        const cleaned = parsed
          .filter(
            (item: any) =>
              item &&
              typeof item.id === 'string' &&
              !item.id.startsWith('demo-hist-') &&
              !MOCK_PUBLIC_NUMBERS.has(item.publicNumber)
          )
          .map((item: ClientServiceRecord) => {
            if (!item.operatorName || MOCK_OPERATOR_NAMES.has(item.operatorName.trim())) {
              const winNum = extractWindowNumber(item.windowText);
              const realName = resolveOperatorName({
                id: item.id,
                window: winNum ? { number: winNum } : undefined,
              });
              if (realName !== item.operatorName) {
                item.operatorName = realName;
                changed = true;
              }
            }
            return item;
          });

        if (changed || cleaned.length !== parsed.length) {
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
  if (!trimmed || MOCK_OPERATOR_NAMES.has(trimmed)) return;
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

    // Синхронизируем имя оператора в сохранённых историях клиентов для этого талона или окна
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_SERVICE_HISTORY_KEY)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            let changed = false;
            const updated = list.map((rec: ClientServiceRecord) => {
              if (rec) {
                const matchTicket = ticketId && rec.id === ticketId;
                const matchWindow = windowNumber && rec.windowText?.includes(`№${windowNumber}`);
                if (matchTicket || (matchWindow && (!rec.operatorName || MOCK_OPERATOR_NAMES.has(rec.operatorName) || rec.operatorName.startsWith('Оператор')))) {
                  rec.operatorName = trimmed;
                  changed = true;
                }
              }
              return rec;
            });
            if (changed) {
              localStorage.setItem(key, JSON.stringify(updated));
            }
          }
        }
      }
    }
  } catch {}
}

export function resolveOperatorName(
  ticket: { id?: string; branchId?: string; window?: { id?: string; number?: number } | null; operatorName?: string | null },
  defaultNames?: Record<number, string>
): string {
  // 0. Если имя передано в талоне и это не моковое имя
  if (ticket.operatorName && ticket.operatorName.trim() && !MOCK_OPERATOR_NAMES.has(ticket.operatorName.trim())) {
    return ticket.operatorName.trim();
  }

  if (typeof localStorage !== 'undefined') {
    // 1. По ID конкретного талона
    if (ticket.id) {
      const fromTicket = localStorage.getItem(`ticket_operator_name:${ticket.id}`);
      if (fromTicket && fromTicket.trim() && !MOCK_OPERATOR_NAMES.has(fromTicket.trim())) {
        return fromTicket.trim();
      }
    }
    // 2. По ID окна
    if (ticket.window?.id) {
      const fromWinId = localStorage.getItem(`window_operator_name:${ticket.window.id}`);
      if (fromWinId && fromWinId.trim() && !MOCK_OPERATOR_NAMES.has(fromWinId.trim())) {
        return fromWinId.trim();
      }
    }
    // 3. По отделению и номеру окна
    if (ticket.branchId && ticket.window?.number) {
      const fromBranchWin = localStorage.getItem(`window_num_operator_name:${ticket.branchId}:${ticket.window.number}`);
      if (fromBranchWin && fromBranchWin.trim() && !MOCK_OPERATOR_NAMES.has(fromBranchWin.trim())) {
        return fromBranchWin.trim();
      }
    }
    // 4. По номеру окна
    if (ticket.window?.number) {
      const fromWinNum = localStorage.getItem(`window_num_operator_name:${ticket.window.number}`);
      if (fromWinNum && fromWinNum.trim() && !MOCK_OPERATOR_NAMES.has(fromWinNum.trim())) {
        return fromWinNum.trim();
      }
    }
    // 5. Имя оператора из профиля оператора
    const opFio = localStorage.getItem('operator_fio');
    if (opFio && opFio.trim() && !MOCK_OPERATOR_NAMES.has(opFio.trim())) {
      return opFio.trim();
    }
    // 6. Имя из профиля администратора
    const adminFio = localStorage.getItem('admin_fio') || localStorage.getItem('user_fio:admin@pochta.local');
    if (adminFio && adminFio.trim() && !MOCK_OPERATOR_NAMES.has(adminFio.trim())) {
      return adminFio.trim();
    }
    // 7. Имя пользователя из общего профиля
    const userFio = localStorage.getItem('user_fio');
    if (userFio && userFio.trim() && !MOCK_OPERATOR_NAMES.has(userFio.trim())) {
      return userFio.trim();
    }
    // 8. Поиск по всем сохранённым профилям сотрудников в localStorage
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('operator_fio:') || (k.startsWith('user_fio:') && !k.includes('anon')))) {
          const val = localStorage.getItem(k)?.trim();
          if (val && !MOCK_OPERATOR_NAMES.has(val)) {
            return val;
          }
        }
      }
    } catch {}
  }

  // Если имя в профиле не найдено, возвращаем строго системное наименование окна без вымышленных ФИО
  const windowNumber = ticket.window?.number;
  if (windowNumber) {
    return `Оператор окна №${windowNumber}`;
  }
  return 'Оператор отделения';
}
