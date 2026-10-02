import React, { useState, useEffect, useCallback } from 'react';
import { QueuePolicyEditor } from './QueuePolicyEditor';
import { Branch } from '../../api/operator/types';
import * as api from '../../api/admin/adminApi';
import { AdminBranchOverview, AdminWindow, AnomalyTicket } from '../../api/admin/types';
import { BranchQR } from './BranchQR';
import { AdminSelfQR } from './AdminSelfQR';
import { UsersManagement } from './UsersManagement';
import { KpiCards } from './KpiCards';
import { PochtaEmblem } from '../../components/common/PochtaBrand';
import { getMe, User } from '../../api/authApi';
import { BranchScheduleShiftManager } from './BranchScheduleShiftManager';
import { LiveQueueView } from './LiveQueueView';
import { formatMoscowDateTime } from '../../utils/time';
import { Pagination } from '../../components/common/Pagination';
import { SearchableBranchSelect } from '../../components/common/SearchableBranchSelect';
import {
  Activity,
  Sliders,
  AlertTriangle,
  Users,
  QrCode,
  CheckCircle2,
  RefreshCw,
  Calendar,
  Tv,
  ArrowRight,
  Plus,
  Trash2,
} from 'lucide-react';

type AdminTab = 'overview' | 'queue' | 'policy' | 'schedule' | 'anomalies' | 'users' | 'qr';

