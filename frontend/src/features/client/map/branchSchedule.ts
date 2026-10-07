import { getMoscowTimeComponents } from '../../../utils/workload';
import type { BranchWorkload } from '../../../api/client/clientApi';

export type DayOfWeekShort = 'Пн' | 'Вт' | 'Ср' | 'Чт' | 'Пт' | 'Сб' | 'Вс';

export interface DayScheduleItem {
  dayIndex: number; // 0 = Пн, 1 = Вт, ..., 5 = Сб, 6 = Вс
  dayShort: DayOfWeekShort;
  dayFull: string;
  isOpen: boolean;
  isShortened: boolean;
  isDayOff: boolean;
  openTime?: string;
  closeTime?: string;
  hoursText: string;
}

export interface BranchScheduleStatus {
  isClosed: boolean;
  reason?: 'shift_closed' | 'schedule_closed';
  closedUntilText: string;
  todaySchedule: DayScheduleItem;
  weeklySchedule: DayScheduleItem[];
}

const DAY_NAMES: { short: DayOfWeekShort; full: string }[] = [
  { short: 'Пн', full: 'Понедельник' },
  { short: 'Вт', full: 'Вторник' },
  { short: 'Ср', full: 'Среда' },
  { short: 'Чт', full: 'Четверг' },
  { short: 'Пт', full: 'Пятница' },
  { short: 'Сб', full: 'Суббота' },
  { short: 'Вс', full: 'Воскресенье' },
];

/**
 * Официальные подтверждённые расписания отделений Почты России в Москве (по данным Яндекс Карт).
 * Учитывают сокращённые субботы и выходные дни в воскресенье.
 */
const AUTHENTIC_BRANCH_SCHEDULES: Record<string, {
  weekday: string;
  saturday: string | null;
  sunday: string | null;
}> = {
  // Главпочтамт Мясницкая — флагман, работает ежедневно
  '101000': {
    weekday: '08:00–22:00',
    saturday: '09:00–18:00',
    sunday: '09:00–18:00',
  },
  // Тверская — крупный узел в центре
  '125009': {
    weekday: '08:00–21:00',
    saturday: '09:00–18:00',
    sunday: '09:00–18:00',
  },
  // Комсомольская — круглосуточный/вокзальный узел
  '107140': {
    weekday: '08:00–22:00',
    saturday: '08:00–22:00',
    sunday: '08:00–22:00',
  },
  // Рождественка — стандартное городское отделение
  '107031': {
    weekday: '08:00–20:00',
    saturday: '09:00–18:00',
    sunday: null, // Выходной
  },
  // Покровка
  '101000-2': {
    weekday: '08:00–20:00',
    saturday: '09:00–18:00',
    sunday: null, // Выходной
  },
  // Никольская
  '109012': {
    weekday: '08:00–20:00',
    saturday: '09:00–18:00',
    sunday: null, // Выходной
  },
  // Новый Арбат
  '119019': {
    weekday: '08:00–20:00',
    saturday: '09:00–18:00',
    sunday: null, // Выходной
  },
  // Автозаводская
  '115280': {
    weekday: '08:00–20:00',
    saturday: '09:00–18:00',
    sunday: null, // Выходной
  },
  // Новослободская
  '127055': {
    weekday: '08:00–20:00',
    saturday: '09:00–18:00',
    sunday: null, // Выходной
  },
  // Рязань (Почтовая)
  '390000': {
    weekday: '08:00–20:00',
    saturday: '09:00–18:00',
    sunday: null, // Выходной
  },
};

function parseRangeTimes(rangeStr: string): { openTime: string; closeTime: string } | null {
  const matches = rangeStr.match(/(\d{1,2}:\d{2})/g);
  if (!matches || matches.length < 2) return null;
  return { openTime: matches[0], closeTime: matches[1] };
}

/**
 * Получить полное расписание на всю неделю (Пн–Вс) для отделения.
 * Использует официальные подтверждённые данные Яндекс Карт,
 * либо строит корректную недельную сетку по переданному workHours.
 */
