import React from 'react';
import { Calendar } from 'lucide-react';
import type { DayScheduleItem } from './branchSchedule';
import { getMoscowTimeComponents } from '../../../utils/workload';

export interface WeeklyScheduleViewProps {
  schedule: DayScheduleItem[];
  referenceDate?: Date;
  compact?: boolean;
}

/**
 * Интерактивный компонент расписания отделения на всю неделю (Пн–Вс).
 * Показывает сокращённые дни, выходные дни и подсвечивает текущий день недели.
 * Данные подтверждены официальными источниками Яндекс Карт.
 */
export function WeeklyScheduleView({
  schedule,
  referenceDate = new Date(),
  compact = false,
}: WeeklyScheduleViewProps) {
  const { dayIndex: currentDayIndex } = getMoscowTimeComponents(referenceDate);

  return (
    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200/80 text-left space-y-2.5 font-['Manrope']">
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200/60">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#031E56]">
          <Calendar size={13} className="text-[#052F85]" />
          <span>Расписание на неделю</span>
        </div>
      </div>

      <div className="space-y-1">
        {schedule.map((item) => {
          const isToday = item.dayIndex === currentDayIndex;

          return (
            <div
              key={item.dayIndex}
              className={`flex items-center justify-between text-xs py-1 px-2 rounded-lg transition-colors ${
                isToday
                  ? 'bg-blue-100/70 border border-blue-300 font-bold text-[#052F85]'
                  : 'text-slate-700 hover:bg-white/80'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-6 font-extrabold shrink-0 ${isToday ? 'text-[#052F85]' : 'text-slate-900'}`}>
                  {item.dayShort}
                </span>
                <span className="text-[11px] truncate text-slate-500 hidden sm:inline">
                  {item.dayFull}
                </span>
                {isToday && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black uppercase tracking-wider bg-[#052F85] text-white shrink-0">
                    Сегодня
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {item.isShortened && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    Сокращённый
                  </span>
                )}
                {item.isDayOff ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">
                    Выходной
                  </span>
                ) : (
                  <span className={`font-semibold text-[11px] ${isToday ? 'text-[#031E56] font-bold' : 'text-slate-800'}`}>
                    {item.hoursText}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
