import React, { useState, useEffect, useMemo } from 'react';
import { Branch } from '../../api/operator/types';
import { AdminBranchOverview } from '../../api/admin/types';
import * as api from '../../api/admin/adminApi';
import {
  Clock,
  Calendar,
  Save,
  CheckCircle2,
  AlertTriangle,
  DoorClosed,
  DoorOpen,
  Users,
  ShieldCheck,
  RefreshCw,
  LogOut,
  Info
} from 'lucide-react';
import { WeeklyScheduleView } from '../client/map/WeeklyScheduleView';
import { getBranchWeeklySchedule } from '../client/map/branchSchedule';

interface BranchScheduleShiftManagerProps {
  branch: Branch;
  overview: AdminBranchOverview | null;
  onBranchUpdated: (updated: Branch) => void;
  onRefreshOverview: () => void;
}

const SCHEDULE_PRESETS = [
  { label: 'Стандарт Почты России (08:00–20:00)', value: '08:00–20:00' },
  { label: 'Продлённый день (08:00–21:00)', value: '08:00–21:00' },
  { label: 'Режим 09:00–18:00', value: '09:00–18:00' },
  { label: 'Суббота / Дежурное ОПС (09:00–16:00)', value: '09:00–16:00' },
  { label: 'Сельское / малое отделение (08:00–17:00)', value: '08:00–17:00' },
];

