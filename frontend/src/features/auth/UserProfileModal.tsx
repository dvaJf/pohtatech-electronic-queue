import React, { useState } from 'react';
import { CheckCircle2, Phone, ShieldCheck, X, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { User, sendPhoneCode, verifyPhoneCode } from '../../api/authApi';
import { PochtaEmblem } from '../../components/common/PochtaBrand';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onUserUpdate: (updated: User) => void;
}

export function UserProfileModal({ isOpen, onClose, user, onUserUpdate }: UserProfileModalProps) {
  const [phone, setPhone] = useState(user.phone || '');
  const [code, setCode] = useState('');
  const [isEditing, setIsEditing] = useState(!user.phoneVerified);
  const [step, setStep] = useState<'input_phone' | 'input_code'>('input_phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  if (!isOpen) return null;

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await sendPhoneCode(phone);
      setSuccessMsg(`Код подтверждения отправлен на номер ${res.phone}`);
      setStep('input_code');
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка отправки кода';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const updated = await verifyPhoneCode(code);
      onUserUpdate(updated);
      setIsEditing(false);
      setStep('input_phone');
      setCode('');
      setSuccessMsg('Номер телефона успешно подтвержден! Напоминания за 30 минут активированы.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Неверный код';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#003B73] px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PochtaEmblem className="w-8 h-8 shrink-0" bg="#FFFFFF" fg="#003B73" />
            <div>
              <h2 className="text-base font-bold text-white leading-tight">Профиль пользователя</h2>
              <p className="text-xs text-blue-200 truncate max-w-[240px]">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* User Info Card */}
          <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Роль в системе</span>
              <span className="text-sm font-black text-slate-800">
                {user.role === 'opc_chief' ? 'Начальник отделения (ОПС)' : user.role === 'employee' ? 'Оператор' : 'Клиент'}
              </span>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-blue-100 text-[#003B73] text-[11px] font-bold">
              Аккаунт активен
            </span>
          </div>

          {/* SMS Reminders Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Phone className="w-4 h-4 text-[#054FA6]" />
              <span>СМС-напоминания о записи</span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Привяжите номер телефона, чтобы получать <strong>СМС за 30 минут</strong> до вашей записи в отделение.
            </p>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Verified state */}
            {user.phoneVerified && !isEditing ? (
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                    <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>Номер подтвержден</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-900">{user.phone}</span>
                </div>
                <div className="text-[11px] text-emerald-700">
                  ✓ Уведомления за 30 минут до визита включены и будут приходить на этот номер.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(true);
                    setStep('input_phone');
                  }}
                  className="text-xs text-blue-700 font-bold hover:underline"
                >
                  Изменить номер телефона
                </button>
              </div>
            ) : step === 'input_phone' ? (
              /* Step 1: Phone input */
              <form onSubmit={handleSendCode} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Номер телефона для СМС
                  </label>
                  <div className="relative">
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+7 (920) 998-16-39"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={loading || !phone.trim()}
                    className="flex-1 py-2.5 px-4 bg-[#054FA6] hover:bg-[#003B73] disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Отправка СМС...</span>
                      </>
                    ) : (
                      <>
                        <span>Получить проверочный код</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                  {user.phoneVerified && (
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="py-2.5 px-3 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold"
                    >
                      Отмена
                    </button>
                  )}
                </div>
              </form>
            ) : (
              /* Step 2: Code input */
              <form onSubmit={handleVerifyCode} className="space-y-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      Код из СМС
                    </label>
                    <button
                      type="button"
                      onClick={() => setStep('input_phone')}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      Изменить номер ({phone})
                    </button>
                  </div>
                  <input
                    type="text"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="1234"
                    autoFocus
                    required
                    className="w-full px-3.5 py-2.5 text-center tracking-widest text-lg font-mono font-bold rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent transition-all"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={loading || !code.trim()}
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Проверка...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Подтвердить номер</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="text-center pt-1">
                  {countdown > 0 ? (
                    <span className="text-[11px] text-slate-500 font-medium">
                      Повторная отправка через {countdown} сек.
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={loading}
                      className="text-[11px] text-blue-600 hover:underline font-bold"
                    >
                      Отправить код повторно
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
