"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { Calendar } from "@/components/ui/c-calendar-14-utils/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

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
        <div className="flex flex-col sm:flex-row items-stretch">
          {/* Сетка календаря дней месяца */}
          <div className="p-2 sm:p-3 flex-1 flex justify-center items-center">
            <Calendar
              locale={ru}
              disabled={[{ before: effectiveMinDate }]}
              mode="single"
              onSelect={handleDateChange}
              selected={date}
            />
          </div>

          {/* Правая панель выбора времени в две колонки: Часы и Минуты (шаг 15 мин) */}
          <div className="flex flex-col w-full sm:w-64 max-sm:border-t sm:border-s border-slate-200/80 bg-slate-50/50">
            {/* Заголовок с датой — комфортный padding, шрифт не обрезается сверху в Safari/Yandex */}
            <div className="px-4 pt-3.5 pb-2.5 border-b border-slate-200/70 bg-white shrink-0">
              <p className="text-xs font-bold text-slate-900 capitalize leading-normal truncate" title={format(date, "EEEE, d MMMM", { locale: ru })}>
                {format(date, "EEEE, d MMMM", { locale: ru })}
              </p>
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                <span>Время визита:</span>
                <span className="font-mono font-bold text-[#003B73] px-2 py-0.5 rounded-lg bg-blue-50 border border-blue-200/60 shadow-2xs">
                  {currentHour}:{currentMinute} МСК
                </span>
              </div>
            </div>

            {/* Две колонки выбора: Часы (08-20) и Минуты (раз в 15 минут) */}
            <div className="grid grid-cols-2 divide-x divide-slate-200/70 flex-1 h-[270px]">
              {/* Колонка 1: Часы */}
              <div className="flex flex-col min-w-0 h-full">
                <div className="px-2 py-1.5 bg-slate-100/90 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-center border-b border-slate-200/70 shrink-0">
                  Часы
                </div>
                <ScrollArea className="flex-1 h-full">
                  <div className="p-1.5 space-y-1">
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
                              ? 'bg-[#003B73] text-white shadow-xs'
                              : isAvail
                              ? 'bg-white hover:bg-blue-50 text-slate-800 border border-slate-200/70 hover:border-blue-200'
                              : 'bg-slate-100/60 text-slate-300 border border-transparent cursor-not-allowed opacity-40'
                          }`}
                          aria-pressed={isSelected}
                        >
                          {h}:00
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Колонка 2: Минуты с шагом 15 мин */}
              <div className="flex flex-col min-w-0 h-full">
                <div className="px-2 py-1.5 bg-slate-100/90 text-[10px] font-bold text-slate-600 uppercase tracking-wider text-center border-b border-slate-200/70 shrink-0">
                  Минуты (:15)
                </div>
                <ScrollArea className="flex-1 h-full">
                  <div className="p-1.5 space-y-1">
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
                              ? 'bg-[#003B73] text-white shadow-xs'
                              : isAvail
                              ? 'bg-white hover:bg-blue-50 text-slate-800 border border-slate-200/70 hover:border-blue-200'
                              : 'bg-slate-100/60 text-slate-300 border border-transparent cursor-not-allowed opacity-40'
                          }`}
                          aria-pressed={isSelected}
                        >
                          :{m}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default Pattern;