export const BranchScheduleShiftManager: React.FC<BranchScheduleShiftManagerProps> = ({
  branch,
  overview,
  onBranchUpdated,
  onRefreshOverview,
}) => {
  const [workHours, setWorkHours] = useState(branch.workHours || '08:00–20:00');
  const [customOpen, setCustomOpen] = useState('08:00');
  const [customClose, setCustomClose] = useState('20:00');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Shift closure state
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingShift, setClosingShift] = useState(false);
  const [shiftResult, setShiftResult] = useState<api.ShiftClosureResult | null>(null);
  const [shiftError, setShiftError] = useState<string | null>(null);

  // Opening shift state
  const [openingShift, setOpeningShift] = useState(false);
  const [openShiftSuccess, setOpenShiftSuccess] = useState<string | null>(null);

  // Вычисляем продолжительность смены из customOpen / customClose
  const shiftDuration = useMemo(() => {
    const [oH, oM] = customOpen.split(':').map(Number);
    const [cH, cM] = customClose.split(':').map(Number);
    if ([oH, oM, cH, cM].some(Number.isNaN)) return '';
    let totalMin = (cH * 60 + cM) - (oH * 60 + oM);
    if (totalMin <= 0) totalMin += 24 * 60;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return mins > 0 ? `${hours}ч ${mins}мин` : `${hours}ч`;
  }, [customOpen, customClose]);

  useEffect(() => {
    setWorkHours(branch.workHours || '08:00–20:00');
    const matches = (branch.workHours || '').match(/(\d{1,2}:\d{2})/g);
    if (matches && matches.length >= 2) {
      setCustomOpen(matches[0]);
      setCustomClose(matches[1]);
    }
  }, [branch.id, branch.workHours]);

  // Handle preset selection
  const handleSelectPreset = (val: string) => {
    setWorkHours(val);
    const matches = val.match(/(\d{1,2}:\d{2})/g);
    if (matches && matches.length >= 2) {
      setCustomOpen(matches[0]);
      setCustomClose(matches[1]);
    }
  };

  // Handle custom time change
  const handleCustomTimeChange = (open: string, close: string) => {
    setCustomOpen(open);
    setCustomClose(close);
    setWorkHours(`${open}–${close}`);
  };

  // Save schedule
  const handleSaveSchedule = async () => {
    if (!workHours.trim()) return;
    setSavingSchedule(true);
    setScheduleSuccess(null);
    setScheduleError(null);
    try {
      const updated = await api.updateBranchSchedule(branch.id, workHours.trim());
      onBranchUpdated(updated);
      setScheduleSuccess('Режим работы отделения успешно сохранён и вступил в силу.');
      setTimeout(() => setScheduleSuccess(null), 5000);
    } catch (err: any) {
      setScheduleError(err.message || 'Ошибка сохранения режима работы');
      setTimeout(() => setScheduleError(null), 6000);
    } finally {
      setSavingSchedule(false);
    }
  };

  // Close shift
  const handleConfirmCloseShift = async () => {
    setClosingShift(true);
    setShiftError(null);
    try {
      const res = await api.closeShift(branch.id);
      setShiftResult(res);
      setShowCloseModal(false);
      onRefreshOverview();
      setTimeout(() => setShiftResult(null), 10000);
    } catch (err: any) {
      setShiftError(err.message || 'Не удалось завершить смену');
      setShowCloseModal(false);
      setTimeout(() => setShiftError(null), 6000);
    } finally {
      setClosingShift(false);
    }
  };

  // Open shift (open closed windows)
  const handleOpenShift = async () => {
    if (!overview) return;
    setOpeningShift(true);
    setOpenShiftSuccess(null);
    try {
      const closedWindows = overview.windows.filter((w) => w.status === 'CLOSED');
      for (const w of closedWindows) {
        await api.changeWindowStatus(w.id, 'OPEN');
      }
      setOpenShiftSuccess(`Смена успешно открыта. Активировано окон: ${closedWindows.length || overview.windows.length}.`);
      onRefreshOverview();
      setTimeout(() => setOpenShiftSuccess(null), 6000);
    } catch (err: any) {
      setShiftError(err.message || 'Ошибка открытия смены');
    } finally {
      setOpeningShift(false);
    }
  };

  const windowsOpen = overview?.windows.filter((w) => w.status === 'OPEN').length || 0;
  const windowsClosed = overview?.windows.filter((w) => w.status === 'CLOSED').length || 0;
  const windowsWithTickets = overview?.windows.filter((w) => Boolean(w.currentTicketNumber)).length || 0;
  const waitingTickets = overview?.metrics.waitingClientsCount ?? 0;

  return (
    <div className="space-y-6">
      {/* 1. Блок настройки графика работы отделения */}
      <section
        aria-label="Режим работы отделения"
        className="bg-white rounded-3xl border border-[#D2D8E2] p-5 sm:p-6 shadow-sm space-y-5 text-left"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-[#003B73] flex items-center justify-center font-bold">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                Режим работы отделения (ОПС)
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Начальник отделения сам устанавливает график приёма клиентов для корректного расчёта очередей и времени закрытия
              </p>
            </div>
          </div>
          <span className="font-mono text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            Текущий: {branch.workHours || '08:00–20:00'}
          </span>
        </div>

        {/* Предустановленные шаблоны Почты России */}
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            Готовые шаблоны графиков Почты России:
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {SCHEDULE_PRESETS.map((preset) => {
              const active = workHours === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => handleSelectPreset(preset.value)}
                  className={`p-3 rounded-2xl border text-left text-xs font-medium transition-all ${
                    active
                      ? 'border-[#003B73] bg-blue-50/70 text-[#003B73] font-bold shadow-xs ring-1 ring-[#003B73]'
                      : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                  }`}
                >
                  <div className="font-bold text-slate-900 flex items-center justify-between">
                    <span>{preset.value}</span>
                    {active && <CheckCircle2 className="w-4 h-4 text-[#003B73]" />}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">{preset.label}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Ручная точная настройка часов (строго 24-часовой формат) */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-700">
              Индивидуальная настройка времени (открытие и закрытие):
            </label>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-[#003B73] border border-blue-200">
              24-часовой формат
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-600">С:</span>
              <select
                value={customOpen.split(':')[0] || '08'}
                onChange={(e) => {
                  const m = customOpen.split(':')[1] || '00';
                  handleCustomTimeChange(`${e.target.value.padStart(2, '0')}:${m}`, customClose);
                }}
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 font-mono text-xs font-bold bg-white text-slate-800 shadow-2xs focus:ring-2 focus:ring-[#003B73]"
                aria-label="Час открытия ОПС (24-часовой формат)"
              >
                {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                  <option key={`open-h-${h}`} value={h}>{h}:00</option>
                ))}
              </select>
              <span className="text-xs font-mono font-bold text-slate-400">:</span>
              <select
                value={customOpen.split(':')[1] || '00'}
                onChange={(e) => {
                  const h = customOpen.split(':')[0] || '08';
                  handleCustomTimeChange(`${h}:${e.target.value}`, customClose);
                }}
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 font-mono text-xs font-bold bg-white text-slate-800 shadow-2xs focus:ring-2 focus:ring-[#003B73]"
                aria-label="Минуты открытия ОПС"
              >
                {['00', '15', '30', '45'].map(m => (
                  <option key={`open-m-${m}`} value={m}>:{m}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-600">До:</span>
              <select
                value={customClose.split(':')[0] || '20'}
                onChange={(e) => {
                  const m = customClose.split(':')[1] || '00';
                  handleCustomTimeChange(customOpen, `${e.target.value.padStart(2, '0')}:${m}`);
                }}
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 font-mono text-xs font-bold bg-white text-slate-800 shadow-2xs focus:ring-2 focus:ring-[#003B73]"
                aria-label="Час закрытия ОПС (24-часовой формат)"
              >
                {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                  <option key={`close-h-${h}`} value={h}>{h}:00</option>
                ))}
              </select>
              <span className="text-xs font-mono font-bold text-slate-400">:</span>
              <select
                value={customClose.split(':')[1] || '00'}
                onChange={(e) => {
                  const h = customClose.split(':')[0] || '20';
                  handleCustomTimeChange(customOpen, `${h}:${e.target.value}`);
                }}
                className="px-2.5 py-1.5 rounded-xl border border-slate-300 font-mono text-xs font-bold bg-white text-slate-800 shadow-2xs focus:ring-2 focus:ring-[#003B73]"
                aria-label="Минуты закрытия ОПС"
              >
                {['00', '15', '30', '45'].map(m => (
                  <option key={`close-m-${m}`} value={m}>:{m}</option>
                ))}
              </select>
            </div>

            <div className="text-xs text-slate-600 font-mono bg-white px-3 py-1.5 rounded-xl border border-slate-200">
              График: <strong className="text-slate-900">{workHours}{shiftDuration ? ` (${shiftDuration})` : ''}</strong>
            </div>
          </div>
        </div>

        {/* Уведомления об успехе/ошибке сохранения */}
        {scheduleSuccess && (
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{scheduleSuccess}</span>
          </div>
        )}
        {scheduleError && (
          <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{scheduleError}</span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={savingSchedule}
            onClick={handleSaveSchedule}
            className="px-5 py-2.5 rounded-xl bg-[#003B73] text-white text-xs font-bold hover:bg-[#054FA6] transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
          >
            {savingSchedule ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Сохранить режим работы отделения</span>
          </button>
        </div>

        {/* Официальное расписание на всю неделю (Яндекс Карты) */}
        <div className="pt-2">
          <WeeklyScheduleView schedule={getBranchWeeklySchedule(branch.id, branch.name, workHours)} />
        </div>
      </section>

      {/* 2. Блок управления сменой (Открытие, завершение, перенос талонов) */}
      <section
        aria-label="Управление сменой ОПС"
        className="bg-white rounded-3xl border border-[#D2D8E2] p-5 sm:p-6 shadow-sm space-y-5 text-left"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                Управление операционной сменой отделения
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Регламент окончания рабочего дня, сохранение непрерывности обслуживания и отмена невызванных талонов
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                windowsOpen > 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  windowsOpen > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}
              />
              <span>{windowsOpen > 0 ? 'Смена открыта' : 'Смена закрыта'}</span>
            </span>
          </div>
        </div>

        {/* Сводка по окнам и очереди прямо сейчас */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-center">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Окон в работе
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-900 font-mono mt-0.5">
              {windowsOpen}
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-center">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Окон закрыто
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-600 font-mono mt-0.5">
              {windowsClosed}
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-center">
            <div className="text-[11px] font-bold text-[#003B73] uppercase tracking-wider">
              Обслуживаются сейчас
            </div>
            <div className="text-xl sm:text-2xl font-black text-[#003B73] font-mono mt-0.5">
              {windowsWithTickets}
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-center">
            <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
              Ожидают в очереди
            </div>
            <div className="text-xl sm:text-2xl font-black text-amber-900 font-mono mt-0.5">
              {waitingTickets}
            </div>
          </div>
        </div>

        {/* Правила завершения смены (регламент) */}
        <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-2 text-xs text-slate-800 leading-relaxed">
          <div className="flex items-center gap-2 font-bold text-[#003B73]">
            <ShieldCheck className="w-4 h-4 text-[#003B73]" />
            <span>Регламент закрытия смены Почты России:</span>
          </div>
          <ul className="list-disc list-inside space-y-1 pl-1 text-slate-700">
            <li>
              <strong>Клиенты у окон не прерываются:</strong> если оператор уже обслуживает посетителя или талон вызван к окну, оператор имеет право завершить прием без сбоев.
            </li>
            <li>
              <strong>Плавное закрытие окон (CLOSING):</strong> окна, где обслуживают клиентов, не принимают новых талонов и закрываются сразу по окончании текущей услуги.
            </li>
            <li>
              <strong>Невызванные талоны очереди:</strong> талоны в статусах «В очереди» (WAITING) и «Запись запланирована» (SCHEDULED) отменяются с фиксацией события в журнале аудита. Клиенты получают уведомление о закрытии смены.
            </li>
          </ul>
        </div>

        {/* Результат завершения смены */}
        {shiftResult && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2 animate-fadeIn text-xs">
            <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>Смена успешно завершена!</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono">
              <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-200">
                Отменено невызванных талонов: <strong>{shiftResult.cancelledTicketsCount}</strong>
              </div>
              <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-200">
                Окон завершают клиентов: <strong>{shiftResult.windowsClosingCount}</strong>
              </div>
              <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-200">
                Окон закрыто: <strong>{shiftResult.windowsClosedCount}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Сообщения об ошибках / открытия смены */}
        {openShiftSuccess && (
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{openShiftSuccess}</span>
          </div>
        )}
        {shiftError && (
          <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{shiftError}</span>
          </div>
        )}

        {/* Кнопки действий со сменой */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            disabled={openingShift}
            onClick={handleOpenShift}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
          >
            {openingShift ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <DoorOpen className="w-4 h-4" />
            )}
            <span>Открыть смену (Активировать окна)</span>
          </button>

          <button
            type="button"
            disabled={closingShift}
            onClick={() => setShowCloseModal(true)}
            className="px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
          >
            <DoorClosed className="w-4 h-4" />
            <span>Завершить смену отделения...</span>
          </button>
        </div>
      </section>

      {/* Модальное окно подтверждения закрытия смены */}
      {showCloseModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 text-left animate-scaleIn">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 id="shift-modal-title" className="text-base sm:text-lg font-black text-slate-900">
                  Подтверждение завершения смены
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {branch.name}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-2 text-xs text-rose-950">
              <p className="font-bold">
                Внимание! Вы закрываете операционную смену отделения:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-700">
                <li>
                  Будет отменено невызванных талонов из очереди: <strong className="text-rose-700">{waitingTickets} чел.</strong>
                </li>
                <li>
                  Клиенты у окон прямо сейчас (<strong className="text-blue-700">{windowsWithTickets} чел.</strong>) смогут спокойно завершить обслуживание.
                </li>
                <li>
                  Окна перейдут в статус закрытия, новые клиенты вызываться не будут.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={closingShift}
                onClick={() => setShowCloseModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={closingShift}
                onClick={handleConfirmCloseShift}
                className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors shadow-sm flex items-center gap-2"
              >
                {closingShift && <RefreshCw className="w-4 h-4 animate-spin" />}
                <span>Да, завершить смену</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
