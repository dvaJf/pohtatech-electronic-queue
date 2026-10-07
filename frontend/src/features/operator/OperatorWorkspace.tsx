import React, { useEffect, useRef, useState } from 'react';
import * as api from '../../api/operator/operatorApi';
import { changeWindowStatus, updateWindowServices } from '../../api/admin/adminApi';
import { AdminApiError } from '../../api/admin/types';
import { listServices, arriveAppointment } from '../../api/client/clientApi';
import { Branch, OperatorWindow, Ticket, OperatorApiError } from '../../api/operator/types';
import { Service } from '../../api/client/types';
import { getMe, User } from '../../api/authApi';
import { recordTicketOperator } from '../client/serviceHistory';
import { ActionControls } from './ActionControls';
import { TicketCard } from './TicketCard';
import { broadcastTicketCallToTV } from '../../utils/tvNotification';
import { getBranchPostalCode } from '../../utils/branchSlug';
import {
  Clock,
  UserPlus,
  ArrowRightLeft,
  RotateCcw,
  CheckSquare,
  Square,
  AlertCircle,
  Users,
  Layers,
  ChevronDown,
  AlertTriangle,
  X,
  Lock,
  Tv,
  Calendar,
} from 'lucide-react';
import { formatMoscowTime } from '../../utils/time';
import { SearchableBranchSelect } from '../../components/common/SearchableBranchSelect';

interface NextAppointmentSlot {
  scheduledAt: string;
  count: number;
}

