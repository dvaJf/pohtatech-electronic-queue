import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mail, Clock, RefreshCw, AlertCircle, CheckCircle2, ShieldCheck, Bug, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import type { Ticket, Branch } from '../../api/client/types';
import * as api from '../../api/client/clientApi';
import {
  confirmationRemainingSeconds,
  appointmentConfirmationErrorMessage,
  type ConfirmationErrorLike,
} from './appointmentConfirmationModel';
import { isForceConfirmVisible } from './appointmentConfirmationPolicy';

export interface AppointmentConfirmationDialogProps {
  open: boolean;
  ticket: Ticket | null;
  branch?: Branch | null;
  onOpenChange?: (open: boolean) => void;
  onSuccess: (confirmedTicket: Ticket) => void;
  onCancel: () => void;
}

export function AppointmentConfirmationDialog({
  open,
  ticket,
  branch,
  onOpenChange,
  onSuccess,
  onCancel,
}: AppointmentConfirmationDialogProps) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmedSuccess, setIsConfirmedSuccess] = useState(false);
  const [showAbortPrompt, setShowAbortPrompt] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(ticket?.confirmationExpiresAt || null);

  const submittingRef = useRef(false);

  // Sync ticket expiration if ticket changes
  useEffect(() => {
    if (ticket?.confirmationExpiresAt) {
      setExpiresAt(ticket.confirmationExpiresAt);
    }
  }, [ticket?.confirmationExpiresAt]);

  // DEV/TEST bypass visibility strictly via policy
  const isTestConfirmAllowed = isForceConfirmVisible({
    explicitFlag: import.meta.env.VITE_ALLOW_SPECIAL_DEV_FORCE_CONFIRM || import.meta.env.VITE_ALLOW_TEST_APPOINTMENT_CONFIRM,
    mode: import.meta.env.MODE,
    isDev: import.meta.env.DEV,
  });

  // Authoritative countdown remaining seconds
  const [remainingSec, setRemainingSec] = useState(() =>
    confirmationRemainingSeconds(expiresAt, Date.now())
  );

  useEffect(() => {
    const updateTime = () => {
      const left = confirmationRemainingSeconds(expiresAt, Date.now());
      setRemainingSec(left);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Reset state when opening a new ticket
  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
      setResendNotice(null);
      setIsConfirmedSuccess(false);
      setShowAbortPrompt(false);
      submittingRef.current = false;
    }
  }, [open, ticket?.id]);

  const isExpired = remainingSec <= 0;

  const formatTimer = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Mask email: n***@domain.com
  const maskEmail = (email?: string | null) => {
    if (!email || !email.includes('@')) return 'вашу почту';
    const [name, domain] = email.split('@');
    if (name.length <= 2) return `${name}***@${domain}`;
    return `${name.slice(0, 1)}***${name.slice(-1)}@${domain}`;
  };

  const handleConfirm = useCallback(async (codeToSubmit = code) => {
    if (!ticket || submittingRef.current || codeToSubmit.length !== 6 || isExpired) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const res = await api.confirmAppointment(ticket.id, codeToSubmit);
      setIsConfirmedSuccess(true);
      // Wait 500ms for user feedback then notify parent to invalidate and navigate
      setTimeout(() => {
        onSuccess(res);
      }, 500);
    } catch (err: unknown) {
      submittingRef.current = false;
      setSubmitting(false);
      const e = err as ConfirmationErrorLike;
      setError(appointmentConfirmationErrorMessage(e));
    }
  }, [ticket, code, isExpired, onSuccess]);

  const handleResend = async () => {
    if (!ticket || resending || resendCooldown > 0 || isExpired) return;

    setResending(true);
    setError(null);
    setResendNotice(null);

    try {
      const res = await api.resendAppointmentConfirmation(ticket.id);
      // Server returns confirmationExpiresAt which preserves the original booking window
      if (res.confirmationExpiresAt) {
        setExpiresAt(res.confirmationExpiresAt);
      }
      setResendNotice('Новый 6-значный код отправлен на почту');
      setResendCooldown(30);
    } catch (err: unknown) {
      const e = err as ConfirmationErrorLike;
      setError(e.message || 'Не удалось отправить код повторно');
    } finally {
      setResending(false);
    }
  };

  const handleTestConfirm = async () => {
    if (!ticket || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const res = await api.testConfirmAppointment(ticket.id);
      setIsConfirmedSuccess(true);
      setTimeout(() => {
        onSuccess(res);
      }, 500);
    } catch (err: unknown) {
      submittingRef.current = false;
      setSubmitting(false);
      const e = err as ConfirmationErrorLike;
      setError(appointmentConfirmationErrorMessage(e));
    }
  };

  const handleAbortConfirmation = async () => {
    if (ticket) {
      try {
        await api.cancelTicket(ticket.id, ticket.managementToken ?? undefined);
      } catch {
        // Ignored, backend expiry will release it anyway
      }
    }
    setShowAbortPrompt(false);
    onCancel();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleAbortConfirmation();
      return;
    }
    onOpenChange?.(nextOpen);
  };

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton={isConfirmedSuccess || showAbortPrompt} className="max-w-md p-6 sm:p-7">
        {isConfirmedSuccess ? (
          <div className="flex flex-col items-center justify-center py-6 text-center space-y-3 animate-in fade-in zoom-in duration-200">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 size={36} />
            </div>
            <DialogTitle className="text-xl font-bold text-slate-900">
              Запись подтверждена
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-600">
              Переходим в «Мои талоны»…
            </DialogDescription>
          </div>
        ) : showAbortPrompt ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle size={28} className="shrink-0" />
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Прервать подтверждение записи?
                </h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  Если вы отмените запись, выбранное время освободится для других клиентов.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowAbortPrompt(false)}
                className="flex-1 rounded-xl bg-[#003B73] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#00519B]"
              >
                Продолжить подтверждение
              </button>
              <button
                type="button"
                onClick={handleAbortConfirmation}
                className="flex-1 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
              >
                Отменить запись
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <DialogHeader className="items-center text-center">
              <div className="mx-auto flex h-13 w-13 items-center justify-center rounded-2xl bg-blue-50 text-[#003B73] mb-1">
                <Mail size={26} />
              </div>
              {ticket.publicNumber && (
                <p className="text-xs font-semibold text-slate-400 tracking-wider font-mono">
                  {branch?.name ? `${branch.name} · ${ticket.publicNumber}` : ticket.publicNumber}
                </p>
              )}
              <DialogTitle className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                Подтвердите запись
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-600 max-w-xs mx-auto">
                Мы отправили 6-значный код на{' '}
                <strong className="text-slate-900 font-medium">
                  {maskEmail(ticket.notificationEmail)}
                </strong>
              </DialogDescription>
            </DialogHeader>

            {/* OTP Input Form */}
            <div className="flex flex-col items-center justify-center space-y-3 py-1">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(val) => {
                  setCode(val);
                  setError(null);
                  if (val.length === 6) {
                    handleConfirm(val);
                  }
                }}
                disabled={submitting || isExpired}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>

              {/* Countdown and Expiry */}
              <div className="flex items-center gap-1.5 text-xs">
                <Clock size={13} className={isExpired ? 'text-red-500' : 'text-slate-500'} />
                {isExpired ? (
                  <span className="font-semibold text-red-600">Время действия кода истекло</span>
                ) : (
                  <span className="text-slate-600">
                    Осталось <strong className="font-semibold text-slate-900 tabular-nums">{formatTimer(remainingSec)}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 p-3 text-xs text-red-700 animate-in fade-in duration-150">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            {/* Resend Notice */}
            {resendNotice && !error && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 p-2.5 text-xs text-emerald-800 animate-in fade-in duration-150">
                <ShieldCheck size={16} className="shrink-0" />
                <span>{resendNotice}</span>
              </div>
            )}

            {/* Primary Action Button */}
            <button
              type="button"
              disabled={code.length !== 6 || submitting || isExpired}
              onClick={() => handleConfirm()}
              className="flex w-full min-h-12 items-center justify-center gap-2 rounded-xl bg-[#003B73] px-4 text-base font-semibold text-white shadow-sm transition-all hover:bg-[#00519B] active:bg-[#002C57] disabled:pointer-events-none disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  <span>Проверяем код…</span>
                </>
              ) : (
                <span>Подтвердить запись</span>
              )}
            </button>

            {/* Spam Hint and Resend Link */}
            <div className="text-center text-xs text-slate-500 space-y-1.5">
              <p>
                Не получили письмо? Проверьте папку «Спам»
              </p>
              <div>
                <button
                  type="button"
                  disabled={resending || resendCooldown > 0 || isExpired}
                  onClick={handleResend}
                  className="font-medium text-[#003B73] hover:underline disabled:text-slate-400 disabled:no-underline"
                >
                  {resending
                    ? 'Отправляем…'
                    : resendCooldown > 0
                    ? `Отправить код ещё раз через ${resendCooldown} сек`
                    : 'Отправить ещё раз'}
                </button>
              </div>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleTestConfirm}
                  disabled={submitting}
                  className="inline-flex items-center justify-center font-bold text-xs text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-3.5 py-2 rounded-xl transition-all shadow-2xs hover:shadow-xs active:scale-[0.99] cursor-pointer"
                >
                  Письмо никак не приходит — подтвердить принудительно
                </button>
              </div>
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={handleAbortConfirmation}
                  className="text-[11px] text-slate-400 hover:text-red-600 transition-colors underline-offset-2 hover:underline cursor-pointer"
                >
                  Отменить запись
                </button>
              </div>
            </div>

            {/* DEV/TEST Force Confirm Guard */}
            {isTestConfirmAllowed && (
              <div className="pt-2 border-t border-dashed border-amber-300 bg-amber-50/60 p-3 rounded-2xl text-center space-y-1.5">
                <div className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-amber-800">
                  <Bug size={12} />
                  <span>СПЕЦИАЛЬНОЕ ПОДТВЕРЖДЕНИЕ (DEV)</span>
                </div>
                <p className="text-[11px] text-amber-900 leading-tight">
                  Если почтовый сервис недоступен, подтвердите запись напрямую.
                </p>
                <button
                  type="button"
                  onClick={handleTestConfirm}
                  disabled={submitting}
                  className="w-full rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
                >
                  Подтвердить тестово
                </button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
