/**
 * Утилиты расчёта загруженности отделения Почты России и прогноза обслуживания («Успеваешь ли ты обслужиться до закрытия отделения»). Все расчёты согласованы с московским временем (Europe/Moscow, UTC+3).
 */

export type DayOfWeekRu = 'Пн' | 'Вт' | 'Ср' | 'Чт' | 'Пт' | 'Сб' | 'Вс';

export const DAYS_OF_WEEK: DayOfWeekRu[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export type HourlyLoad = {
  hour: number;         // 8..21
  label: string;        // "08:00", "09:00", ...
  loadPercent: number;  // 0..100
  isPeak: boolean;      // >= 70%
  estimatedWaitMinutes: number;
};

export type WorkloadFeasibilityStatus =
  | 'FEASIBLE'  // Успеваете обслужиться
  | 'TIGHT'     // Мало времени до закрытия
  | 'RISKY'     // Высокий риск не успеть
  | 'CLOSED'    // Отделение закрыто
  | 'NO_DATA';  // Нет информации о загрузке

export type FeasibilityResult = {
  status: WorkloadFeasibilityStatus;
  badgeText: string;
  headline: string;
  explanation: string;
  estimatedWaitMinutes: number | null;
  closingTimeText: string;
  minutesRemaining: number | null;
  canTakeTicket: boolean;
};

export type WorkHours = {
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
  raw: string;
};

/**
 * Разбор строки рабочих часов (например, "08:00–20:00", "09:00 - 18:00").
 */
export function parseWorkHours(rawHours?: string): WorkHours {
  const fallback: WorkHours = {
    openHour: 8,
    openMinute: 0,
    closeHour: 20,
    closeMinute: 0,
    raw: '08:00–20:00',
  };

  if (!rawHours || typeof rawHours !== 'string') {
    return fallback;
  }

  // Найти два шаблона времени \d{1,2}:\d{2}
  const matches = rawHours.match(/(\d{1,2}):(\d{2})/g);
  if (!matches || matches.length < 2) {
    return { ...fallback, raw: rawHours };
  }

  const [openStr, closeStr] = matches;
  const [oH, oM] = openStr.split(':').map(Number);
  const [cH, cM] = closeStr.split(':').map(Number);

  if (Number.isNaN(oH) || Number.isNaN(cH)) {
    return fallback;
  }

  return {
    openHour: oH,
    openMinute: oM || 0,
    closeHour: cH,
    closeMinute: cM || 0,
    raw: rawHours,
  };
}

/**
 * Получение текущего времени в часовом поясе Москвы (UTC+3).
 */
export function getMoscowTimeComponents(date = new Date()): {
  dayIndex: number; // 0 = Пн, 1 = Вт, ..., 5 = Сб, 6 = Вс
  dayRu: DayOfWeekRu;
  hour: number;
  minute: number;
  timeString: string;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '14', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };

  const dayIndex = weekdayMap[weekdayStr] ?? 5; // fallback to Saturday if unknown
  const dayRu = DAYS_OF_WEEK[dayIndex];
  const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  return {
    dayIndex,
    dayRu,
    hour,
    minute,
    timeString,
  };
}

/**
 * Аутентичные профили почасовой загруженности Почты России.
 * Для субботы (Сб, индекс 5) точно повторяет график из макета:
 *  08:00 (18% зелёный)
 *  09:00 (35% зелёный)
 *  10:00 (35% зелёный)
 *  11:00 (60% зелёный)
 *  12:00 (65% зелёный)
 *  13:00 (84% оранжевый)
 *  14:00 (88% оранжевый)
 *  15:00 (90% оранжевый)
 *  16:00 (50% зелёный)
 *  17:00 (55% зелёный)
 *  18:00 (60% зелёный)
 *  19:00 (88% оранжевый)
 *  20:00 (65% зелёный)
 *  21:00 (25% зелёный)
 */
