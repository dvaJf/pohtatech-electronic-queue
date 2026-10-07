import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { AdminMetrics } from '../../api/admin/types';

interface KpiCardsProps {
  metrics: AdminMetrics;
  noShowCount?: number;
}

function formatTicketsCount(n: number): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 19) return `${n} талонов`;
  if (mod10 === 1) return `${n} талон`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} талона`;
  return `${n} талонов`;
}

export const KpiCards: React.FC<KpiCardsProps> = ({ metrics, noShowCount = 0 }) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 font-mono">
      {/* 1. Ср. ожидание */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
        <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Ср. ожидание</div>
        <div className="text-2xl font-black text-slate-900 mt-1">
          {metrics.avgWaitTimeMinutes} мин
        </div>
        <div className="text-xs text-emerald-700 font-semibold mt-1 font-sans flex items-center gap-1">
          {metrics.avgWaitTimeMinutes <= 8 ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 inline" />
              <span>В нормативе (&lt; 8 мин)</span>
            </>
          ) : (
            <span>Мониторинг SLA</span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-2 font-sans">
          P90 ожидания: {typeof metrics.p90WaitMinutes === 'number' ? metrics.p90WaitMinutes.toFixed(2) : '—'} мин
        </div>
      </div>

      {/* 2. Макс. ожидание */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
        <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Макс. ожидание</div>
        <div className="text-2xl font-black text-amber-700 mt-1">
          {metrics.maxWaitTimeMinutes} мин
        </div>
        <div className="text-xs text-slate-500 mt-1 font-sans flex items-center gap-1">
          {metrics.maxWaitTimeMinutes > 15 ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 inline" />
              <span className="text-amber-700 font-semibold">Защита от голодания</span>
            </>
          ) : (
            <span>В норме</span>
          )}
        </div>
      </div>

      {/* 3. В зале ожидания */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
        <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">В зале ожидания</div>
        <div className="text-2xl font-black text-[#054FA6] mt-1">
          {metrics.waitingClientsCount} чел
        </div>
        <div className="text-xs text-slate-500 mt-1 font-sans">
          {metrics.activeWindowsCount} / {metrics.totalWindowsCount} окна в работе
        </div>
      </div>

      {/* 4. Обслужено за смену */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
        <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Обслужено за смену</div>
        <div className="text-2xl font-black text-slate-900 mt-1">
          {metrics.servedTodayCount} чел
        </div>
        <div className="text-xs text-emerald-700 font-semibold mt-1 font-sans">
          За текущий день (МСК)
        </div>
      </div>

      {/* 5. Неявки */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm col-span-2 lg:col-span-1">
        <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Неявки</div>
        <div className="text-2xl font-black text-[#D92534] mt-1">
          {formatTicketsCount(noShowCount)}
        </div>
        <div className="text-xs text-slate-500 mt-1 font-sans">
          Окна освобождены
        </div>
      </div>
    </div>
  );
};
