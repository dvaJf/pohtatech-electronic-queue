import React, { useState, useEffect, useRef } from 'react';
import { Mail, Clock, ShieldCheck, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Ticket, Branch } from '../../api/client/types';
import * as api from '../../api/client/clientApi';

export interface AppointmentConfirmationCardProps {
  ticket: Ticket;
  branch?: Branch;
  onConfirmed: (ticket: Ticket) => void;
  onCancelled?: () => void;
}

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local[0]}*@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function AppointmentConfirmationCard({
  ticket,
  branch,
  onConfirmed,
  onCancelled,
}: AppointmentConfirmationCardProps) {
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Expiration calculation: 15 minutes from createdAt or confirmationExpiresAt
  const expiresAtMs = ticket.confirmationExpiresAt
    ? new Date(ticket.confirmationExpiresAt).getTime()
    : new Date(ticket.createdAt).getTime() + 15 * 60 * 1000;

  const [timeLeftSec, setTimeLeftSec] = useState(() => {
    return Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
  });

  // Countdown timer
  useEffect(() => {
    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
      setTimeLeftSec(remaining);
      if (remaining === 0 && onCancelled) {
        onCancelled();
      }
    };
    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [expiresAtMs, onCancelled]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  // Polling to detect if confirmed via email link in another tab
  useEffect(() => {
    let active = true;
    const checkStatus = async () => {
      try {
        const fresh = await api.getTicket(ticket.id);
        if (active && fresh.status !== 'PENDING_CONFIRMATION') {
          onConfirmed(fresh);
        }
      } catch {
        // ignore polling errors
      }
    };

    const interval = window.setInterval(checkStatus, 2500);
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        void checkStatus();
      }
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('visibilitychange', handleFocus);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleFocus);
    };
  }, [ticket.id, onConfirmed]);

  const handleConfirm = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = code.trim().replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      setError('Введите 6 цифр кода подтверждения');
      return;
    }
    if (timeLeftSec <= 0) {
      setError('Срок действия бронирования истёк. Пожалуйста, оформите запись заново.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const confirmedTicket = await api.confirmAppointment(ticket.id, cleanCode);
      onConfirmed(confirmedTicket);
    } catch (err: any) {
      setError(err?.message || 'Неверный код подтверждения или срок действия истёк');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return;
    setIsResending(true);
    setError(null);
    setResendNotice(null);
    try {
      await api.resendAppointmentConfirmation(ticket.id);
      setResendNotice('Новый код отправлен на ваш email');
      setResendCooldown(30);
    } catch (err: any) {
      setError(err?.message || 'Не удалось повторно отправить код. Попробуйте позже.');
    } finally {
      setIsResending(false);
    }
  };

  const minutes = Math.floor(timeLeftSec / 60);
  const seconds = timeLeftSec % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isExpired = timeLeftSec <= 0;

  return (
    <div
      data-testid="appointment-confirmation-card"
      className="p-5 sm:p-6 rounded-3xl bg-white border-2 border-[#003B73]/20 shadow-md space-y-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase bg-amber-100 text-amber-900 border border-amber-200">
            <Clock size={12} className="animate-spin-slow" />
            <span>Ожидает подтверждения</span>
          </div>
          <h3 className="text-lg font-black text-[#031E56]">
            Подтвердите вашу запись
          </h3>
          <p className="text-xs text-slate-600">
            {branch?.name || 'Почтовое отделение'} · Талон{' '}
            <strong className="text-[#003B73] font-mono">{ticket.publicNumber}</strong>
          </p>
        </div>

        {/* 15-Minute Countdown Timer */}
        <div className={`shrink-0 px-3 py-2 rounded-2xl border text-center ${
          isExpired
            ? 'bg-rose-50 border-rose-200 text-rose-700'
            : timeLeftSec < 180
            ? 'bg-amber-50 border-amber-200 text-amber-700 animate-pulse'
            : 'bg-blue-50 border-blue-200 text-[#003B73]'
        }`}>
          <div className="text-xl sm:text-2xl font-black font-mono leading-none">
            {formattedTime}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5">
            {isExpired ? 'Истекло' : 'Осталось'}
          </div>
        </div>
      </div>

      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3 text-xs text-slate-700">
        <Mail size={20} className="shrink-0 text-[#054FA6]" />
        <div className="min-w-0">
          <p className="leading-snug">
            Мы отправили письмо с кодом и ссылкой на{' '}
            <strong className="font-semibold text-slate-900">
              {maskEmail(ticket.notificationEmail || '') || 'ваш email'}
            </strong>
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Слот забронирован на 15 минут. Если не подтвердить, он освободится.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-800">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {resendNotice && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2 text-xs text-emerald-800">
          <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-600" />
          <span>{resendNotice}</span>
        </div>
      )}

      <form onSubmit={handleConfirm} className="space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor="verification-code-input"
            className="block text-xs font-bold text-slate-700"
          >
            6-значный код из письма
          </label>
          <input
            id="verification-code-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            disabled={isSubmitting || isExpired}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(val);
              if (error) setError(null);
            }}
            placeholder="000000"
            className="w-full h-12 px-4 rounded-xl border-2 border-slate-200 text-center font-mono text-xl tracking-[0.4em] font-bold text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-[#003B73] transition-colors"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || code.trim().length !== 6 || isExpired}
          className="w-full min-h-[48px] py-3 bg-[#003B73] hover:bg-[#054FA6] active:bg-[#00274D] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              <span>Проверка кода...</span>
            </>
          ) : (
            <>
              <ShieldCheck size={16} />
              <span>Подтвердить бронь</span>
            </>
          )}
        </button>
      </form>

      <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={handleResend}
          disabled={resendCooldown > 0 || isResending || isExpired}
          className="text-[#054FA6] hover:underline font-semibold disabled:text-slate-400 disabled:no-underline flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={isResending ? 'animate-spin' : ''} />
          <span>
            {resendCooldown > 0
              ? `Отправить код повторно (${resendCooldown}с)`
              : 'Отправить код повторно'}
          </span>
        </button>

        <span className="text-[11px] text-slate-500">
          Или нажмите кнопку в письме
        </span>
      </div>
    </div>
  );
}