const SATURDAY_LOAD_PROFILE = [
  { hour: 8,  load: 18, wait: 5 },
  { hour: 9,  load: 35, wait: 8 },
  { hour: 10, load: 35, wait: 8 },
  { hour: 11, load: 60, wait: 14 },
  { hour: 12, load: 65, wait: 16 },
  { hour: 13, load: 84, wait: 24 },
  { hour: 14, load: 88, wait: 26 },
  { hour: 15, load: 90, wait: 28 },
  { hour: 16, load: 50, wait: 12 },
  { hour: 17, load: 55, wait: 14 },
  { hour: 18, load: 60, wait: 15 },
  { hour: 19, load: 88, wait: 25 },
  { hour: 20, load: 65, wait: 16 },
  { hour: 21, load: 25, wait: 6 },
];

const WEEKDAY_LOAD_PROFILE = [
  { hour: 8,  load: 20, wait: 6 },
  { hour: 9,  load: 40, wait: 10 },
  { hour: 10, load: 45, wait: 11 },
  { hour: 11, load: 55, wait: 13 },
  { hour: 12, load: 75, wait: 20 },
  { hour: 13, load: 82, wait: 23 },
  { hour: 14, load: 78, wait: 22 },
  { hour: 15, load: 60, wait: 15 },
  { hour: 16, load: 65, wait: 16 },
  { hour: 17, load: 85, wait: 25 },
  { hour: 18, load: 92, wait: 28 },
  { hour: 19, load: 85, wait: 24 },
  { hour: 20, load: 50, wait: 12 },
  { hour: 21, load: 20, wait: 5 },
];

const SUNDAY_LOAD_PROFILE = [
  { hour: 8,  load: 12, wait: 4 },
  { hour: 9,  load: 25, wait: 6 },
  { hour: 10, load: 35, wait: 8 },
  { hour: 11, load: 48, wait: 12 },
  { hour: 12, load: 55, wait: 14 },
  { hour: 13, load: 65, wait: 16 },
  { hour: 14, load: 68, wait: 17 },
  { hour: 15, load: 60, wait: 15 },
  { hour: 16, load: 52, wait: 13 },
  { hour: 17, load: 45, wait: 11 },
  { hour: 18, load: 40, wait: 10 },
  { hour: 19, load: 35, wait: 8 },
  { hour: 20, load: 25, wait: 6 },
  { hour: 21, load: 15, wait: 4 },
];

export function getBranchHourlyWorkload(_branchId: string, dayIndex: number): HourlyLoad[] {
  let profile = WEEKDAY_LOAD_PROFILE;
  if (dayIndex === 5) {
    profile = SATURDAY_LOAD_PROFILE;
  } else if (dayIndex === 6) {
    profile = SUNDAY_LOAD_PROFILE;
  }

  return profile.map(item => ({
    hour: item.hour,
    label: `${String(item.hour).padStart(2, '0')}:00`,
    loadPercent: item.load,
    isPeak: item.load >= 70,
    estimatedWaitMinutes: item.wait,
  }));
}

export type EvaluateOptions = {
  workHours?: string;
  hasLoadData: boolean;
  referenceDate?: Date;
  selectedHour?: number;
  overrideWaitMinutes?: number;
};

/**
 * Оценка возможности успеть обслужиться («Успеваешь ли ты обслужиться...»).
 * Учитывает:
 *  - Наличие информации о загрузке
 *  - Часы работы отделения
 *  - Текущее время (МСК) или выбранный час
 *  - Среднее время обслуживания (~6-7 мин) + время ожидания в очереди
 */
