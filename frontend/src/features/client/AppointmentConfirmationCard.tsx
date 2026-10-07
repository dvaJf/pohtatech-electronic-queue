import React, { useState, useEffect, useRef } from 'react';
import { Mail, Clock, ShieldCheck, RefreshCw, AlertCircle, CheckCircle2, XCircle, Bug } from 'lucide-react';
import type { Ticket, Branch } from '../../api/client/types';
import * as api from '../../api/client/clientApi';
import { isForceConfirmVisible } from './appointmentConfirmationPolicy';

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
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isTestConfirmAllowed = isForceConfirmVisible({
    explicitFlag: import.meta.env.VITE_ALLOW_SPECIAL_DEV_FORCE_CONFIRM || import.meta.env.VITE_ALLOW_TEST_APPOINTMENT_CONFIRM,
    mode: import.meta.env.MODE,
    isDev: import.meta.env.DEV,
  });

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

  // Polling to detect if confirmed via email 1-click in another tab
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

  const handleDigitChange = (index: number, val: string) => {
    const cleaned = val.replace(/\D/g, '');
    if (!cleaned) {
      const next = [...codeDigits];
      next[index] = '';
      setCodeDigits(next);
      return;
    }

    if (cleaned.length > 1) {
      // Pasted multi-digit string
      const pasted = cleaned.slice(0, 6).split('');
      const next = [...codeDigits];
      for (let i = 0; i < 6; i++) {
        if (i < pasted.length) {
          next[i] = pasted[i];
        }
      }
      setCodeDigits(next);
      const focusIndex = Math.min(5, pasted.length);
      inputRefs.current[focusIndex]?.focus();
      return;
    }

    const next = [...codeDigits];
    next[index] = cleaned[cleaned.length - 1];
    setCodeDigits(next);
    if (error) setError(null);

    // Jump to next input
    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const fullCode = codeDigits.join('');

  const handleConfirm = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (fullCode.length !== 6) {
      setError('Введите 6 цифр кода подтверждения');
      return;
    }
    if (timeLeftSec <= 0) {
      setError('Время на подтверждение истекло. Пожалуйста, оформите запись заново.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const confirmedTicket = await api.confirmAppointment(ticket.id, fullCode);
      onConfirmed(confirmedTicket);
    } catch (err: any) {
      if (err?.code === 'INVALID_CODE') {
        setError('Неверный код подтверждения.');
      } else if (err?.code === 'APPOINTMENT_EXPIRED') {
        setError('Время подтверждения истекло. Выберите время повторно.');
      } else {
        setError(err?.message || 'Неверный код подтверждения или срок действия истёк');
      }
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

  const handleCancel = async () => {
    if (isCancelling || isSubmitting) return;
    const confirmed = window.confirm('Вы действительно хотите отменить эту предварительную запись?');
    if (!confirmed) return;

    setIsCancelling(true);
    setError(null);
    try {
      await api.cancelTicket(ticket.id, ticket.managementToken || undefined);
      if (onCancelled) onCancelled();
    } catch (err: any) {
      setError(err?.message || 'Не удалось отменить запись');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleTestConfirm = async () => {
    if (isSubmitting || timeLeftSec <= 0) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const confirmedTicket = await api.testConfirmAppointment(ticket.id);
      onConfirmed(confirmedTicket);
    } catch (err: any) {
      setError(err?.message || 'Ошибка тестового подтверждения');
    } finally {
      setIsSubmitting(false);
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
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase bg-amber-100 text-amber-900 border border-amber-200">
            <Clock size={12} className="animate-spin-slow" />
            <span>15 минут на подтверждение</span>
          </div>
          <h3 className="text-lg font-black text-[#031E56]">
            Подтвердите запись
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

      {/* Email Info */}
      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3 text-xs text-slate-700">
        <Mail size={20} className="shrink-0 text-[#054FA6]" />
        <div className="min-w-0">
          <p className="leading-snug">
            Мы отправили письмо на:{' '}
            <strong className="font-semibold text-slate-900">
              {maskEmail(ticket.notificationEmail || '') || 'ваш email'}
            </strong>
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Подтвердите запись в течение 15 минут. После подтверждения запись будет оформлена.
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

      {/* Code Confirmation Form with 6 Segmented Digit Boxes */}
      <form onSubmit={handleConfirm} className="space-y-4">
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-700 text-center sm:text-left">
            Введите код из письма:
          </label>
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {codeDigits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => { inputRefs.current[idx] = el; }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                disabled={isSubmitting || isExpired}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                className="w-11 h-14 sm:w-12 sm:h-14 text-center font-mono text-2xl font-black rounded-xl border-2 border-slate-300 focus:border-[#003B73] focus:bg-blue-50/30 text-[#031E56] shadow-2xs outline-none transition-all"
                aria-label={`Цифра ${idx + 1} кода подтверждения`}
              />
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || fullCode.length !== 6 || isExpired}
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
              <span>ПОДТВЕРДИТЬ ЗАПИСЬ</span>
            </>
          )}
        </button>
      </form>

      {/* Spam Hint and Resend & Cancel Actions */}
      <div className="pt-3 border-t border-slate-100 space-y-3">
        <p className="text-xs text-slate-600 text-center leading-relaxed">
          Не нашли письмо? Проверьте папку «Спам» или отправьте письмо ещё раз.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || isResending || isExpired}
            className="text-[#054FA6] hover:underline font-semibold disabled:text-slate-400 disabled:no-underline flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={isResending ? 'animate-spin' : ''} />
            <span>
              {resendCooldown > 0
                ? `Отправить ещё раз (${resendCooldown}с)`
                : 'Отправить ещё раз'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCancel}
            disabled={isCancelling || isSubmitting}
            className="text-rose-600 hover:text-rose-700 hover:underline font-semibold flex items-center gap-1.5"
          >
            <XCircle size={13} />
            <span>{isCancelling ? 'Отменяем...' : 'Отменить запись'}</span>
          </button>
        </div>
      </div>

      {/* Intentionally enabled emergency confirmation block. */}
      {isTestConfirmAllowed && (
        <div className="pt-3 border-t-2 border-dashed border-amber-300/80 bg-amber-50/60 p-3 rounded-2xl text-center space-y-2">
          <div className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-amber-800">
            <Bug size={12} />
            <span>СПЕЦИАЛЬНОЕ ПОДТВЕРЖДЕНИЕ</span>
          </div>
          <p className="text-[11px] text-amber-900 leading-tight">
            Если письмо не доставлено, запись можно принудительно подтвердить напрямую.
          </p>
          <button
            type="button"
            onClick={handleTestConfirm}
            disabled={isSubmitting || isExpired}
            className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            Письмо не пришло — подтвердить тестово
          </button>
        </div>
      )}
    </div>
  );
}