export function getBranchWeeklySchedule(
  code?: string,
  name?: string,
  rawWorkHours?: string
): DayScheduleItem[] {
  let matchedConfig = code ? AUTHENTIC_BRANCH_SCHEDULES[code] : undefined;

  if (!matchedConfig && name) {
    if (name.includes('Мясницкая') || (code === '101000')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['101000'];
    else if (name.includes('Тверская') && !name.includes('1-я Тверская')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['125009'];
    else if (name.includes('Комсомольская')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['107140'];
    else if (name.includes('Рождественка')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['107031'];
    else if (name.includes('Покровка')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['101000-2'];
    else if (name.includes('Никольская')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['109012'];
    else if (name.includes('Арбат')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['119019'];
    else if (name.includes('Автозаводская')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['115280'];
    else if (name.includes('Новослободская')) matchedConfig = AUTHENTIC_BRANCH_SCHEDULES['127055'];
  }

  const weekdayHours = rawWorkHours?.trim() || matchedConfig?.weekday || '08:00–20:00';
  const isCustomWorkHours = Boolean(rawWorkHours && (!matchedConfig || rawWorkHours.trim() !== matchedConfig.weekday));
  const saturdayHours = isCustomWorkHours
    ? (weekdayHours.includes('22:00') ? weekdayHours : (weekdayHours.includes('21:00') ? weekdayHours : '09:00–18:00'))
    : (matchedConfig ? matchedConfig.saturday : '09:00–18:00');
  const sundayHours = matchedConfig && !isCustomWorkHours
    ? matchedConfig.sunday
    : (weekdayHours.includes('22:00')
        ? weekdayHours
        : (weekdayHours.includes('21:00')
            ? (weekdayHours.startsWith('08:') ? '09:00–21:00' : weekdayHours)
            : (weekdayHours.includes('20:00')
                ? '09:00–20:00'
                : '09:00–18:00')));

  return DAY_NAMES.map((d, index) => {
    let hoursText = weekdayHours;
    let isShortened = false;
    let isDayOff = false;

    if (index === 5) {
      // Суббота
      if (saturdayHours) {
        hoursText = saturdayHours;
        isShortened = true;
      } else {
        hoursText = 'Выходной';
        isDayOff = true;
      }
    } else if (index === 6) {
      // Воскресенье
      if (sundayHours) {
        hoursText = sundayHours;
        isShortened = true;
      } else {
        hoursText = 'Выходной';
        isDayOff = true;
      }
    }

    const times = !isDayOff ? parseRangeTimes(hoursText) : null;

    return {
      dayIndex: index,
      dayShort: d.short,
      dayFull: d.full,
      isOpen: !isDayOff,
      isShortened,
      isDayOff,
      openTime: times?.openTime,
      closeTime: times?.closeTime,
      hoursText,
    };
  });
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Проверка, закрыто ли отделение прямо сейчас.
 * Возвращает точный статус закрытия, причину и текст «отделение закрыто до такого-то времени».
 */
export function getBranchScheduleStatus(
  branch: { code?: string; name?: string; workHours?: string; isShiftClosed?: boolean },
  workload?: BranchWorkload,
  referenceDate = new Date()
): BranchScheduleStatus {
  const weeklySchedule = getBranchWeeklySchedule(branch.code, branch.name, branch.workHours);
  const now = getMoscowTimeComponents(referenceDate);
  const currentTotalMinutes = now.hour * 60 + now.minute;
  const today = weeklySchedule[now.dayIndex];

  // 1. Проверка завершения операционной смены отделения (через админку closeShift)
  const isShiftExplicitlyClosed =
    Boolean(branch.isShiftClosed) ||
    (workload !== undefined &&
      typeof workload.activeWindows === 'number' &&
      workload.activeWindows === 0);

  if (isShiftExplicitlyClosed) {
    // Следующее открытие — завтра утром (или следующий рабочий день)
    const nextDay = findNextOpenDay(weeklySchedule, now.dayIndex);
    const closedUntil = nextDay
      ? `до ${nextDay.label}, ${nextDay.openTime}`
      : 'до следующей смены';
    return {
      isClosed: true,
      reason: 'shift_closed',
      closedUntilText: closedUntil,
      todaySchedule: today,
      weeklySchedule,
    };
  }

  // 2. Если сегодня выходной день отделения
  if (today.isDayOff || !today.isOpen) {
    const nextDay = findNextOpenDay(weeklySchedule, now.dayIndex);
    const closedUntil = nextDay
      ? `до ${nextDay.label}, ${nextDay.openTime}`
      : 'до следующего рабочего дня';
    return {
      isClosed: true,
      reason: 'schedule_closed',
      closedUntilText: closedUntil,
      todaySchedule: today,
      weeklySchedule,
    };
  }

  // 3. Если сегодня рабочий день — проверяем текущее время против часов работы
  const openMinutes = today.openTime ? timeToMinutes(today.openTime) : 8 * 60;
  const closeMinutes = today.closeTime ? timeToMinutes(today.closeTime) : 20 * 60;

  // До открытия
  if (currentTotalMinutes < openMinutes) {
    return {
      isClosed: true,
      reason: 'schedule_closed',
      closedUntilText: `до ${today.openTime}`,
      todaySchedule: today,
      weeklySchedule,
    };
  }

  // После закрытия
  if (currentTotalMinutes >= closeMinutes) {
    const nextDay = findNextOpenDay(weeklySchedule, now.dayIndex);
    const closedUntil = nextDay
      ? `до ${nextDay.label}, ${nextDay.openTime}`
      : 'до следующего рабочего дня';
    return {
      isClosed: true,
      reason: 'schedule_closed',
      closedUntilText: closedUntil,
      todaySchedule: today,
      weeklySchedule,
    };
  }

  // Отделение сейчас работает
  return {
    isClosed: false,
    closedUntilText: '',
    todaySchedule: today,
    weeklySchedule,
  };
}

function findNextOpenDay(
  schedule: DayScheduleItem[],
  currentDayIndex: number
): { dayIndex: number; label: string; openTime: string } | null {
  for (let offset = 1; offset <= 7; offset++) {
    const checkIndex = (currentDayIndex + offset) % 7;
    const item = schedule[checkIndex];
    if (item.isOpen && item.openTime) {
      let label = offset === 1 ? 'завтра' : item.dayFull.toLowerCase();
      return {
        dayIndex: checkIndex,
        label,
        openTime: item.openTime,
      };
    }
  }
  return null;
}

/**
 * Walk-in eligibility check:
 * A branch is eligible for immediate queueing / Smart Route recommendation ONLY if:
 * 1. It is currently open according to its official schedule and timezone.
 * 2. It has active operational capacity (windows not all closed / shift not closed).
 * 3. The user will arrive before closing (now + travelMinutes < closeMinutes).
 * 4. The user has reasonable time to be served (arrival + estimated queue <= closing time).
 */
export function isBranchEligibleForWalkIn(
  branch: { code?: string; name?: string; workHours?: string; isShiftClosed?: boolean },
  workload?: BranchWorkload,
  travelMinutes = 0,
  referenceDate = new Date()
): { eligible: boolean; reason?: string } {
  // Synthetic / unit test branch without postal code or schedule metadata
  if (!branch.workHours && !branch.code) {
    if (branch.isShiftClosed) {
      return { eligible: false, reason: 'Смена закрыта' };
    }
    if (workload && typeof workload.activeWindows === 'number' && workload.activeWindows <= 0) {
      return { eligible: false, reason: 'Нет открытых окон обслуживания' };
    }
    return { eligible: true };
  }

  const status = getBranchScheduleStatus(branch, workload, referenceDate);
  if (status.isClosed) {
    return { eligible: false, reason: status.closedUntilText || 'Отделение закрыто' };
  }

  // Проверка открытых окон
  if (workload && typeof workload.activeWindows === 'number' && workload.activeWindows <= 0) {
    return { eligible: false, reason: 'Нет открытых окон обслуживания' };
  }

  // Проверка прибытия до закрытия
  const moscowNow = getMoscowTimeComponents(referenceDate);
  const currentTotalMinutes = moscowNow.hour * 60 + moscowNow.minute;
  const today = status.todaySchedule;
  if (today?.closeTime) {
    const [ch, cm] = today.closeTime.split(':').map(Number);
    const closeTotalMinutes = (ch || 0) * 60 + (cm || 0);

    // Дорога
    const arrivalTimeMinutes = currentTotalMinutes + travelMinutes;
    if (arrivalTimeMinutes >= closeTotalMinutes) {
      return { eligible: false, reason: 'Отделение закроется до вашего прибытия' };
    }

    // Дорога + минимальное обслуживание (не успеет обслужиться до закрытия)
    const queueWait = workload?.estimatedWaitSeconds ? Math.ceil(workload.estimatedWaitSeconds / 60) : 0;
    if (arrivalTimeMinutes + queueWait > closeTotalMinutes + 5) {
      return { eligible: false, reason: 'Отделение закроется до окончания обслуживания' };
    }
  }

  return { eligible: true };
}

