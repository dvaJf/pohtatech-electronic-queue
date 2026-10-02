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

  const [showInteractiveCalendar, setShowInteractiveCalendar] = useState(false);

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
    <div className="space-y-4 text-left w-full max-w-full min-w-0 font-['Manrope']">
      {/* 1. Выбор даты визита */}
      <div className="space-y-2 w-full max-w-full min-w-0">
        <label className="flex items-center justify-between text-xs font-bold text-slate-700">
          <span className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#003B73] shrink-0" />
            <span>Дата визита</span>
          </span>
          <span className="text-[10px] sm:text-[11px] text-slate-400 font-normal">Часовой пояс: МСК</span>
        </label>

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

        {/* Быстрые кнопки выбора даты */}
        <div className="grid grid-cols-3 gap-1 sm:gap-1.5 select-none w-full max-w-full min-w-0">
          <button
            type="button"
            disabled={disabled || !canBookToday}
            onClick={() => canBookToday && handleDateChange(todayDateStr)}
            aria-pressed={datePart === todayDateStr}
            className={`appointment-choice appointment-date-choice ${
              !canBookToday ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400' : ''
            }`}
            title={!canBookToday ? 'Сегодня отделение закрыто — запись доступна со следующего рабочего дня' : 'Запись на сегодня'}
          >
            <span>Сегодня</span>
            {!canBookToday && <span className="text-[9px] block text-rose-600 font-bold leading-tight">закрыто</span>}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleDateChange(tomorrowDateStr)}
            aria-pressed={datePart === tomorrowDateStr}
            className="appointment-choice appointment-date-choice"
          >
            <span>Завтра</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleDateChange(afterTomorrowDateStr)}
            aria-pressed={datePart === afterTomorrowDateStr}
            className="appointment-choice appointment-date-choice"
          >
            <span>Послезавтра</span>
          </button>
        </div>

        {/* Календарный ввод конкретной даты */}
        <input
          type="date"
          min={canBookToday ? todayDateStr : firstAvailableDateStr}
          value={datePart}
          disabled={disabled}
          onChange={(e) => handleDateChange(e.target.value)}
          className="w-full min-w-0 max-w-full box-border px-3 py-2 text-xs font-bold font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#003B73] bg-white shadow-2xs block"
          aria-label="Выбор даты записи"
        />

        {/* Интерактивный календарь со слотами c-calendar-14 */}
        <div className="pt-1 w-full max-w-full min-w-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowInteractiveCalendar((prev) => !prev)}
            className="w-full py-2 px-3 rounded-xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 text-[#003B73] text-xs font-bold flex items-center justify-between transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5 truncate">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{showInteractiveCalendar ? 'Свернуть календарь со слотами' : 'Интерактивный календарь со слотами'}</span>
            </span>
            <span className="text-[10px] font-semibold text-blue-800 bg-white px-2 py-0.5 rounded-md border border-blue-200 shrink-0">
              c-calendar-14
            </span>
          </button>
          {showInteractiveCalendar && (
            <div className="mt-2 p-2.5 rounded-2xl bg-slate-50/80 border border-slate-200 shadow-inner overflow-hidden">
              <Calendar14
                selectedDate={selectedDateObj}
                onSelectDate={handleCalendarDateSelect}
                selectedTime={`${selectedHour}:${selectedMinute}`}
                onSelectTime={handleSlotSelect}
                timeSlots={calendarTimeSlots}
                minDate={canBookToday ? new Date() : new Date(Date.now() + 86400000)}
              />
            </div>
          )}
        </div>
      </div>

      {/* 2. Выбор времени (24-часовой формат) */}
      <div className="space-y-2 pt-1 border-t border-slate-100 w-full max-w-full min-w-0">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Clock className="w-3.5 h-3.5 text-[#003B73] shrink-0" />
            <span>Время визита</span>
          </label>
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-[#003B73] border border-blue-200">
            24-часовой формат
          </span>
        </div>

        {/* Выпадающие списки Часы : Минуты в строгом 24h формате */}
        <div className="grid grid-cols-2 gap-2 min-w-0 max-w-full">
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 block mb-1 truncate">
              Часы (00–23)
            </span>
            <select
              value={selectedHour}
              disabled={disabled || isSelectedDateDayOff}
              onChange={(e) => handleHourChange(e.target.value)}
              className="w-full min-w-0 max-w-full px-2.5 sm:px-3 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white shadow-2xs focus:ring-2 focus:ring-[#003B73] text-slate-900 truncate disabled:opacity-50"
              aria-label="Час визита (24-часовой формат)"
            >
              {allowedHours.map((h) => (
                <option key={h} value={h}>
                  {h}:00 ({Number(h) < 12 ? 'Утро' : Number(h) < 18 ? 'День' : 'Вечер'})
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 block mb-1 truncate">
              Минуты (00–59)
            </span>
            <select
              value={selectedMinute}
              disabled={disabled || isSelectedDateDayOff}
              onChange={(e) => handleMinuteChange(e.target.value)}
              className="w-full min-w-0 max-w-full px-2.5 sm:px-3 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white shadow-2xs focus:ring-2 focus:ring-[#003B73] text-slate-900 truncate disabled:opacity-50"
              aria-label="Минуты визита"
            >
              {allowedMinutes.map((m) => (
                <option key={m} value={m}>
                  :{m} мин
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Быстрые слоты времени (24-часовые чипы) */}
        {!isSelectedDateDayOff && visiblePopularSlots.length > 0 && (
          <div className="pt-1 w-full max-w-full min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
              Быстрый выбор времени:
            </span>
            <div className="grid grid-cols-4 gap-1.5 sm:gap-2 w-full max-w-full min-w-0">
              {visiblePopularSlots.map((slot) => {
                const active = `${selectedHour}:${selectedMinute}` === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSlotSelect(slot)}
                    aria-pressed={active}
                    className="appointment-choice appointment-time-choice"
                  >
                    <span>{slot}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. Информационный бейдж с подтверждением 24-часового формата */}
      <div className="cx-appointment-summary p-3 rounded-2xl bg-blue-50/70 border border-blue-200 text-xs text-slate-800 w-full max-w-full min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Check className="w-4 h-4 text-[#003B73] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="cx-appointment-summary-label text-[11px] text-slate-500 block">Выбранное время визита:</span>
            <strong className="cx-appointment-summary-date text-slate-900 font-bold capitalize block text-xs">{formattedPreview}</strong>
          </div>
        </div>
        <span className="cx-appointment-summary-time font-mono text-xs font-black text-[#003B73] px-2.5 py-1 rounded-xl bg-white border border-blue-200 shadow-2xs">
          {selectedHour}:{selectedMinute}
        </span>
      </div>
    </div>
  );
};
