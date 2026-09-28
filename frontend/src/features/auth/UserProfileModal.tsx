import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Phone, ShieldCheck, X, AlertCircle, Loader2, ArrowRight, User as UserIcon, Clock } from 'lucide-react';
import { User, sendPhoneCode, verifyPhoneCode } from '../../api/authApi';
import { PochtaEmblem } from '../../components/common/PochtaBrand';
import { ClientServiceRecord, getClientServiceHistory } from '../client/serviceHistory';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onUserUpdate: (updated: User) => void;
}

export function UserProfileModal({ isOpen, onClose, user, onUserUpdate }: UserProfileModalProps) {
  const [fio, setFio] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return (
        localStorage.getItem(`user_fio:${user.id || user.email}`) ||
        localStorage.getItem(`user_fio:${user.email}`) ||
        user.fio ||
        ''
      );
    }
    return user.fio || '';
  });
  const [fioSaved, setFioSaved] = useState(false);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      const saved =
        localStorage.getItem(`user_fio:${user.id || user.email}`) ||
        localStorage.getItem(`user_fio:${user.email}`) ||
        user.fio ||
        '';
      setFio(saved);
    }
  }, [user.id, user.email, user.fio]);

  const history = useMemo<ClientServiceRecord[]>(() => {
    if (user.role !== 'client') return [];
    const fromEmail = getClientServiceHistory(user.email);
    const fromId = user.id ? getClientServiceHistory(user.id) : [];
    const fromAnon = getClientServiceHistory('anon');
    const merged = [...fromEmail];
    for (const item of [...fromId, ...fromAnon]) {
      if (!merged.some(r => r.id === item.id)) {
        merged.push(item);
      }
    }
    return merged.sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
  }, [user.id, user.email, user.role, isOpen]);

  const handleSaveFio = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = fio.trim();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`user_fio:${user.email}`, trimmed);
      if (user.id) localStorage.setItem(`user_fio:${user.id}`, trimmed);
      localStorage.setItem('user_fio', trimmed);
      if (user.role === 'employee' || user.role === 'opc_chief') {
        localStorage.setItem('operator_fio', trimmed);
        if (user.id) localStorage.setItem(`operator_fio:${user.id}`, trimmed);
        localStorage.setItem(`operator_fio:${user.email}`, trimmed);
        const branch = localStorage.getItem('operator.branch');
        if (branch) {
          const win = localStorage.getItem('operator.window:' + branch);
          if (win) {
            localStorage.setItem(`window_operator_name:${win}`, trimmed);
          }
        }
      }
      window.dispatchEvent(
        new CustomEvent('auth_fio_updated', {
          detail: { userId: user.id, email: user.email, fio: trimmed, role: user.role }
        })
      );
    }
    onUserUpdate({ ...user, fio: trimmed });
    setFioSaved(true);
    setTimeout(() => setFioSaved(false), 2500);
  };

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
              <h2 className="text-base font-bold text-white leading-tight">
                {fio ? fio : 'Профиль пользователя'}
              </h2>
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

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* User Info Card */}
          <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
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

            {/* FIO Field */}
            <div className="pt-3 border-t border-slate-200/70 space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5 text-[#054FA6]" />
                  <span>Фамилия, Имя и Отчество</span>
                </div>
                {fioSaved && (
                  <span className="text-[11px] text-emerald-600 font-semibold animate-fade-in">
                    Сохранено ✓
                  </span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fio}
                  onChange={(e) => {
                    setFio(e.target.value);
                    setFioSaved(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveFio();
                    }
                  }}
                  placeholder="Фамилия Имя Отчество"
                  className="flex-1 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent transition-all placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => handleSaveFio()}
                  className="px-3.5 py-2 bg-[#003B73] hover:bg-[#054FA6] text-white text-xs font-bold rounded-xl transition-all shadow-sm shrink-0"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>

          {/* История обслуживаний (только для клиента) */}
          {user.role === 'client' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-slate-900 font-bold text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#054FA6]" />
                  <span>История обслуживаний</span>
                </div>
                <span className="text-[11px] font-bold text-[#003B73] bg-blue-50 border border-blue-200/60 px-2 py-0.5 rounded-full">
                  {history.length} {history.length === 1 ? 'визит' : history.length < 5 ? 'визита' : 'визитов'}
                </span>
              </div>

              {history.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-center text-xs text-slate-500">
                  У вас пока нет завершённых визитов. Обслуженные талоны будут автоматически сохраняться здесь.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-slate-50 hover:bg-slate-100/90 border border-slate-200/90 rounded-2xl transition-all space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm text-[#003B73]">{item.publicNumber}</span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Обслуживание завершено
                        </span>
                      </div>

                      <div className="font-bold text-slate-800">
                        {item.serviceName}
                      </div>

                      <div className="text-[11px] text-slate-500 truncate" title={item.branchName}>
                        {item.branchName}
                      </div>

                      <div className="pt-2 border-t border-slate-200/70 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Окно и оператор</span>
                          <span className="font-semibold text-slate-800">
                            {item.windowText} • {item.operatorName}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-400 block text-[10px]">Дата и время</span>
                          <span className="font-semibold text-slate-800">
                            {item.date} • {item.timeRange}
                          </span>
                          {item.duration && (
                            <span className="block text-[10px] text-slate-400">
                              Длительность: {item.duration}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SMS Reminders Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between text-slate-900 font-bold text-sm">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#054FA6]" />
                <span>СМС-напоминания о записи</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                В разработке
              </span>
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
              /* Step 1: Phone input - Marked as in development */
              <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Номер телефона для СМС
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      disabled
                      readOnly
                      value="В разработке"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 text-sm font-medium cursor-not-allowed select-none"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={true}
                    className="flex-1 py-2.5 px-4 bg-slate-200 text-slate-400 rounded-xl text-xs font-bold cursor-not-allowed flex items-center justify-center gap-1.5 opacity-70 select-none shadow-none"
                  >
                    <span>Получить проверочный код</span>
                    <ArrowRight className="w-3.5 h-3.5 opacity-50" />
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
