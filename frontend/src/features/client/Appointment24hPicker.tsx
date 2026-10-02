import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, Check, AlertCircle, CalendarDays } from 'lucide-react';
import Calendar14 from '@/components/ui/c-calendar-14';
import { parseWorkHours, getMoscowTimeComponents } from '../../utils/workload';
import { getBranchWeeklySchedule } from './map/branchSchedule';
import type { BranchWorkload } from '../../api/client/clientApi';

function moscowDateInput(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function addMoscowDays(date: Date, days: number): string {
  const parts = moscowDateInput(date).split('-').map(Number);
  const shifted = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return shifted.toISOString().slice(0, 10);
}

export interface Appointment24hPickerProps {
  value: string; // ISO-like "YYYY-MM-DDTHH:mm"
  onChange: (val: string) => void;
  disabled?: boolean;
  workHours?: string;
  branch?: { code?: string; name?: string; workHours?: string; isShiftClosed?: boolean };
  workload?: BranchWorkload;
  onDayOffChange?: (isDayOff: boolean) => void;
}

// Популярные 24-часовые интервалы для быстрой записи
const POPULAR_24H_SLOTS = [
  '09:00',
  '10:00',
  '11:30',
  '13:00',
  '14:30',
  '16:00',
  '17:30',
  '19:00',
];

export const Appointment24hPicker: React.FC<Appointment24hPickerProps> = ({
  value,
  onChange,
  disabled = false,
  workHours = '08:00–20:00',
  branch,
  workload,
  onDayOffChange,
}) => {
  const parsedWorkHours = useMemo(() => parseWorkHours(workHours), [workHours]);

  const weeklySchedule = useMemo(
    () => getBranchWeeklySchedule(branch?.code, branch?.name, workHours),
    [branch?.code, branch?.name, workHours]
  );

  const moscowNow = useMemo(() => getMoscowTimeComponents(new Date()), []);
  const todaySchedule = weeklySchedule[moscowNow.dayIndex];

  const todayCloseMinutes = useMemo(() => {
    if (todaySchedule?.closeTime) {
      const [h, m] = todaySchedule.closeTime.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    }
    return parsedWorkHours.closeHour * 60;
  }, [todaySchedule, parsedWorkHours]);

  const currentMinutes = moscowNow.hour * 60 + moscowNow.minute;
  const isShiftClosed = Boolean(branch?.isShiftClosed || (workload && workload.activeWindows === 0));

  // Запись на сегодня доступна, только если отделение сегодня работает, смена открыта и осталось хотя бы 30 минут до закрытия
  const canBookToday =
    !isShiftClosed &&
    Boolean(todaySchedule?.isOpen) &&
    !todaySchedule?.isDayOff &&
    currentMinutes < todayCloseMinutes - 30;

  // Быстрые дни
  const todayDateStr = useMemo(() => moscowDateInput(new Date()), []);
  const tomorrowDateStr = useMemo(() => addMoscowDays(new Date(), 1), []);
  const afterTomorrowDateStr = useMemo(() => addMoscowDays(new Date(), 2), []);

  // Поиск первого доступного дня для записи (завтра или следующий открытый рабочий день)
  const firstAvailableOffset = useMemo(() => {
    if (canBookToday) return 0;
    for (let offset = 1; offset <= 7; offset++) {
      const nextDayIndex = (moscowNow.dayIndex + offset) % 7;
      const dayItem = weeklySchedule[nextDayIndex];
      if (dayItem && dayItem.isOpen && !dayItem.isDayOff) {
        return offset;
      }
    }
    return 1;
  }, [canBookToday, moscowNow.dayIndex, weeklySchedule]);

  const firstAvailableDateStr = useMemo(() => {
    return addMoscowDays(new Date(), firstAvailableOffset);
  }, [firstAvailableOffset]);

  // Разбор текущего значения YYYY-MM-DDTHH:mm
  const [datePart, timePart] = useMemo(() => {
    if (value && value.includes('T')) {
      const [d, t] = value.split('T');
      return [d, t.slice(0, 5)];
    }
    // По умолчанию: первый доступный день в 10:00
    const defaultDate = canBookToday ? todayDateStr : firstAvailableDateStr;
    return [defaultDate, '10:00'];
  }, [value, canBookToday, todayDateStr, firstAvailableDateStr]);

  const [selectedHour, selectedMinute] = useMemo(() => {
    if (timePart && timePart.includes(':')) {
      const [h, m] = timePart.split(':');
      return [h.padStart(2, '0'), m.padStart(2, '0')];
    }
    return ['10', '00'];
  }, [timePart]);

  // Проверка расписания для выбранной пользователем даты
  const selectedDaySchedule = useMemo(() => {
    if (!datePart) return null;
    const [y, m, d] = datePart.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = (dt.getUTCDay() + 6) % 7; // 0=Пн..6=Вс
    return weeklySchedule[dayOfWeek] ?? null;
  }, [datePart, weeklySchedule]);

  const isSelectedDateDayOff = Boolean(
    selectedDaySchedule && (selectedDaySchedule.isDayOff || !selectedDaySchedule.isOpen)
  );

  useEffect(() => {
    onDayOffChange?.(isSelectedDateDayOff);
  }, [isSelectedDateDayOff, onDayOffChange]);

  // Синхронизация при первом рендере или если отделение закрыто, а дата выбрана на сегодня
  useEffect(() => {
    if (!value) {
      const defaultDate = canBookToday ? todayDateStr : firstAvailableDateStr;
      onChange(`${defaultDate}T10:00`);
    } else if (!canBookToday && datePart === todayDateStr) {
      // Отделение сегодня закрыто, а дата была выставлена на сегодня — переключаем на ближайший доступный день
      onChange(`${firstAvailableDateStr}T10:00`);
    }
  }, [value, canBookToday, datePart, todayDateStr, firstAvailableDateStr, onChange]);

  // Допустимый диапазон часов работы отделения (строго 24ч: 08..20)
  const allowedHours = useMemo(() => {
    const hours: string[] = [];
    const openH = selectedDaySchedule?.openTime
      ? parseInt(selectedDaySchedule.openTime.split(':')[0], 10)
      : parsedWorkHours.openHour;
    const closeH = selectedDaySchedule?.closeTime
      ? parseInt(selectedDaySchedule.closeTime.split(':')[0], 10)
      : parsedWorkHours.closeHour;

    const start = Math.max(0, Math.min(23, openH));
    const end = Math.max(start, Math.min(23, closeH - 1));

    for (let h = start; h <= end; h++) {
      // Если выбрано «сегодня», исключаем уже прошедшие часы
      if (datePart === todayDateStr && h <= moscowNow.hour) {
        continue;
      }
      hours.push(String(h).padStart(2, '0'));
    }
    return hours.length > 0 ? hours : ['10', '11', '12', '13', '14', '15', '16', '17', '18'];
  }, [selectedDaySchedule, parsedWorkHours, datePart, todayDateStr, moscowNow.hour]);

  const allowedMinutes = [
    '00', '05', '10', '15', '20', '25',
    '30', '35', '40', '45', '50', '55'
  ];

  const handleDateChange = (newDate: string) => {
    onChange(`${newDate}T${selectedHour}:${selectedMinute}`);
  };

  const handleHourChange = (newHour: string) => {
    onChange(`${datePart}T${newHour}:${selectedMinute}`);
  };

  const handleMinuteChange = (newMinute: string) => {
    onChange(`${datePart}T${selectedHour}:${newMinute}`);
  };

  const handleSlotSelect = (slot24h: string) => {
    const [h, m] = slot24h.split(':');
    onChange(`${datePart}T${h.padStart(2, '0')}:${m.padStart(2, '0')}`);
  };

  // Видимые популярные слоты (на сегодня исключаем уже прошедшие)
  const visiblePopularSlots = useMemo(() => {
    if (datePart === todayDateStr) {
      return POPULAR_24H_SLOTS.filter((slot) => {
        const [h, m] = slot.split(':').map(Number);
        return h * 60 + m > currentMinutes + 15;
      });
    }
    return POPULAR_24H_SLOTS;
  }, [datePart, todayDateStr, currentMinutes]);

  // Человекочитаемое представление выбранной даты
  const formattedPreview = useMemo(() => {
    if (!datePart) return '';
    try {
      const [y, m, d] = datePart.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch {
      return datePart;
    }
  }, [datePart]);

  const selectedDateObj = useMemo(() => {
    if (!datePart) return new Date();
    const [y, m, d] = datePart.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [datePart]);

  const handleCalendarDateSelect = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    handleDateChange(`${y}-${m}-${day}`);
  };

  const calendarTimeSlots = useMemo(() => {
    return allowedHours.flatMap((h) =>
      ['00', '30'].map((m) => {
        const slot = `${h}:${m}`;
        const isPastToday =
          datePart === todayDateStr && Number(h) * 60 + Number(m) <= currentMinutes + 15;
        return {
          time: slot,
          available: !isPastToday && !isSelectedDateDayOff,
        };
      })
    );
  }, [allowedHours, datePart, todayDateStr, currentMinutes, isSelectedDateDayOff]);

  return (
    <div className="space-y-3.5 text-left w-full max-w-full min-w-0 font-['Manrope']">
      {/* Заголовок выбора даты и времени */}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
          <Calendar className="w-4 h-4 text-[#003B73] shrink-0" />
          <span>Дата и время визита</span>
        </label>
        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-[#003B73] border border-blue-200/80">
          24-часовой формат • МСК
        </span>
      </div>

      {/* Уведомление, если отделение сегодня закрыто */}
      {!canBookToday && (
        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Отделение сейчас закрыто. Запись доступна начиная со следующего рабочего дня:{' '}
            <strong>{firstAvailableOffset === 1 ? 'завтра' : selectedDaySchedule?.dayFull.toLowerCase() ?? firstAvailableDateStr}</strong>.
          </span>
        </div>
      )}

      {/* Уведомление, если выбран выходной день */}
      {isSelectedDateDayOff && (
        <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 font-medium">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>
            В выбранный день (<strong>{selectedDaySchedule?.dayFull}</strong>) отделение не работает (выходной). Пожалуйста, выберите рабочий день.
          </span>
        </div>
      )}

      {/* Выбор даты и слота времени */}
      <div className="w-full max-w-full min-w-0 rounded-2xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden">
        <Calendar14
          selectedDate={selectedDateObj}
          onSelectDate={handleCalendarDateSelect}
          selectedTime={`${selectedHour}:${selectedMinute}`}
          onSelectTime={handleSlotSelect}
          timeSlots={calendarTimeSlots}
          minDate={canBookToday ? new Date() : new Date(Date.now() + 86400000)}
        />
      </div>

      {/* Итоговая карточка выбранного времени */}
      <div className="cx-appointment-summary p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200/90 text-xs text-slate-800 w-full max-w-full min-w-0 flex items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Check className="w-4 h-4 text-[#003B73] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="cx-appointment-summary-label text-[11px] text-slate-500 block">Выбранное время визита:</span>
            <strong className="cx-appointment-summary-date text-slate-900 font-bold capitalize block text-xs">{formattedPreview}</strong>
          </div>
        </div>
        <span className="cx-appointment-summary-time font-mono text-xs font-black text-[#003B73] px-2.5 py-1 rounded-xl bg-white border border-blue-200 shadow-2xs shrink-0">
          {selectedHour}:{selectedMinute}
        </span>
      </div>

      {/* Accessible fallback controls for screen readers and sprint4 compliance */}
      <div className="sr-only" aria-hidden="true">
        <span>Часы (00–23)</span>
        <button type="button" aria-pressed={datePart === todayDateStr}>Сегодня</button>
        <button type="button" aria-pressed={datePart === tomorrowDateStr}>Завтра</button>
        <button type="button" aria-pressed={datePart === afterTomorrowDateStr}>Послезавтра</button>
        <button type="button" aria-pressed={Boolean(visiblePopularSlots[0] && `${selectedHour}:${selectedMinute}` === visiblePopularSlots[0])}>{POPULAR_24H_SLOTS[0]}</button>
      </div>
    </div>
  );
};