export function OperatorWorkspace() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [windows, setWindows] = useState<OperatorWindow[]>([]);
  const [windowId, setWindowId] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [current, setCurrent] = useState<Ticket | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  // Side panel TV queue state
  const [tvQueue, setTvQueue] = useState<Array<{ publicNumber: string; source?: string; serviceName?: string }>>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [nextAppointment, setNextAppointment] = useState<NextAppointmentSlot | null>(null);

  // Elapsed timer for active service
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Redirect modal state
  const [showRedirectModal, setShowRedirectModal] = useState(false);
  const [redirectServiceId, setRedirectServiceId] = useState('');
  const [redirectWindowId, setRedirectWindowId] = useState('');

  // Incident modal state
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incidentCategory, setIncidentCategory] = useState('Сбой оборудования');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentSubmitting, setIncidentSubmitting] = useState(false);


  const epoch = useRef(0);
  const busy = useRef(false);
  const liveKey = useRef<{ selection: string; key: string } | null>(null);
  const lastAnnouncedTicketId = useRef<string | null>(null);
  const activeWindowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (activeWindowRef.current) {
      activeWindowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [windowId]);

  useEffect(() => {
    getMe().then(setCurrentUser).catch(() => {});
  }, []);

  const getEffectiveOperatorFio = () => {
    const fromProfile = (
      currentUser?.fio?.trim() ||
      (currentUser?.id ? localStorage.getItem(`user_fio:${currentUser.id}`)?.trim() : '') ||
      (currentUser?.email ? localStorage.getItem(`user_fio:${currentUser.email}`)?.trim() : '') ||
      localStorage.getItem('operator_fio')?.trim() ||
      localStorage.getItem('admin_fio')?.trim() ||
      localStorage.getItem('user_fio')?.trim() ||
      ''
    );
    if (fromProfile) return fromProfile;

    if (currentUser?.role === 'opc_chief' || currentUser?.role === 'admin') {
      return 'Администратор ОПС';
    }
    const win = windows.find(w => w.id === windowId);
    if (win?.number) {
      return `Оператор окна №${win.number}`;
    }
    return 'Оператор';
  };

  useEffect(() => {
    const handleFioUpdated = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.fio) {
        setCurrentUser(prev => prev ? { ...prev, fio: detail.fio } : null);
        const win = windows.find(w => w.id === windowId);
        if (win) {
          recordTicketOperator('', detail.fio, win.number, branchId, win.id);
        }
      }
    };
    window.addEventListener('auth_fio_updated', handleFioUpdated);
    return () => window.removeEventListener('auth_fio_updated', handleFioUpdated);
  }, [windows, windowId, branchId]);

  useEffect(() => {
    const win = windows.find(w => w.id === windowId);
    const fio = getEffectiveOperatorFio();
    if (win && fio) {
      recordTicketOperator('', fio, win.number, branchId, win.id);
    }
  }, [windows, windowId, branchId, currentUser]);

  useEffect(() => {
    if (current?.id) {
      const win = windows.find(w => w.id === windowId);
      const fio = getEffectiveOperatorFio();
      if (fio) {
        recordTicketOperator(current.id, fio, win?.number, branchId, win?.id);
      }
    }
  }, [current?.id, windows, windowId, branchId, currentUser]);

  const assignedBranchId = (
    currentUser?.branchId ||
    (currentUser?.id && typeof localStorage !== 'undefined' ? localStorage.getItem(`operator_branch:${currentUser.id}`) : null) ||
    (currentUser?.email && typeof localStorage !== 'undefined' ? localStorage.getItem(`operator_branch:${currentUser.email}`) : null) ||
    ''
  );
  const isBranchLocked = currentUser?.role === 'employee';

  useEffect(() => {
    let active = true;
    api.listBranches().then(items => {
      if (!active) return;
      setBranches(items);
      const assigned = (
        currentUser?.branchId ||
        (currentUser?.id && typeof localStorage !== 'undefined' ? localStorage.getItem(`operator_branch:${currentUser.id}`) : null) ||
        (currentUser?.email && typeof localStorage !== 'undefined' ? localStorage.getItem(`operator_branch:${currentUser.email}`) : null)
      );
      const saved = assigned || localStorage.getItem('operator.branch');
      setBranchId(items.find(b => b.id === saved)?.id ?? items[0]?.id ?? '');
    }).catch(() => { if (active) setError('Не удалось загрузить отделения. Обновите страницу.'); });
    return () => { active = false; };
  }, [currentUser]);

  useEffect(() => {
    if (isBranchLocked && assignedBranchId && branchId !== assignedBranchId) {
      ++epoch.current;
      setReady(false);
      setCurrent(null);
      setBranchId(assignedBranchId);
      localStorage.setItem('operator.branch', assignedBranchId);
    }
  }, [isBranchLocked, assignedBranchId, branchId]);

  useEffect(() => {
    const handleBranchUpdated = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail && (detail.userId === currentUser?.id || detail.email === currentUser?.email)) {
        if (detail.branchId && detail.branchId !== branchId) {
          ++epoch.current;
          setReady(false);
          setCurrent(null);
          setBranchId(detail.branchId);
          localStorage.setItem('operator.branch', detail.branchId);
        }
      }
    };
    window.addEventListener('operator_branch_updated', handleBranchUpdated);
    return () => window.removeEventListener('operator_branch_updated', handleBranchUpdated);
  }, [currentUser?.id, currentUser?.email, branchId]);

  useEffect(() => {
    let active = true;
    setWindowId(''); setWindows([]); setServices([]); setServiceId(''); setCurrent(null); setReady(false);
    setTvQueue([]); setQueueTotal(0); setNextAppointment(null);
    if (!branchId) return;
    localStorage.setItem('operator.branch', branchId);
    Promise.all([api.listWindows(branchId), listServices(branchId)]).then(([items, catalog]) => {
      if (!active) return;
      setWindows(items); setServices(catalog);
      const saved = localStorage.getItem('operator.window:' + branchId);
      setWindowId(items.find(w => w.id === saved)?.id ?? items[0]?.id ?? '');
      setServiceId(catalog[0]?.id ?? '');
    }).catch(() => { if (active) setError('Не удалось загрузить окна. Проверьте сессию и обновите страницу.'); });
    return () => { active = false; };
  }, [branchId]);

  useEffect(() => {
    const generation = ++epoch.current;
    let timer: number;
    setCurrent(null); setReady(false);
    if (!windowId) return;
    localStorage.setItem('operator.window:' + branchId, windowId);

    async function poll() {
      try {
        const [ticket, items] = await Promise.all([api.getCurrentTicket(windowId), api.listWindows(branchId)]);
        if (epoch.current !== generation || busy.current) return;
        setCurrent(ticket); setWindows(items); setReady(true); setError('');

        if (ticket && ticket.status === 'CALLED') {
          lastAnnouncedTicketId.current = ticket.id;
        }

        // Refresh the bounded first page after every action and during polling.
        if (branchId) {
          try {
            const tvRes = await fetch(`/api/v1/admin/branches/${encodeURIComponent(branchId)}/queue`, { credentials: 'include' });
            if (tvRes.ok) {
              const tvData = await tvRes.json();
              if (epoch.current === generation) {
                if (Array.isArray(tvData?.items)) {
                  setTvQueue(tvData.items);
                  setQueueTotal(tvData.total);
                }
                setNextAppointment(tvData?.nextAppointment ?? null);
              }
            }
          } catch {}
        }
      } catch (err: unknown) {
        if (epoch.current === generation) {
          setReady(false);
          const isAuth = err instanceof OperatorApiError && err.status === 401;
          setError(
            isAuth
              ? 'Сессия оператора истекла. Войдите в систему повторно.'
              : 'Не удалось обновить окно. Проверьте соединение с сервером.'
          );
        }
      } finally {
        if (epoch.current === generation) timer = window.setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => { ++epoch.current; clearTimeout(timer); };
  }, [branchId, windowId, revision]);

  // Timer counter
  useEffect(() => {
    if (!current || (current.status !== 'CALLED' && current.status !== 'SERVING')) {
      setElapsedSeconds(0);
      return;
    }
    const startTime = current.serviceStartedAt
      ? new Date(current.serviceStartedAt).getTime()
      : current.calledAt
      ? new Date(current.calledAt).getTime()
      : Date.now();

    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      setElapsedSeconds(diff);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [current?.id, current?.status, current?.calledAt, current?.serviceStartedAt]);

  async function act(action: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true; ++epoch.current; setPending(true); setError(''); setNotice('');
    try {
      await action();
    } catch (err) {
      const code = err instanceof OperatorApiError ? err.code : '';
      if (code === 'NO_ELIGIBLE_TICKETS') {
        setNotice('Сейчас нет доступных талонов в очереди.');
      } else if (code === 'WINDOW_BUSY') {
        setNotice('Окно занято. Завершите обслуживание или отметьте неявку текущего клиента перед вызовом следующего.');
      } else if (code === 'WINDOW_CLOSED') {
        setNotice('Окно закрыто. Откройте окно для вызова клиентов.');
      } else if (code === 'INVALID_TICKET_STATE') {
        setNotice('Недопустимый статус талона для этой операции.');
      } else if (code === 'NO_OPEN_COMPATIBLE_WINDOW') {
        setNotice('Данное окно не обслуживает услугу выбранного талона. Подключите услугу в настройках окна.');
      } else if (code === 'NOT_FOUND') {
        setNotice('Талон не найден в отделении или уже был обслужен/отменен.');
      } else {
        setNotice(
          'Операция не выполнена. Состояние окна будет обновлено; проверьте сессию при повторной ошибке.'
        );
      }
    } finally {
      busy.current = false;
      setPending(false);
      setRevision(n => n + 1);
    }
  }

  const selected = windows.find(w => w.id === windowId);

  // Переключение услуги окна (window_services). Набор не может стать пустым.
  // С миграции 000012 услугу можно отключить всегда — даже если окно уже
  // обслуживало по ней талоны; ветка 409 ниже оставлена как защитный fallback.
  async function toggleWindowService(serviceId: string) {
    if (!selected || busy.current) return;
    const currentIds = selected.services.map(s => s.id);
    const nextIds = currentIds.includes(serviceId)
      ? currentIds.filter(id => id !== serviceId)
      : [...currentIds, serviceId];
    if (nextIds.length === 0) {
      setNotice('У окна должна остаться доступной хотя бы одна услуга.');
      return;
    }
    busy.current = true; ++epoch.current; setPending(true); setError(''); setNotice('');
    try {
      const updated = await updateWindowServices(selected.id, nextIds);
      setWindows(prev => prev.map(w => (w.id === updated.id ? { ...w, services: updated.services } : w)));
      setNotice(`Окно № ${updated.number}: список услуг обновлён.`);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 409) {
        setNotice('Услугу нельзя отключить: в этом окне уже обслуживали талоны с такой услугой.');
      } else if (err instanceof AdminApiError && err.status === 404) {
        setNotice('Окно не найдено. Обновите страницу и попробуйте снова.');
      } else if (err instanceof AdminApiError && (err.status === 401 || err.status === 403)) {
        setError('Недостаточно прав или сессия истекла. Войдите заново и повторите попытку.');
      } else {
        setNotice('Не удалось сохранить список услуг окна. Проверьте соединение и попробуйте снова.');
      }
    } finally {
      busy.current = false;
      setPending(false);
      setRevision(n => n + 1);
    }
  }

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  async function callSpecificTicket(publicNum: string) {
    if (busy.current || !windowId) return;
    void act(async () => {
      if (publicNum.startsWith('A-')) {
        try {
          await arriveAppointment(publicNum);
        } catch {
          setNotice('Не удалось подтвердить прибытие. Попробуйте ещё раз.');
        }
      }
      const ticket = await api.callNext(windowId, publicNum);
      const targetNum = ticket?.publicNumber || publicNum;
      if (ticket) {
        lastAnnouncedTicketId.current = ticket.id;
        const fio = getEffectiveOperatorFio();
        if (fio && selected) {
          recordTicketOperator(ticket.id, fio, selected.number, branchId, selected.id);
        }
      }
      if (selected) {
        broadcastTicketCallToTV(targetNum, selected.number, false, branchId);
      }
    });
  }

  const isMultiRow = windows.length > 10;
  const containerHeightClass = isMultiRow ? 'min-h-[82px]' : 'min-h-[48px]';

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* 1. TOP WORKSTATION CARD */}
      <section className="bg-white rounded-3xl border border-[#D2D8E2] p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#003B73] text-white font-mono font-black text-2xl flex items-center justify-center shadow-md shrink-0">
              {`№${selected?.number ?? '—'}`}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="font-black text-lg text-slate-900 tracking-tight">
                  {selected ? `Окно №${selected.number}` : 'Рабочее место оператора'}
                </h1>
                {selected && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${
                      selected.status === 'OPEN'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : 'bg-slate-200 text-slate-700 border-slate-300'
                    }`}
                  >
                    {selected.status === 'OPEN' ? 'СМЕНА АКТИВНА' : 'ОКНО ЗАКРЫТО'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Оператор:{' '}
                <strong className="text-slate-800">
                  {currentUser?.fio || currentUser?.email || 'operator@pochta.local'}
                </strong>{' '}
                {selected && `· Отделение: ${branches.find(b => b.id === branchId)?.name || 'Почта России'}`}
              </p>
            </div>
          </div>

          {/* Branch and Window Selectors + Shift Toggle */}
          <div className="flex flex-wrap items-start justify-start gap-3 w-full">
            {/* Branch Selector */}
            <div className="flex flex-col shrink-0">
              <div className="flex items-center gap-1.5 mb-1 pl-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Отделение</span>
                {isBranchLocked && (
                  <span
                    title="Почтовое отделение назначено администратором и зафиксировано для оператора"
                    className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 select-none"
                  >
                    <Lock className="w-2.5 h-2.5" /> Назначено
                  </span>
                )}
              </div>
              <div className={`${containerHeightClass} flex items-center`}>
                <SearchableBranchSelect
                  branches={branches}
                  selectedId={branchId}
                  disabled={isBranchLocked || pending}
                  disabledTooltip={
                    isBranchLocked
                      ? 'Почтовое отделение назначено администратором и зафиксировано для вашей учётной записи'
                      : undefined
                  }
                  onSelect={newBranchId => {
                    if (newBranchId === branchId) return;
                    ++epoch.current;
                    setReady(false);
                    setCurrent(null);
                    setBranchId(newBranchId);
                  }}
                  className="min-w-[240px]"
                  dropdownAlign="left"
                />
              </div>
            </div>

            {/* Quick Window Buttons (1 строка до 10 окон включительно, 2 строки если >10 окон: 1 3 5... / 2 4 6...) */}
            <div className="flex flex-col min-w-0 flex-1 max-w-full">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 pl-1">
                Окно {windows.length > 5 ? `(${windows.length})` : ''}
              </span>
              <div
                className={
                  isMultiRow
                    ? 'grid grid-rows-[repeat(2,36px)] grid-flow-col auto-cols-max gap-1.5 overflow-x-auto max-w-full py-1 px-0.5 scrollbar-thin'
                    : 'flex items-center gap-1.5 overflow-x-auto max-w-full min-h-[48px] py-1 px-0.5 scrollbar-thin'
                }
              >
              {windows.slice().sort((a, b) => a.number - b.number).map(w => (
                <button
                  key={w.id}
                  ref={windowId === w.id ? activeWindowRef : null}
                  type="button"
                  onClick={() => {
                    if (w.id === windowId) return;
                    ++epoch.current;
                    setReady(false);
                    setCurrent(null);
                    setWindowId(w.id);
                  }}
                  className={`rounded-xl border shadow-xs transition-all flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 h-9 px-3 text-xs font-semibold ${
                    windowId === w.id
                      ? 'bg-[#003B73] text-white border-[#003B73] ring-2 ring-[#003B73]/20 shadow-xs font-bold'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400'
                  }`}
                >
                  Окно {w.number}
                  <span
                    className={`rounded-full shrink-0 w-2 h-2 ${
                      w.status === 'OPEN'
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]'
                        : 'bg-slate-300'
                    }`}
                  ></span>
                </button>
              ))}
              </div>
            </div>

            {/* Shift Open/Close Button */}
            {selected && (
              <div className="flex flex-col shrink-0">
                <span aria-hidden="true" className="text-[10px] font-bold uppercase tracking-wider mb-1 pl-1 invisible select-none">Смена</span>
                <div className={`${containerHeightClass} flex items-center`}>
                  <button
                    type="button"
                    disabled={pending || !ready}
                    onClick={() =>
                      void act(() =>
                        changeWindowStatus(windowId, selected.status === 'OPEN' ? 'CLOSED' : 'OPEN')
                      )
                    }
                    className={`h-10 px-4 rounded-xl border shadow-xs text-xs font-bold flex items-center justify-center whitespace-nowrap overflow-visible shrink-0 transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                      selected.status === 'OPEN'
                        ? 'text-red-700 border-red-200 bg-red-50 hover:bg-red-100 focus:ring-red-500'
                        : 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 focus:ring-emerald-500'
                    }`}
                  >
                    {selected.status === 'OPEN' ? 'Закрыть окно' : 'Открыть окно'}
                  </button>
                </div>
              </div>
            )}

            {/* Direct Link to TV Board for this Branch */}
            {branchId && (
              <div className="flex flex-col shrink-0">
                <span aria-hidden="true" className="text-[10px] font-bold uppercase tracking-wider mb-1 pl-1 invisible select-none">ТВ</span>
                <div className={`${containerHeightClass} flex items-center`}>
                  <a
                    href={`/tv/${getBranchPostalCode(branchId, branches.find(b => b.id === branchId)?.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-10 px-4 rounded-xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100/80 text-[#003B73] flex items-center justify-center gap-1.5 text-xs font-bold transition-all shadow-xs shrink-0"
                    title={`Открыть табло вызова зала (ТВ) для отделения ${branches.find(b => b.id === branchId)?.name || ''} в отдельной вкладке`}
                  >
                    <Tv className="w-4 h-4 text-[#003B73] shrink-0" />
                    <span>Табло зала (ТВ)</span>
                  </a>
                </div>
              </div>
            )}

            {/* Ближайший слот предварительной записи */}
            {branchId && (
              <div className="flex flex-col shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider mb-1 pl-1 text-slate-500">
                  Ближайшая запись
                </span>
                <div className={`${containerHeightClass} flex items-center`}>
                  {nextAppointment ? (
                    <div
                      className="h-10 px-4 rounded-xl border border-blue-200 bg-blue-50/70 text-[#003B73] flex items-center justify-center gap-2 text-xs font-bold transition-all shadow-xs shrink-0"
                      title={`Ближайший слот предварительной записи: ${formatMoscowTime(nextAppointment.scheduledAt, { second: undefined })}, записано: ${nextAppointment.count} чел.`}
                    >
                      <Calendar className="w-4 h-4 text-[#003B73] shrink-0" />
                      <span>{formatMoscowTime(nextAppointment.scheduledAt, { second: undefined })}</span>
                      <span className="bg-[#003B73] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {nextAppointment.count} чел.
                      </span>
                    </div>
                  ) : (
                    <div
                      className="h-10 px-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 flex items-center justify-center gap-1.5 text-xs font-bold transition-all shadow-xs shrink-0"
                      title="Нет предстоящих предварительных записей"
                    >
                      <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>Записей нет</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Window Services List — чипы-переключатели услуг окна */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-500">Услуги окна:</span>
            {services.map(srv => {
              const isEnabled = selected?.services.some(ws => ws.id === srv.id) ?? false;
              return (
                <button
                  key={srv.id}
                  type="button"
                  aria-pressed={isEnabled}
                  disabled={pending || !selected}
                  title={
                    isEnabled
                      ? `Отключить услугу «${srv.name}» для этого окна`
                      : `Включить услугу «${srv.name}» для этого окна`
                  }
                  onClick={() => void toggleWindowService(srv.id)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-all ${
                    isEnabled
                      ? 'bg-blue-50/70 border-blue-200 text-[#054FA6] hover:bg-blue-100'
                      : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'
                  } ${pending || !selected ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {isEnabled ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                  <span className={isEnabled ? '' : 'line-through'}>{srv.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between">
          <span>{error}</span>
          <a href="/operator/login" className="underline font-bold">Вход</a>
        </div>
      )}

      {notice && (
        <div role="status" className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-[#054FA6] text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* 2. MAIN WORK AREA (2 COLUMNS: 7 / 5) */}
      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: 7 cols - Active Client Card & Primary Controls */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold">
                  Текущий клиент у стойки Окна № {selected.number}
                </div>
                {current && (
                  <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-800 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                    <Clock className="w-4 h-4 text-[#003B73]" />
                    <span>{formatTimer(elapsedSeconds)}</span>
                  </div>
                )}
              </div>

              {!ready ? (
                <div className="py-12 text-center text-slate-400 font-mono text-xs animate-pulse" role="status">
                  Обновляем окно…
                </div>
              ) : (
                <>
                  <TicketCard ticket={current} selectedWindow={selected} services={services} />

                  <div className="pt-2">
                    <ActionControls
                      currentTicket={current}
                      isPending={pending || !ready}
                      onCallNext={() =>
                        void act(async () => {
                          try {
                            const ticket = await api.callNext(windowId);
                            if (ticket) {
                              lastAnnouncedTicketId.current = ticket.id;
                              const fio = getEffectiveOperatorFio();
                              if (fio && selected) {
                                recordTicketOperator(ticket.id, fio, selected.number, branchId, selected.id);
                              }
                              if (selected) {
                                broadcastTicketCallToTV(ticket.publicNumber, selected.number, false, branchId);
                              }
                            }
                          } catch (err) {
                            if (err instanceof OperatorApiError && err.code === 'NO_ELIGIBLE_TICKETS' && tvQueue.length > 0) {
                              const nextApt = tvQueue.find(t => t.publicNumber.startsWith('A-'));
                              if (nextApt) {
                                try {
                                  await arriveAppointment(nextApt.publicNumber);
                                  const ticket = await api.callNext(windowId);
                                  if (ticket) {
                                    lastAnnouncedTicketId.current = ticket.id;
                                    const fio = getEffectiveOperatorFio();
                                    if (fio && selected) {
                                      recordTicketOperator(ticket.id, fio, selected.number, branchId, selected.id);
                                    }
                                    if (selected) {
                                      broadcastTicketCallToTV(ticket.publicNumber, selected.number, false, branchId);
                                    }
                                  }
                                  return;
                                } catch {
                                  setNotice('Не удалось подтвердить прибытие. Попробуйте ещё раз.');
                                }
                              }
                            }
                            throw err;
                          }
                        })
                      }
                      onRepeatCall={() => {
                        if (current && selected) {
                          broadcastTicketCallToTV(current.publicNumber, selected.number, true, branchId);
                          setNotice(`Повторный вызов талона ${current.publicNumber} отправлен на табло зала`);
                        }
                      }}
                      onStartService={() => {
                        if (current && selected) {
                          const fio = getEffectiveOperatorFio();
                          if (fio) {
                            recordTicketOperator(current.id, fio, selected.number, branchId, selected.id);
                          }
                        }
                        current && void act(() => api.startService(current.id));
                      }}
                      onCompleteService={() => {
                        if (current && selected) {
                          const fio = getEffectiveOperatorFio();
                          if (fio) {
                            recordTicketOperator(current.id, fio, selected.number, branchId, selected.id);
                          }
                        }
                        current && void act(() => api.completeService(current.id));
                      }}
                      onNoShow={() => current && void act(() => api.markNoShow(current.id))}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Secondary Service Operations Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Issue LIVE Ticket Card */}
              <div className="p-4 rounded-3xl bg-white border border-[#D2D8E2] shadow-sm space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                  <UserPlus className="w-4 h-4 text-[#054FA6]" />
                  <span>Живая очередь</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Выдача талона клиенту без мобильного устройства
                </p>
                <div className="space-y-2">
                  <label className="block text-[11px] font-bold text-slate-600">
                    Услуга
                    <select
                      value={serviceId}
                      disabled={pending}
                      onChange={e => setServiceId(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                    >
                      {services.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={pending || !serviceId}
                    onClick={() =>
                      void act(async () => {
                        const selection = branchId + ':' + serviceId;
                        if (liveKey.current?.selection !== selection) {
                          liveKey.current = { selection, key: crypto.randomUUID() };
                        }
                        const selectedSvc = services.find(s => s.id === serviceId);
                        const ticket = await api.createLiveTicket(branchId, serviceId, liveKey.current.key);
                        if (!ticket.serviceName && selectedSvc) {
                          ticket.serviceName = selectedSvc.name;
                        }
                        liveKey.current = null;
                        setNotice('Выдан талон ' + ticket.publicNumber + (ticket.serviceName ? ` (${ticket.serviceName})` : ''));
                      })
                    }
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-blue-50 border border-[#054FA6] text-[#054FA6] hover:bg-blue-100 font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    Выдать LIVE-талон
                  </button>
                </div>
              </div>

              {/* Auxiliary Transfer / Return Card */}
              <div className="p-4 rounded-3xl bg-white border border-[#D2D8E2] shadow-sm space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                    <ArrowRightLeft className="w-4 h-4 text-[#003B73]" />
                    <span>Управление талоном</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Возврат в общую очередь или перевод к другому специалисту
                  </p>
                </div>
                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    disabled={!current || pending}
                    onClick={() => {
                      if (!current) return;
                      void act(async () => {
                        await api.returnTicket(current.id);
                        setNotice(`Талон ${current.publicNumber} возвращен в очередь`);
                      });
                    }}
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-40 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Вернуть в очередь</span>
                  </button>
                  <button
                    type="button"
                    disabled={!current || pending}
                    onClick={() => {
                      if (!current) return;
                      setRedirectServiceId('');
                      setRedirectWindowId('');
                      setShowRedirectModal(true);
                    }}
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-40 transition-colors"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-slate-500" />
                    <span>Перенаправить в другое окно</span>
                  </button>
                </div>
              </div>

              {/* Incident / Problem Logging Card */}
              <div className="p-4 rounded-3xl bg-white border border-[#D2D8E2] shadow-sm space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                    <AlertTriangle className="w-4 h-4 text-[#D92534]" />
                    <span>Инцидент / Сбой</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Фиксация технических неполадок оборудования или сбоев смены
                  </p>
                </div>
                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    disabled={pending || !selected}
                    onClick={() => setShowIncidentModal(true)}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-[#D92534] hover:bg-red-100 font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Зафиксировать сбой</span>
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column: 5 cols - Queue Side Panel */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-[#D2D8E2] p-5 space-y-3 shadow-sm flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#003B73]" />
                  <span>Очередь отделения</span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  {branches.find(b => b.id === branchId)?.name || 'Текущее отделение'}
                </p>
              </div>
              <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-[#054FA6] border border-blue-200">
                {queueTotal} в очереди
              </span>
            </div>

            {queueTotal > tvQueue.length && <p className="text-xs text-slate-500">Первые {tvQueue.length} из {queueTotal}. Список обновляется автоматически.</p>}
            {tvQueue.length > 0 ? (
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {tvQueue.map((item, idx) => {
                  const isApt = item.source === 'APPOINTMENT' || item.publicNumber.startsWith('A-');
                  const isQr = item.source === 'QR' || item.publicNumber.startsWith('Q-');
                  return (
                    <div
                      key={item.publicNumber + '-' + idx}
                      className={`p-3 rounded-2xl border text-xs flex items-center justify-between transition-all ${
                        idx === 0
                          ? 'bg-blue-50/70 border-blue-200 ring-1 ring-blue-400'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-slate-900 text-sm">
                            {item.publicNumber}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border ${
                              isApt
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                : isQr
                                ? 'bg-sky-50 text-[#054FA6] border-sky-200'
                                : 'bg-amber-50 text-amber-900 border-amber-200'
                            }`}
                          >
                            {isApt ? 'Запись' : isQr ? 'QR-код' : 'Живая'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 font-medium">
                          {item.serviceName || services.find(s => s.id === (item as any).serviceId)?.name || 'Услуга не определена'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-slate-500">
                          {idx === 0 ? 'Следующий' : `Ожидает (#${idx + 1})`}
                        </span>
                        {selected?.status === 'OPEN' && !current && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void callSpecificTicket(item.publicNumber)}
                            className="px-2 py-1 bg-[#003B73] hover:bg-[#054FA6] text-white text-[10px] font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
                          >
                            Вызвать
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16 space-y-2 text-slate-400 flex-1 flex flex-col items-center justify-center">
                <Layers className="w-8 h-8 mx-auto stroke-1" />
                <p className="text-xs font-bold text-slate-600">Очередь свободна</p>
                <p className="text-[11px] text-slate-400 max-w-xs">
                  В данный момент нет ожидающих клиентов для выбранного профиля
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Redirect Modal */}
      {showRedirectModal && current && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                  Перенаправление
                </span>
                <h3 className="text-base font-black text-slate-900">
                  Талон {current.publicNumber}
                </h3>
              </div>
              <span
                className={`text-[11px] px-2.5 py-1 rounded-lg font-mono font-bold border ${
                  current.source === 'APPOINTMENT'
                    ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                    : current.source === 'QR'
                    ? 'bg-sky-50 text-[#054FA6] border-sky-200'
                    : 'bg-amber-50 text-amber-900 border-amber-200'
                }`}
              >
                {current.source === 'APPOINTMENT'
                  ? 'Предварительная запись'
                  : current.source === 'QR'
                  ? 'QR-код'
                  : 'Живая очередь'}
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Выберите целевое окно или услугу для перевода клиента. Талон будет направлен на обслуживание.
            </p>

            <div className="space-y-3">
              {/* Target Window */}
              <label className="block text-xs font-bold text-slate-700">
                Целевое окно
                <select
                  value={redirectWindowId}
                  onChange={e => setRedirectWindowId(e.target.value)}
                  className="mt-1 block w-full px-3 py-2.5 text-xs rounded-xl border border-slate-300 bg-white font-medium shadow-2xs"
                >
                  <option value="">Любое подходящее окно (общая очередь)</option>
                  {windows
                    .filter(w => w.id !== windowId)
                    .map(w => (
                      <option key={w.id} value={w.id}>
                        Окно № {w.number} · {w.status === 'OPEN' ? 'Смена открыта' : 'Закрыто'}
                      </option>
                    ))}
                </select>
              </label>

              {/* Service */}
              <label className="block text-xs font-bold text-slate-700">
                Услуга
                <select
                  value={redirectServiceId}
                  onChange={e => setRedirectServiceId(e.target.value)}
                  className="mt-1 block w-full px-3 py-2.5 text-xs rounded-xl border border-slate-300 bg-white font-medium shadow-2xs"
                >
                  <option value="">
                    Без изменения услуги ({services.find(s => s.id === current.serviceId)?.name || 'текущая'})
                  </option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowRedirectModal(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:bg-slate-50 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRedirectModal(false);
                  const targetWin = windows.find(w => w.id === redirectWindowId);
                  const targetSvc = services.find(s => s.id === redirectServiceId);
                  void act(async () => {
                    await api.redirectTicket(
                      current.id,
                      redirectServiceId || undefined,
                      redirectWindowId || undefined
                    );
                    const targetText = targetWin ? `в Окно №${targetWin.number}` : 'в очередь';
                    const svcText = targetSvc ? ` на услугу «${targetSvc.name}»` : '';
                    setNotice(`Талон ${current.publicNumber} успешно перенаправлен ${targetText}${svcText}`);
                  });
                }}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-[#003B73] hover:bg-[#054FA6] text-white shadow-sm transition-colors"
              >
                Перенаправить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incident Modal */}
      {showIncidentModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-[#D92534] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>Регистрация инцидента / проблемы</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowIncidentModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Информация будет сохранена в журнале начальника ОПС и привязана к текущему окну и отделению.
            </p>

            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-700">
                Категория проблемы
                <select
                  value={incidentCategory}
                  onChange={e => setIncidentCategory(e.target.value)}
                  className="mt-1 block w-full px-3 py-2.5 text-xs rounded-xl border border-slate-300 bg-white font-medium shadow-2xs"
                >
                  <option value="Сбой оборудования">Сбой оборудования (сканер / принтер / весы)</option>
                  <option value="Сбой сети / ПО">Зависание ПО / локальной сети ОПС</option>
                  <option value="Расходные материалы">Закончились коробки / упаковка / бумага</option>
                  <option value="Конфликтная ситуация">Конфликтная ситуация / вызов старшего</option>
                  <option value="Другое">Другое операционное отклонение</option>
                </select>
              </label>

              <label className="block text-xs font-bold text-slate-700">
                Описание неполадки
                <textarea
                  rows={3}
                  value={incidentDescription}
                  onChange={e => setIncidentDescription(e.target.value)}
                  placeholder="Опишите симптомы проблемы (например: сканер ШПИ не отвечает, переподключение не помогло)..."
                  className="mt-1 block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium shadow-2xs"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={incidentSubmitting}
                onClick={() => setShowIncidentModal(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 hover:bg-slate-50 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={incidentSubmitting || !incidentDescription.trim()}
                onClick={async () => {
                  if (!incidentDescription.trim() || !branchId) return;
                  setIncidentSubmitting(true);
                  try {
                    await api.reportIncident(branchId, {
                      windowId: windowId || undefined,
                      category: incidentCategory,
                      description: incidentDescription.trim(),
                    });
                    setNotice('Инцидент успешно зафиксирован и передан в журнал начальника ОПС');
                    setShowIncidentModal(false);
                    setIncidentDescription('');
                  } catch (e: any) {
                    setError('Не удалось сохранить инцидент: ' + (e.message || 'Ошибка сети'));
                  } finally {
                    setIncidentSubmitting(false);
                  }
                }}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-[#D92534] hover:bg-red-700 text-white shadow-sm transition-colors disabled:opacity-50"
              >
                {incidentSubmitting ? 'Отправка...' : 'Отправить в журнал'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

