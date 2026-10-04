import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Clock, Calendar, MapPin, ArrowRight, Home, RefreshCw } from 'lucide-react';
import * as api from '../api/client/clientApi';
import type { Ticket, Branch } from '../api/client/types';

export function AppointmentConfirmPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'success' | 'already_confirmed' | 'expired' | 'invalid' | 'loading'>('loading');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramTicketId = params.get('ticketId') || '';
    const paramToken = params.get('token') || '';
    const paramStatus = params.get('status');
    const paramError = params.get('error');

    const handleConfirm = async () => {
      // 1. Direct error in query
      if (paramError === 'expired') {
        setStatus('expired');
        setLoading(false);
        return;
      }
      if (paramError === 'invalid' || paramError === 'missing_token') {
        setStatus('invalid');
        setLoading(false);
        return;
      }

      // 2. Direct success in query
      if (paramStatus === 'success') {
        setStatus('success');
        if (paramTicketId) {
          try {
            const loaded = await api.getTicket(paramTicketId);
            setTicket(loaded);
            persistTicketToStorage(loaded);
            try {
              const branches = await api.listBranches();
              const b = branches.find(item => item.id === loaded.branchId);
              if (b) setBranch(b);
            } catch {}
          } catch {}
        }
        setLoading(false);
        return;
      }

      // 3. Token provided -> call backend to confirm
      if (paramToken) {
        try {
          const confirmed = await api.confirmAppointment(paramTicketId || undefined, paramToken);
          setTicket(confirmed);
          persistTicketToStorage(confirmed);
          setStatus('success');

          try {
            const branches = await api.listBranches();
            const b = branches.find(item => item.id === confirmed.branchId);
            if (b) setBranch(b);
          } catch {}
        } catch (err: any) {
          if (err?.code === 'APPOINTMENT_EXPIRED' || err?.message?.includes('истёк') || err?.message?.includes('expired')) {
            setStatus('expired');
          } else if (err?.status === 404 || err?.code === 'INVALID_CODE') {
            setStatus('invalid');
          } else {
            setStatus('invalid');
            setErrorMessage(err?.message || 'Не удалось подтвердить запись');
          }
        } finally {
          setLoading(false);
        }
        return;
      }

      // 4. No token and no status -> invalid
      setStatus('invalid');
      setLoading(false);
    };

    void handleConfirm();
  }, []);

  const persistTicketToStorage = (t: Ticket) => {
    try {
      const scope = 'anonymous';
      const key = `client.tickets:${scope}`;
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key) || '[]';
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [];
      if (!list.includes(t.id)) {
        list.push(t.id);
        const serialized = JSON.stringify(list);
        localStorage.setItem(key, serialized);
        sessionStorage.setItem(key, serialized);
      }
    } catch {}
  };

  const navigateTo = (path: string) => {
    window.location.href = path;
  };

  if (loading || status === 'loading') {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
        <div className="p-8 rounded-3xl bg-white border border-slate-200/80 shadow-md text-center max-w-md w-full space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-[#003B73] border-t-transparent animate-spin mx-auto" />
          <h2 className="text-xl font-black text-[#031E56]">Подтверждаем запись...</h2>
          <p className="text-xs text-slate-500">Проверяем ключ подтверждения и бронируем слот визита</p>
        </div>
      </div>
    );
  }

  if (status === 'success' || status === 'already_confirmed') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-4">
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-emerald-200 shadow-xl max-w-lg w-full space-y-6 text-center animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
            <CheckCircle2 size={36} />
          </div>

          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
              {status === 'already_confirmed' ? 'Запись уже подтверждена' : 'Запись успешно подтверждена'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#031E56] tracking-tight">
              Ваш визит забронирован
            </h1>
            <p className="text-xs sm:text-sm text-slate-600">
              Мы ждём вас в выбранное время в отделении Почты России.
            </p>
          </div>

          {ticket && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-left space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                <span className="text-xs font-semibold text-slate-500">Номер талона</span>
                <span className="font-mono text-xl font-black text-[#003B73]">{ticket.publicNumber}</span>
              </div>
              {branch && (
                <div className="flex items-start gap-2.5 text-xs text-slate-700">
                  <MapPin size={16} className="text-[#054FA6] shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-slate-900">{branch.name}</div>
                    <div className="text-slate-500 text-[11px]">{branch.address}</div>
                  </div>
                </div>
              )}
              {ticket.scheduledAt && (
                <div className="flex items-center gap-2.5 text-xs text-slate-700">
                  <Calendar size={16} className="text-[#054FA6] shrink-0" />
                  <div>
                    <span className="font-semibold text-slate-900">
                      {new Date(ticket.scheduledAt).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        weekday: 'short',
                      })}
                    </span>
                    {' в '}
                    <span className="font-black text-[#003B73]">
                      {new Date(ticket.scheduledAt).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigateTo('/')}
              className="flex-1 min-h-[48px] py-3 bg-[#003B73] hover:bg-[#054FA6] active:bg-[#00274D] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2"
            >
              <span>Перейти к талону</span>
              <ArrowRight size={16} />
            </button>
            <button
              type="button"
              onClick={() => navigateTo('/')}
              className="min-h-[48px] px-5 py-3 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-2"
            >
              <Home size={15} />
              <span>На главную</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-4">
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-rose-200 shadow-xl max-w-lg w-full space-y-6 text-center animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
            <Clock size={36} />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-rose-50 text-rose-800 border border-rose-200">
              15 минут истекли
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#031E56] tracking-tight">
              Срок подтверждения истёк
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 max-w-sm mx-auto leading-relaxed">
              Время на подтверждение записи (15 минут) закончилось, и выбранный слот был освобождён.
              Пожалуйста, выберите удобное время повторно.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => navigateTo('/')}
              className="w-full min-h-[48px] py-3 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2"
            >
              <RefreshCw size={15} />
              <span>Выбрать время повторно</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // status === 'invalid'
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-4">
      <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-amber-200 shadow-xl max-w-lg w-full space-y-6 text-center animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-amber-100 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-inner">
          <AlertCircle size={36} />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
            Недействительная ссылка
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-[#031E56] tracking-tight">
            Ссылка недействительна
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 max-w-sm mx-auto leading-relaxed">
            {errorMessage || 'Эта ссылка для подтверждения недействительна или уже была использована ранее.'}
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => navigateTo('/')}
            className="w-full min-h-[48px] py-3 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2"
          >
            <Home size={15} />
            <span>Вернуться на главную</span>
          </button>
        </div>
      </div>
    </div>
  );
}