export const AdminWorkspace: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyTicket[]>([]);
  const [anomaliesTotal, setAnomaliesTotal] = useState(0);
  const [anomaliesPage, setAnomaliesPage] = useState(1);
  const [anomaliesPageSize, setAnomaliesPageSize] = useState(25);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);
  const [anomaliesError, setAnomaliesError] = useState<string | null>(null);

  // Real backend overview data
  const [overview, setOverview] = useState<AdminBranchOverview | null>(null);
  const [openingRecommended, setOpeningRecommended] = useState(false);

  // Initial branches fetch
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.listBranches()
      .then((items) => {
        if (!active) return;
        setBranches(items);
        setSelectedBranchId(items[0]?.id ?? '');
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить список отделений');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Poll overview for the selected branch
  useEffect(() => {
    if (!selectedBranchId) return;
    let active = true;
    let timer: number;

    async function loadOverview() {
      try {
        const next = await api.getOverview(selectedBranchId);
        if (active) {
          setOverview(next);
        }
      } catch {
        // silent retry in background
      } finally {
        const interval = activeTab === 'queue' ? 2500 : 5000;
        if (active) timer = window.setTimeout(loadOverview, interval);
      }
    }

    void loadOverview();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedBranchId, activeTab]);

  useEffect(() => {
    if (activeTab !== 'anomalies' || !selectedBranchId) return;
    let active = true;
    setAnomaliesLoading(true);
    setAnomaliesError(null);
    api.listAnomalies(selectedBranchId, anomaliesPage, anomaliesPageSize)
      .then(result => {
        if (!active) return;
        setAnomalies(result.items);
        setAnomaliesTotal(result.total);
        setAnomaliesPage(current => Math.min(current, Math.max(1, Math.ceil(result.total / anomaliesPageSize))));
      })
      .catch(() => { if (active) setAnomaliesError('Не удалось загрузить журнал аномалий'); })
      .finally(() => { if (active) setAnomaliesLoading(false); });
    return () => { active = false; };
  }, [activeTab, anomaliesPage, anomaliesPageSize, selectedBranchId]);

  useEffect(() => { setAnomaliesPage(1); }, [selectedBranchId]);

  const handleToggleWindow = async (windowId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'OPEN' ? 'CLOSED' : 'OPEN';
    try {
      await api.changeWindowStatus(windowId, nextStatus as any);
      if (selectedBranchId) {
        const updated = await api.getOverview(selectedBranchId);
        setOverview(updated);
      }
    } catch {
      // ignore
    }
  };

  const handleCreateWindow = async () => {
    if (!selectedBranchId) return;
    try {
      await api.createWindow(selectedBranchId);
      const updated = await api.getOverview(selectedBranchId);
      setOverview(updated);
    } catch (err: any) {
      alert(err.message || 'Не удалось создать окно');
    }
  };

  const handleDeleteWindow = async (windowId: string, windowNumber: number) => {
    if (!window.confirm(`Вы уверены, что хотите удалить окно №${windowNumber}?`)) return;
    try {
      await api.deleteWindow(windowId);
      const updated = await api.getOverview(selectedBranchId);
      setOverview(updated);
    } catch (err: any) {
      alert(err.message || 'Не удалось удалить окно');
    }
  };

  const noShowCount = overview?.anomalies.filter(a => a.type === 'NO_SHOW').length ?? 0;

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* 1. Header & Branch Context Card */}
      <section className="bg-white rounded-3xl border border-[#D2D8E2] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3.5">
            <PochtaEmblem className="w-11 h-11 drop-shadow-sm shrink-0" bg="#003B73" fg="#FFFFFF" />
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Панель управления начальника ОПС
              </h1>
            </div>
          </div>

          {branches.length > 0 && (
            <div className="flex flex-col text-xs font-bold text-slate-700">
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono mb-1">
                Отделение
              </span>
              <SearchableBranchSelect
                branches={branches}
                selectedId={selectedBranchId}
                onSelect={setSelectedBranchId}
                compact
                className="min-w-[240px]"
                dropdownAlign="right"
              />
            </div>
          )}
        </div>

        {/* Navigation Tabs Bar */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            aria-current={activeTab === 'overview' ? 'page' : undefined}
            className={`px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'overview'
                ? 'bg-white text-[#003B73] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Мониторинг & KPI</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            aria-current={activeTab === 'queue' ? 'page' : undefined}
            className={`px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'queue'
                ? 'bg-white text-[#003B73] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Tv className="w-4 h-4" />
            <span>Очередь (Live)</span>
            {(overview?.queue?.length ?? 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-[#003B73] text-[10px] font-mono font-black">
                {overview?.queue?.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('policy')}
            aria-current={activeTab === 'policy' ? 'page' : undefined}
            className={`px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'policy'
                ? 'bg-white text-[#003B73] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Queue Policy</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            aria-current={activeTab === 'schedule' ? 'page' : undefined}
            className={`px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'schedule'
                ? 'bg-white text-[#003B73] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Режим работы и смена</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('anomalies')}
            aria-current={activeTab === 'anomalies' ? 'page' : undefined}
            className={`px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'anomalies'
                ? 'bg-white text-[#D92534] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span>Аномалии</span>
            {anomaliesTotal > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-100 text-red-700 text-[10px] flex items-center justify-center font-mono font-black">
                {anomaliesTotal}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('users')}
            aria-current={activeTab === 'users' ? 'page' : undefined}
            className={`px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'users'
                ? 'bg-white text-[#003B73] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Пользователи</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            aria-current={activeTab === 'qr' ? 'page' : undefined}
            className={`px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'qr'
                ? 'bg-white text-[#003B73] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>QR отделения</span>
          </button>
        </div>
      </section>

      {/* 2. Top KPI Cards (Live from Backend Overview) */}
      {overview?.metrics && (
        <KpiCards metrics={overview.metrics} noShowCount={noShowCount} />
      )}

      {activeTab === 'overview' && overview?.quality && <QualitySection quality={overview.quality} />}

      {/* 3. Tab Contents */}
      {loading ? (
        <div className="py-12 text-center text-slate-400 font-mono text-xs animate-pulse" role="status">
          Загрузка отделений...
        </div>
      ) : error ? (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
          {error}
        </div>
      ) : selectedBranchId ? (
        <main className="space-y-4">
          {/* TAB 1: OVERVIEW (Windows Table & Branch QR) */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Windows Management Table */}
              <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-4 shadow-sm">
                {overview?.windowRecommendation && (
                  <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${overview.windowRecommendation.severity === 'critical' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`} role="alert">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-sm">Рекомендация по нагрузке</div>
                        <div className="text-xs mt-1 font-medium">{overview.windowRecommendation.reason}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={openingRecommended}
                      className="px-3 py-2 rounded-xl border border-current text-xs font-bold hover:bg-white/60 transition-all disabled:opacity-50 flex items-center gap-1.5"
                      onClick={async () => {
                        if (!overview?.windowRecommendation || openingRecommended) return;
                        setOpeningRecommended(true);
                        try {
                          const needed = overview.windowRecommendation.recommendedCount;
                          const closed = overview.windows.filter((window) => window.status === 'CLOSED');
                          const toOpen = closed.slice(0, needed);
                          for (const window of toOpen) {
                            await api.changeWindowStatus(window.id, 'OPEN');
                          }
                          const createCount = needed - toOpen.length;
                          for (let i = 0; i < createCount; i++) {
                            const created = await api.createWindow(selectedBranchId);
                            await api.changeWindowStatus(created.id, 'OPEN');
                          }
                          if (selectedBranchId) {
                            const updated = await api.getOverview(selectedBranchId);
                            setOverview(updated);
                          }
                        } catch {
                          // ignore
                        } finally {
                          setOpeningRecommended(false);
                        }
                      }}
                    >
                      {openingRecommended ? (
                        <span>Обработка...</span>
                      ) : (
                        <span>
                          {overview.windows.filter((w) => w.status === 'CLOSED').length === 0 ? 'Создать и открыть' : 'Открыть'} рекомендованные ({overview.windowRecommendation.recommendedCount})
                        </span>
                      )}
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">
                      Управление окнами ОПС и распределение нагрузки
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Смена, статус окон и текущие клиенты
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-500 font-bold">
                      {overview?.windows.length || 0} окон в отделении
                    </span>
                    <button
                      type="button"
                      onClick={handleCreateWindow}
                      className="px-3 py-1.5 rounded-xl bg-[#003B73] hover:bg-[#002D59] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Добавить окно</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin rounded-2xl border border-slate-100">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] sticky top-0 z-10 shadow-2xs">
                      <tr>
                        <th className="p-3">Окно</th>
                        <th className="p-3">Статус</th>
                        <th className="p-3">Текущий талон</th>
                        <th className="p-3">Обслужено за смену</th>
                        <th className="p-3 text-right">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(overview?.windows ?? []).slice().sort((a, b) => a.number - b.number).map((win) => (
                        <tr key={win.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 font-bold text-slate-900">Окно №{win.number}</td>
                          <td className="p-3">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                win.status === 'OPEN'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : 'bg-slate-200 text-slate-700 border-slate-300'
                              }`}
                            >
                              {win.status === 'OPEN' ? 'В РАБОТЕ' : 'ЗАКРЫТО'}
                            </span>
                          </td>
                          <td className="p-3 font-bold text-[#054FA6]">
                            {win.currentTicketNumber || '—'}
                          </td>
                          <td className="p-3 font-bold text-slate-700">
                            {win.servedCount} чел
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleWindow(win.id, win.status)}
                                className="px-3 py-1 rounded-lg border text-[11px] font-bold hover:bg-slate-100 transition-colors"
                              >
                                {win.status === 'OPEN' ? 'Закрыть' : 'Открыть'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteWindow(win.id, win.number)}
                                title={`Удалить окно №${win.number}`}
                                className="p-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-bold transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: LIVE QUEUE (ТАБЛО ЗАЛА + ОПЕРАТИВНЫЙ РЕЕСТР) */}
          {activeTab === 'queue' && (
            <LiveQueueView
              windows={overview?.windows || []}
              queue={overview?.queue || []}
              branchName={branches.find((b) => b.id === selectedBranchId)?.name}
              branchId={selectedBranchId}
              onRefresh={async () => {
                if (selectedBranchId) {
                  try {
                    const next = await api.getOverview(selectedBranchId);
                    setOverview(next);
                  } catch {}
                }
              }}
            />
          )}

          {/* TAB 2: QUEUE POLICY */}
          {activeTab === 'policy' && (
            <QueuePolicyEditor
              key={selectedBranchId}
              branchId={selectedBranchId}
              branchName={branches.find((b) => b.id === selectedBranchId)?.name}
            />
          )}

          {/* TAB 3: SCHEDULE & SHIFT */}
          {activeTab === 'schedule' && (
            <BranchScheduleShiftManager
              branch={
                branches.find((b) => b.id === selectedBranchId) || {
                  id: selectedBranchId,
                  name: 'Отделение',
                  workHours: '08:00–20:00',
                }
              }
              overview={overview}
              onBranchUpdated={(updated) => {
                setBranches((prev) =>
                  prev.map((b) => (b.id === updated.id ? { ...b, workHours: updated.workHours } : b))
                );
              }}
              onRefreshOverview={async () => {
                if (selectedBranchId) {
                  try {
                    const next = await api.getOverview(selectedBranchId);
                    setOverview(next);
                  } catch {
                    // silent
                  }
                }
              }}
            />
          )}

          {/* TAB 3: ANOMALIES */}
          {activeTab === 'anomalies' && (
            <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Реестр отклонений, задержек и неявок (NO_SHOW)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Автоматическая фиксация инцидентов и нарушений SLA
                  </p>
                </div>
                <span className="font-mono text-xs font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
                  {anomaliesTotal} событий
                </span>
              </div>

              <div className="space-y-2">
                {anomaliesError ? (
                  <div role="alert" className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">{anomaliesError}</div>
                ) : anomaliesLoading ? (
                  <div role="status" className="text-center py-12 text-xs text-slate-500 font-mono">Загрузка событий…</div>
                ) : anomalies.length > 0 ? (
                  anomalies.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center font-bold font-mono shrink-0">
                          {item.type === 'NO_SHOW' ? 'N/S' : 'WARN'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900 text-sm">
                              {item.publicNumber}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white border border-slate-300">
                              {item.type}
                            </span>
                          </div>
                          <p className="text-slate-600 mt-0.5">{item.description}</p>
                        </div>
                      </div>
                      <div className="text-right font-mono text-[11px] text-slate-500">
                        {formatMoscowDateTime(item.time)} МСК
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-xs text-slate-400 font-mono">
                    Отклонений и аномалий за текущую смену не зафиксировано
                  </div>
                )}
              </div>
              {!anomaliesError && <Pagination page={anomaliesPage} total={anomaliesTotal} pageSize={anomaliesPageSize}
                disabled={anomaliesLoading} onPageChange={setAnomaliesPage}
                onPageSizeChange={size => { setAnomaliesPageSize(size); setAnomaliesPage(1); }} itemLabel="аномалиям" />}
            </div>
          )}

          {/* TAB 4: USERS (IAM) */}
          {activeTab === 'users' && <UsersManagement />}

          {/* TAB 5: QR CODE */}
          {activeTab === 'qr' && (
            <BranchQR
              branchId={selectedBranchId}
              branchName={branches.find((b) => b.id === selectedBranchId)?.name || overview?.branchName}
            />
          )}
        </main>
      ) : (
        <p className="text-center text-slate-500 py-12">Нет доступных отделений</p>
      )}
    </div>
  );
};

function QualitySection({ quality }: { quality: AdminBranchOverview['quality'] }) {
  const total = quality.ratingCount;
  return <section className="rounded-3xl border border-[#D2D8E2] bg-white p-5 shadow-sm">
    <h2 className="mb-4 text-base font-extrabold text-slate-900">Качество обслуживания</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Средняя оценка" value={quality.ratingAverage === null ? 'Нет оценок' : `★ ${quality.ratingAverage.toFixed(1)}`} />
      <Metric label="Всего отзывов" value={String(total)} />
      <Metric label="За последние 30 дней" value={quality.current30Average === null ? 'Нет оценок' : `★ ${quality.current30Average.toFixed(1)}`} />
      <Metric label="Динамика" value={quality.delta === null ? 'Недостаточно данных для сравнения' : `${quality.delta >= 0 ? '+' : ''}${quality.delta.toFixed(1)}`} small={quality.delta === null} />
    </div>
    {total > 0 && <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div><h3 className="mb-3 text-sm font-bold text-slate-800">Распределение оценок</h3>{[5,4,3,2,1].map(star => { const count = quality.distribution[String(star) as '1']; const percent = Math.round(count / total * 100); return <div key={star} className="mb-2 flex items-center gap-2 text-xs"><span className="w-8 font-bold">{star} ★</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} /></div><span className="w-9 text-right text-slate-600">{percent}%</span></div>; })}</div>
      <div className="space-y-3"><div className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-900"><strong>{quality.lowRatingCount}</strong> · Низкие оценки (1–2 ★)</div>{quality.recentFeedback.length > 0 && <div><h3 className="mb-2 text-sm font-bold text-slate-800">Последние отзывы</h3>{quality.recentFeedback.map((item, i) => <div className="mb-2 rounded-xl bg-slate-50 p-2 text-xs" key={`${item.createdAt}-${i}`}><strong className="text-amber-600">{'★'.repeat(item.rating)}</strong><span className="ml-2 text-slate-700">{item.comment}</span></div>)}</div>}</div>
    </div>}
  </section>;
}

function Metric({ label, value, small = false }: { label: string; value: string; small?: boolean }) { return <div className="rounded-2xl bg-slate-50 p-3"><div className={`${small ? 'text-xs' : 'text-lg'} font-extrabold text-slate-900`}>{value}</div><div className="mt-1 text-xs text-slate-500">{label}</div></div>; }
