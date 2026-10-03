"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { Calendar } from "@/components/ui/c-calendar-14-utils/calendar";
import { Card, CardContent } from "@/components/ui/card";

export interface TimeSlotItem {
  time: string;
  available: boolean;
}

export interface Calendar14Props {
  selectedDate?: Date;
  onSelectDate?: (date: Date) => void;
  selectedHour?: string;
  onSelectHour?: (hour: string) => void;
  selectedMinute?: string;
  onSelectMinute?: (minute: string) => void;
  selectedTime?: string | null;
  onSelectTime?: (time: string) => void;
  allowedHours?: string[];
  allowedMinutes?: string[];
  timeSlots?: TimeSlotItem[];
  minDate?: Date;
  className?: string;
}

const DEFAULT_HOURS = [
  "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"
];

const DEFAULT_MINUTES = ["00", "15", "30", "45"];

export function Pattern({
  selectedDate: controlledDate,
  onSelectDate: controlledOnSelectDate,
  selectedHour: controlledHour,
  onSelectHour: controlledOnSelectHour,
  selectedMinute: controlledMinute,
  onSelectMinute: controlledOnSelectMinute,
  selectedTime: controlledTime,
  onSelectTime: controlledOnSelectTime,
  allowedHours,
  allowedMinutes,
  timeSlots,
  minDate,
  className = "",
}: Calendar14Props = {}) {
  const today = new Date();
  const [internalDate, setInternalDate] = useState<Date>(today);
  const [internalHour, setInternalHour] = useState<string>("10");
  const [internalMinute, setInternalMinute] = useState<string>("00");

  const date = controlledDate !== undefined ? controlledDate : internalDate;

  // Парсинг времени из controlledTime если передан
  const parsedTimeParts = controlledTime ? controlledTime.split(":") : [];
  const currentHour = controlledHour !== undefined
    ? controlledHour
    : (parsedTimeParts[0] || internalHour);
  const currentMinute = controlledMinute !== undefined
    ? controlledMinute
    : (parsedTimeParts[1] || internalMinute);

  const hoursList = allowedHours && allowedHours.length > 0 ? allowedHours : DEFAULT_HOURS;
  const minutesList = allowedMinutes && allowedMinutes.length > 0 ? allowedMinutes : DEFAULT_MINUTES;

  const handleDateChange = (newDate: Date | undefined) => {
    if (newDate) {
      if (controlledOnSelectDate) {
        controlledOnSelectDate(newDate);
      } else {
        setInternalDate(newDate);
      }
    }
  };

  const handleHourSelect = (hour: string) => {
    if (controlledOnSelectHour) {
      controlledOnSelectHour(hour);
    } else {
      setInternalHour(hour);
    }
    const newTime = `${hour}:${currentMinute}`;
    if (controlledOnSelectTime) {
      controlledOnSelectTime(newTime);
    }
  };

  const handleMinuteSelect = (minute: string) => {
    if (controlledOnSelectMinute) {
      controlledOnSelectMinute(minute);
    } else {
      setInternalMinute(minute);
    }
    const newTime = `${currentHour}:${minute}`;
    if (controlledOnSelectTime) {
      controlledOnSelectTime(newTime);
    }
  };

  const isSlotAvailable = (h: string, m: string) => {
    if (!timeSlots || timeSlots.length === 0) return true;
    const match = timeSlots.find(s => s.time === `${h}:${m}`);
    return match ? match.available : true;
  };

  const isHourAvailable = (h: string) => {
    if (!timeSlots || timeSlots.length === 0) return true;
    return minutesList.some(m => isSlotAvailable(h, m));
  };

  const isMinuteAvailable = (h: string, m: string) => {
    return isSlotAvailable(h, m);
  };

  const effectiveMinDate = minDate || today;

  return (
    <Card className={`p-0 overflow-hidden border border-slate-200/90 rounded-3xl shadow-xs bg-white ${className}`}>
      <CardContent className="p-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:h-[315px]">
          {/* Сетка календаря дней месяца */}
          <div className="p-2 sm:p-2.5 flex-1 flex justify-center items-center min-w-0 overflow-hidden">
            <Calendar
              locale={ru}
              disabled={[{ before: effectiveMinDate }]}
              mode="single"
              onSelect={handleDateChange}
              selected={date}
            />
          </div>

          {/* Правая панель выбора времени в две колонки: Часы и Минуты (шаг 15 мин) */}
          <div className="flex flex-col w-full sm:w-56 max-sm:h-[300px] sm:h-auto max-sm:border-t sm:border-s border-slate-200/80 bg-slate-50/50 min-h-0">
            {/* Заголовок с датой — комфортный padding, шрифт не обрезается сверху в Safari/Yandex */}
            <div className="px-3 pt-2.5 pb-2 border-b border-slate-200/70 bg-white shrink-0">
              <p className="text-xs font-bold text-slate-900 capitalize leading-normal truncate" title={format(date, "EEEE, d MMMM", { locale: ru })}>
                {format(date, "EEEE, d MMMM", { locale: ru })}
              </p>
              <div className="flex items-center justify-between text-[11px] text-slate-600 mt-1">
                <span className="font-medium">Время визита:</span>
                <span className="font-mono font-bold text-[#003B73] px-2 py-0.5 rounded-lg bg-blue-50 border border-blue-200/60 shadow-2xs">
                  {currentHour}:{currentMinute} МСК
                </span>
              </div>
            </div>

            {/* Заголовки колонок */}
            <div className="grid grid-cols-2 divide-x divide-slate-200/70 border-b border-slate-200/70 bg-slate-100/90 shrink-0">
              <div className="px-2 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-wider text-center">
                Часы
              </div>
              <div className="px-2 py-1.5 text-[10px] font-bold text-slate-700 uppercase tracking-wider text-center">
                Минуты
              </div>
            </div>

            {/* Списки часов и минут с адаптивной высотой без обрезания слотов */}
            <div className="grid grid-cols-2 divide-x divide-slate-200/70 flex-1 min-h-0">
              {/* Колонка 1: Часы (скроллится) */}
              <div
                className="h-full overflow-y-auto calendar-slots-scroll p-1.5 pb-6 space-y-1 overscroll-contain"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  scrollPaddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 16px))',
                }}
              >
                {hoursList.map(h => {
                  const isSelected = h === currentHour;
                  const isAvail = isHourAvailable(h);
                  return (
                    <button
                      key={h}
                      type="button"
                      disabled={!isAvail}
                      onClick={() => handleHourSelect(h)}
                      className={`w-full py-1.5 px-2 rounded-xl text-xs font-mono font-bold transition-all text-center select-none ${
                        isSelected
                          ? '!bg-[#003B73] !text-white shadow-xs !border-transparent'
                          : isAvail
                          ? '!bg-white hover:!bg-blue-50 !text-slate-800 hover:!text-[#003B73] border border-slate-200/80 hover:border-blue-200'
                          : '!bg-slate-100/60 !text-slate-400 !border-transparent cursor-not-allowed opacity-40'
                      }`}
                      aria-pressed={isSelected}
                    >
                      {h}:00
                    </button>
                  );
                })}
                <div className="h-12 w-full shrink-0" aria-hidden="true" />
              </div>

              {/* Колонка 2: Минуты */}
              <div
                className="h-full overflow-y-auto calendar-slots-scroll p-1.5 pb-6 space-y-1 overscroll-contain"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  scrollPaddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 16px))',
                }}
              >
                {minutesList.map(m => {
                  const isSelected = m === currentMinute;
                  const isAvail = isMinuteAvailable(currentHour, m);
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={!isAvail}
                      onClick={() => handleMinuteSelect(m)}
                      className={`w-full py-2 px-2 rounded-xl text-xs font-mono font-bold transition-all text-center select-none ${
                        isSelected
                          ? '!bg-[#003B73] !text-white shadow-xs !border-transparent'
                          : isAvail
                          ? '!bg-white hover:!bg-blue-50 !text-slate-800 hover:!text-[#003B73] border border-slate-200/80 hover:border-blue-200'
                          : '!bg-slate-100/60 !text-slate-400 !border-transparent cursor-not-allowed opacity-40'
                      }`}
                      aria-pressed={isSelected}
                    >
                      :{m}
                    </button>
                  );
                })}
                <div className="h-12 w-full shrink-0" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default Pattern;
