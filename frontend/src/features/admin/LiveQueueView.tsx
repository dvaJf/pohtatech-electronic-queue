import React, { useState, useMemo } from 'react';
import './admin.css';
import { AdminWindow, AdminQueueTicket } from '../../api/admin/types';
import { formatMoscowTime } from '../../utils/time';
import { PochtaEmblem } from '../../components/common/PochtaBrand';
import { getBranchPostalCode } from '../../utils/branchSlug';
import {
  Tv,
  ListFilter,
  Search,
  X,
  Clock,
  Calendar,
  QrCode,
  Users,
  RefreshCw,
  Sparkles,
  ArrowUpRight,
  Layers,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface LiveQueueViewProps {
  windows: AdminWindow[];
  queue: AdminQueueTicket[];
  branchName?: string;
  branchId?: string;
  onRefresh?: () => Promise<void> | void;
  isRefreshing?: boolean;
}

type ViewMode = 'tv' | 'table';
type SourceFilter = 'ALL' | 'APPOINTMENT' | 'QR' | 'LIVE';

export const LiveQueueView: React.FC<LiveQueueViewProps> = ({
  windows,
  queue,
  branchName = 'Отделение Почты России',
  branchId,
  onRefresh,
  isRefreshing = false,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('tv');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');

  // Distinct strictly WAITING tickets that are not currently at a window
  const waitingQueue = useMemo(() => {
    const activeWindowTicketNumbers = new Set(
      windows.map((w) => w.currentTicketNumber).filter(Boolean)
    );
    return queue.filter(
      (item) => item.status === 'WAITING' && !activeWindowTicketNumbers.has(item.publicNumber)
    );
  }, [queue, windows]);

  // Filtered queue for table view. Unlike the hall preview, the operational
  // register must include tickets that are already CALLED or SERVING.
  const filteredQueue = useMemo(() => {
    const filtered = queue.filter((item) => {
      // Source filter
      if (sourceFilter !== 'ALL' && item.source !== sourceFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesNumber = item.publicNumber.toLowerCase().includes(q);
        const matchesService = item.serviceName.toLowerCase().includes(q);
        return matchesNumber || matchesService;
      }
      return true;
    });
    // Limit to 50 tickets max to prevent excessive scrolling
    return filtered.slice(0, 50);
  }, [queue, sourceFilter, searchQuery]);

  // Source counters
  const counts = useMemo(() => {
    return {
      all: waitingQueue.length,
      appointment: waitingQueue.filter((t) => t.source === 'APPOINTMENT').length,
      qr: waitingQueue.filter((t) => t.source === 'QR').length,
      live: waitingQueue.filter((t) => t.source === 'LIVE').length,
    };
  }, [waitingQueue]);

  const activeServingWindows = windows.filter(
    (w) => w.status === 'OPEN' && w.currentTicketNumber
  );
  const openIdleWindows = windows.filter(
    (w) => w.status === 'OPEN' && !w.currentTicketNumber
  );
  const closedWindows = windows.filter((w) => w.status === 'CLOSED');

  return (
    <div className="space-y-4">
      {/* 1. Header Toolbar & View Mode Switcher */}
      <section className="bg-white rounded-3xl border border-[#D2D8E2] p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#003B73] text-white flex items-center justify-center shadow-sm shrink-0">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-slate-900 tracking-tight">
                  Очередь в реальном времени
                </h2>
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>LIVE</span>
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {branchName} · Всего в очереди: <strong className="text-slate-800">{queue.length}</strong> чел. · Активных окон: <strong className="text-slate-800">{activeServingWindows.length + openIdleWindows.length}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View Mode Toggle */}
            <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 text-xs font-bold border border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode('tv')}
                aria-pressed={viewMode === 'tv'}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  viewMode === 'tv'
                    ? 'bg-white text-[#003B73] shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Tv className="w-4 h-4" />
                <span>Табло зала (как клиентам)</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-pressed={viewMode === 'table'}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  viewMode === 'table'
                    ? 'bg-white text-[#003B73] shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ListFilter className="w-4 h-4" />
                <span>Оперативный реестр</span>
              </button>
            </div>

            {/* Direct Link to dedicated branch TV board */}
            {branchId && (
              <a
                href={`/tv/${getBranchPostalCode(branchId, branchName)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100/80 text-[#003B73] transition-all flex items-center gap-1.5 text-xs font-bold shadow-2xs"
                title="Открыть экран табло для этого отделения в отдельной вкладке или на ТВ"
              >
                <Tv className="w-4 h-4 text-[#003B73]" />
                <span>Открыть на ТВ</span>
              </a>
            )}

            {/* Refresh Button */}
            {onRefresh && (
              <button
                type="button"
                onClick={() => void onRefresh()}
                disabled={isRefreshing}
                title="Обновить очередь сейчас"
                className="p-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 hover:text-[#003B73] transition-colors shadow-2xs disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#003B73]' : ''}`} />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 2. MODE 1: TV HALL DISPLAY (КАК ВИДЯТ ПОСЕТИТЕЛИ В ЗАЛЕ) */}
      {viewMode === 'tv' && (
        <div className="live-queue-board rounded-2xl p-5 sm:p-7 border space-y-6" aria-label="Предпросмотр информационного табло зала">
          {/* TV Board Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3.5">
              <PochtaEmblem className="w-10 h-10" bg="#FFFFFF" fg="#003B73" />
              <div>
                <div className="text-xs font-bold tracking-widest uppercase text-blue-200">
                  ПОЧТА РОССИИ • ИНФОРМАЦИОННОЕ ТАБЛО ВЫЗОВА
                </div>
                <div className="text-base font-black text-white">
                  {branchName}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 text-right">
              <div className="font-mono">
                <div className="text-2xl sm:text-3xl font-black text-white tracking-wider">
                  {formatMoscowTime(new Date())} <span className="text-xs font-bold text-blue-300">МСК</span>
                </div>
                  <div className="text-[11px] text-blue-200 font-semibold">
                    Московское время
                </div>
              </div>
            </div>
          </div>

          {/* Current Serving Section (Windows Call Cards) */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-ping" />
                <span>СЕЙЧАС ОБСЛУЖИВАЮТСЯ У СТОЕК</span>
              </div>
              <span className="font-mono text-xs text-blue-300">
                {activeServingWindows.length} активно / {openIdleWindows.length} свободно
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {windows.map((win) => {
                const isServing = win.status === 'OPEN' && win.currentTicketNumber;
                const isIdle = win.status === 'OPEN' && !win.currentTicketNumber;

                return (
                  <div
                    key={win.id}
                    className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                      isServing
                        ? 'bg-white text-slate-900 border-white shadow-lg ring-2 ring-blue-400'
                        : isIdle
                        ? 'bg-blue-950/60 text-blue-200 border-blue-800/60'
                        : 'bg-slate-900/40 text-slate-500 border-slate-800/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between border-b pb-2 mb-2 border-current/10">
                      <div className="font-mono font-black text-sm uppercase">
                        Окно № {win.number}
                      </div>
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                          isServing
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : isIdle
                            ? 'bg-blue-900/80 text-blue-200 border-blue-700'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {isServing ? 'ИДЁТ ПРИЁМ' : isIdle ? 'СВОБОДНО' : 'ЗАКРЫТО'}
                      </span>
                    </div>

                    <div className="my-1 text-center py-2">
                      {isServing ? (
                        <div>
                          <div className="live-queue-number text-3xl sm:text-4xl font-black font-mono text-[#003B73] tracking-tight">
                            {win.currentTicketNumber}
                          </div>
                          <div className="text-xs font-semibold text-slate-600 mt-1 truncate max-w-full">
                            {win.currentService || 'Обслуживание'}
                          </div>
                        </div>
                      ) : isIdle ? (
                        <div className="text-sm font-semibold text-blue-300 font-mono py-2">
                          Ожидает вызова
                        </div>
                      ) : (
                        <div className="text-xs font-mono text-slate-500 py-2">
                          Окно закрыто
                        </div>
                      )}
                    </div>

                    <div className="text-[10px] font-mono text-right text-current/60 pt-1 border-t border-current/10">
                      Обслужено сегодня: {win.servedCount}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Waiting Queue List in TV Style */}
          <div className="space-y-3 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-blue-200">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-300" />
                <span>ОЖИДАЮТ В ОЧЕРЕДИ ({waitingQueue.length})</span>
              </div>
              <span className="text-[11px] font-mono text-blue-300">
                Порядок вызова формируется по алгоритму СУО
              </span>
            </div>

            {waitingQueue.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                  {waitingQueue.slice(0, 50).map((item, idx) => {
                    const isApt = item.source === 'APPOINTMENT';
                    const isQr = item.source === 'QR';

                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-2xl border text-center flex flex-col justify-between transition-all ${
                          idx === 0
                            ? 'bg-[#0055A5] text-white border-blue-400/50 shadow-md ring-2 ring-white/30'
                            : 'bg-white/10 text-white border-white/20 hover:bg-white/15'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono text-white/70">
                          <span>#{idx + 1}</span>
                          <span>{item.waitTimeMinutes}м</span>
                        </div>
                        <div className="live-queue-number font-black font-mono tracking-tight my-1">
                          {item.publicNumber}
                        </div>
                        <div className="text-[10px] font-semibold truncate text-white/90">
                          {item.serviceName}
                        </div>
                        <div className="mt-1">
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase ${
                              isApt
                                ? 'bg-indigo-500/90 text-white'
                                : isQr
                                ? 'bg-sky-500/90 text-white'
                                : 'bg-amber-500/90 text-white'
                            }`}
                          >
                            {isApt ? 'Запись' : isQr ? 'QR' : 'Живая'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {waitingQueue.length > 50 && (
                  <div className="mt-3 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white/80 text-xs font-semibold">
                      <AlertCircle className="w-4 h-4" />
                      <span>Показаны первые 50 из {waitingQueue.length} талонов в очереди</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-10 bg-white/5 rounded-2xl border border-white/10 space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                <p className="text-sm font-bold text-white">Очередь свободна</p>
                <p className="text-xs text-blue-200">
                  Все клиенты отделения обслужены, ожидающих талонов нет
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. MODE 2: OPERATIONAL TABLE (ОПЕРАТИВНЫЙ РЕЕСТР ОЧЕРЕДИ ДЛЯ АДМИНИСТРАТОРА) */}
      {viewMode === 'table' && (
        <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-4 shadow-sm">
          {/* Controls Bar: Search & Category Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="field-with-icon relative flex-1 max-w-md">
              <Search className="field-with-icon__icon w-4 h-4 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по номеру талона (A-001, Q-015...) или услуге"
                className="field-with-icon__input w-full py-2 rounded-xl border border-slate-300 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#003B73] bg-slate-50/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Source Category Pills */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setSourceFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl border transition-all ${
                  sourceFilter === 'ALL'
                    ? 'bg-[#003B73] text-white border-[#003B73] shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Все ({counts.all})
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter('APPOINTMENT')}
                className={`px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1 ${
                  sourceFilter === 'APPOINTMENT'
                    ? 'bg-indigo-700 text-white border-indigo-700 shadow-2xs'
                    : 'bg-white text-indigo-700 border-slate-300 hover:bg-indigo-50'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Запись ({counts.appointment})</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter('QR')}
                className={`px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1 ${
                  sourceFilter === 'QR'
                    ? 'bg-[#054FA6] text-white border-[#054FA6] shadow-2xs'
                    : 'bg-white text-[#054FA6] border-slate-300 hover:bg-sky-50'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>QR-код ({counts.qr})</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter('LIVE')}
                className={`px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1 ${
                  sourceFilter === 'LIVE'
                    ? 'bg-amber-700 text-white border-amber-700 shadow-2xs'
                    : 'bg-white text-amber-800 border-slate-300 hover:bg-amber-50'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Живая ({counts.live})</span>
              </button>
            </div>
          </div>

          {/* Results Summary */}
          {filteredQueue.length > 0 && filteredQueue.length < waitingQueue.length && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs">
              <div className="flex items-center gap-2 text-blue-800 font-semibold">
                <AlertCircle className="w-4 h-4" />
                <span>
                  Показано {filteredQueue.length} из {waitingQueue.length} талонов
                  {searchQuery || sourceFilter !== 'ALL' ? ' (применены фильтры)' : ' (лимит отображения)'}
                </span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] border-b border-slate-200">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">Талон</th>
                  <th className="p-3">Источник</th>
                  <th className="p-3">Услуга</th>
                  <th className="p-3">Статус</th>
                  <th className="p-3">Ожидание</th>
                  <th className="p-3">Вход в очередь</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQueue.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400 font-sans text-xs">
                      {searchQuery || sourceFilter !== 'ALL'
                        ? 'По заданному фильтру талонов не найдено'
                        : 'В реестре нет активных талонов'}
                    </td>
                  </tr>
                ) : (
                  filteredQueue.map((item, index) => {
                    const isApt = item.source === 'APPOINTMENT';
                    const isQr = item.source === 'QR';
                    const isLongWait = item.waitTimeMinutes > 15;
                    const isMediumWait = item.waitTimeMinutes > 10;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-bold text-slate-400">
                          #{index + 1}
                        </td>
                        <td className="p-3 font-black text-sm text-[#003B73]">
                          {item.publicNumber}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1.5 ${
                              isApt
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                : isQr
                                ? 'bg-sky-50 text-[#054FA6] border-sky-200'
                                : 'bg-amber-50 text-amber-900 border-amber-200'
                            }`}
                          >
                            {isApt ? (
                              <>
                                <Calendar className="w-3 h-3 text-indigo-600" />
                                <span>Предварительная запись</span>
                              </>
                            ) : isQr ? (
                              <>
                                <QrCode className="w-3 h-3 text-[#054FA6]" />
                                <span>QR-код (смартфон)</span>
                              </>
                            ) : (
                              <>
                                <Users className="w-3 h-3 text-amber-700" />
                                <span>Живая очередь</span>
                              </>
                            )}
                          </span>
                        </td>
                        <td className="p-3 font-sans font-medium text-slate-800">
                          {item.serviceName}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              item.status === 'SERVING'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : item.status === 'CALLED'
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : 'bg-blue-50 text-[#054FA6] border-blue-200'
                            }`}
                          >
                            {item.status === 'SERVING'
                              ? 'В ОБСЛУЖИВАНИИ'
                              : item.status === 'CALLED'
                              ? 'ВЫЗВАН'
                              : 'В ОЧЕРЕДИ'}
                          </span>
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-lg text-xs font-bold font-mono ${
                              isLongWait
                                ? 'bg-red-100 text-red-800 border border-red-300'
                                : isMediumWait
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {item.waitTimeMinutes} мин
                          </span>
                        </td>
                        <td className="p-3 text-slate-500 font-mono text-[11px]">
                          {formatMoscowTime(item.queueEnteredAt)} МСК
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