export function evaluateServiceFeasibility({
  workHours = '08:00–20:00',
  hasLoadData,
  referenceDate = new Date(),
  selectedHour,
  overrideWaitMinutes,
}: EvaluateOptions): FeasibilityResult {
  const parsedHours = parseWorkHours(workHours);
  const now = getMoscowTimeComponents(referenceDate);
  const hour = selectedHour ?? now.hour;
  const minute = selectedHour !== undefined ? 0 : now.minute;

  const currentTotalMinutes = hour * 60 + minute;
  const openTotalMinutes = parsedHours.openHour * 60 + parsedHours.openMinute;
  const closeTotalMinutes = parsedHours.closeHour * 60 + parsedHours.closeMinute;

  const closingTimeText = `${String(parsedHours.closeHour).padStart(2, '0')}:${String(parsedHours.closeMinute).padStart(2, '0')}`;
  const openingTimeText = `${String(parsedHours.openHour).padStart(2, '0')}:${String(parsedHours.openMinute).padStart(2, '0')}`;

  // Сценарий 1: Отделение сейчас закрыто (до открытия или после закрытия)
  if (currentTotalMinutes < openTotalMinutes || currentTotalMinutes >= closeTotalMinutes) {
    const isPastClose = currentTotalMinutes >= closeTotalMinutes;
    return {
      status: 'CLOSED',
      badgeText: 'Отделение закрыто',
      headline: isPastClose ? 'Рабочий день отделения завершён' : 'Отделение ещё не открылось',
      explanation: isPastClose
        ? `Часы работы: ${parsedHours.raw}. Рекомендуем записаться онлайн на следующий день.`
        : `Отделение откроется в ${openingTimeText}. Вы можете подойти к открытию или оформить онлайн-запись.`,
      estimatedWaitMinutes: null,
      closingTimeText,
      minutesRemaining: 0,
      canTakeTicket: false,
    };
  }

  const minutesRemaining = closeTotalMinutes - currentTotalMinutes;

  // Сценарий 2: Нет информации о загрузке почты («и нет информации о загрузке почты»)
  if (!hasLoadData) {
    const hoursRemainingText = formatDurationHours(minutesRemaining);
    return {
      status: 'NO_DATA',
      badgeText: 'Нет данных о загрузке',
      headline: 'Информация о загруженности отсутствует',
      explanation: `Отделение работает до ${closingTimeText} (осталось ${hoursRemainingText}). Данные о текущей очереди не поступили — рекомендуем подойти заблаговременно.`,
      estimatedWaitMinutes: null,
      closingTimeText,
      minutesRemaining,
      canTakeTicket: true,
    };
  }

  // Сценарий 3: Есть данные о загрузке
  const hourlyData = getBranchHourlyWorkload('', now.dayIndex);
  const matchedSlot = hourlyData.find(d => d.hour === hour) || hourlyData[0];
  const waitMinutes = overrideWaitMinutes ?? matchedSlot.estimatedWaitMinutes;
  const averageServiceMinutes = 6;
  const totalNeededMinutes = waitMinutes + averageServiceMinutes;

  // Если времени до закрытия меньше, чем необходимо для ожидания и обслуживания
  if (minutesRemaining <= totalNeededMinutes) {
    return {
      status: 'RISKY',
      badgeText: 'Высокий риск не успеть',
      headline: 'Высокая вероятность не успеть до закрытия',
      explanation: `Отделение закрывается в ${closingTimeText} (через ${minutesRemaining} мин), а расчётное время ожидания и приёма ~${totalNeededMinutes} мин. Рекомендуем онлайн-запись.`,
      estimatedWaitMinutes: waitMinutes,
      closingTimeText,
      minutesRemaining,
      canTakeTicket: true,
    };
  }

  // Если времени впритык (запас менее 15 минут)
  if (minutesRemaining < totalNeededMinutes + 15) {
    return {
      status: 'TIGHT',
      badgeText: 'Впритык по времени',
      headline: 'Успеваете, если взять талон прямо сейчас',
      explanation: `До закрытия в ${closingTimeText} остаётся ${minutesRemaining} мин. Ожидание в очереди ~${waitMinutes} мин. Не откладывайте получение талона.`,
      estimatedWaitMinutes: waitMinutes,
      closingTimeText,
      minutesRemaining,
      canTakeTicket: true,
    };
  }

  // Всё отлично: клиент гарантированно успевает
  const remainingText = formatDurationHours(minutesRemaining);
  return {
    status: 'FEASIBLE',
    badgeText: 'Успеваете обслужиться',
    headline: 'Вы успеваете получить услугу',
    explanation: `При текущей загрузке ожидание ~${waitMinutes} мин. Отделение работает до ${closingTimeText} (в запасе ${remainingText}).`,
    estimatedWaitMinutes: waitMinutes,
    closingTimeText,
    minutesRemaining,
    canTakeTicket: true,
  };
}

function formatDurationHours(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}
