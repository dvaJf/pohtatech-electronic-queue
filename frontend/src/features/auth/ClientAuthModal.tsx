import React, { useState, useEffect } from 'react';
import { X, Lock, Mail, Eye, EyeOff, CheckCircle2, RefreshCw, ArrowLeft } from 'lucide-react';
import { login, register, confirmEmailCode, resendEmailCode, getMe, User } from '../../api/authApi';

interface ClientAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserChanged: (user: User | null) => void;
}

export function ClientAuthModal({ isOpen, onClose, onUserChanged }: ClientAuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'confirm_code'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Таймер повторной отправки кода
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => (c > 1 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError('');
    setInfoMsg('');
    try {
      if (mode === 'login') {
        await login(email, password);
        const me = await getMe();
        onUserChanged(me);
        onClose();
      } else if (mode === 'register') {
        const regRes = await register(email, password);
        if (regRes.requiresConfirmation) {
          setMode('confirm_code');
          setCooldown(60);
          setInfoMsg(`Код подтверждения отправлен на ${email}`);
          setPending(false);
          return;
        }
        // Если confirmed сразу (например .invalid или автоподтверждение)
        await login(email, password);
        const me = await getMe();
        onUserChanged(me);
        onClose();
      } else if (mode === 'confirm_code') {
        const res = await confirmEmailCode(email, confirmCode);
        onUserChanged(res.user);
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка авторизации. Проверьте данные и соединение.');
    } finally {
      setPending(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || pending) return;
    setPending(true);
    setError('');
    try {
      await resendEmailCode(email);
      setCooldown(60);
      setInfoMsg('Новый код отправлен на ваш email');
    } catch (err: any) {
      setError(err?.message || 'Не удалось отправить код повторно');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in border border-slate-200">
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-2">
            {mode === 'confirm_code' && (
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                  setInfoMsg('');
                }}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Назад к регистрации"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h3 className="font-black text-lg text-slate-900 tracking-tight">
              {mode === 'login'
                ? 'Вход в аккаунт'
                : mode === 'register'
                ? 'Регистрация'
                : 'Подтверждение Email'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div role="alert" className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
            {error}
          </div>
        )}

        {infoMsg && (
          <div className="p-3 mb-4 rounded-xl bg-blue-50 border border-blue-200 text-[#054FA6] text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#054FA6]" />
            <span>{infoMsg}</span>
          </div>
        )}

        {/* ЭКРАН ПОДТВЕРЖДЕНИЯ КОДА ИЗ ПИСЬМА */}
        {mode === 'confirm_code' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-center py-2">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-3 text-[#054FA6]">
                <Mail className="w-6 h-6" />
              </div>
              <p className="text-xs text-slate-600">
                Мы отправили письмо с 6-значным кодом подтверждения на адрес:
              </p>
              <div className="font-bold text-xs text-slate-900 mt-1 break-all bg-slate-100 py-1 px-2.5 rounded-lg inline-block">
                {email}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 text-center">
                Код из письма
              </label>
              <input
                name="code"
                type="text"
                required
                maxLength={6}
                pattern="[0-9]{6}"
                value={confirmCode}
                disabled={pending}
                onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                autoFocus
                className="w-full py-3 text-center text-xl font-mono font-bold tracking-[8px] rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-[#054FA6] bg-slate-50 text-slate-900"
              />
              <p className="text-[11px] text-slate-400 text-center mt-1.5">
                Проверьте папку «Спам», если письмо не пришло во входящие
              </p>
            </div>

            <button
              type="submit"
              disabled={pending || confirmCode.length !== 6}
              className="w-full min-h-[44px] py-2.5 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors shadow-md disabled:opacity-50"
            >
              {pending ? 'Проверка кода…' : 'Подтвердить email'}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0 || pending}
                className="text-xs font-semibold text-[#054FA6] hover:underline disabled:text-slate-400 disabled:no-underline inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pending ? 'animate-spin' : ''}`} />
                {cooldown > 0
                  ? `Отправить повторно через ${cooldown}с`
                  : 'Отправить код повторно'}
              </button>
            </div>
          </form>
        ) : (
          /* ЭКРАН ВХОДА ИЛИ РЕГИСТРАЦИИ */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Электронная почта
              </label>
              <div className="field-with-icon relative flex items-center">
                <input
                  name="email"
                  type="email"
                  required
                  value={email}
                  disabled={pending}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="field-with-icon__input w-full py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent"
                />
                <Mail className="field-with-icon__icon w-4 h-4 text-slate-400" aria-hidden="true" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Пароль
              </label>
              <div className="field-with-icon relative flex items-center">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  disabled={pending}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="field-with-icon__input w-full py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent"
                />
                <Lock className="field-with-icon__icon w-4 h-4 text-slate-400" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-[#054FA6] rounded-lg"
                  title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full min-h-[44px] py-2.5 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors shadow-md disabled:opacity-50"
            >
              {pending ? 'Проверка…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>
        )}

        {/* Разделитель авторизации (только для login/register) */}
        {mode !== 'confirm_code' && (
          <>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-2 text-slate-400 font-medium">или войти через</span>
              </div>
            </div>

            {/* Кнопка Яндекс ID */}
            <div>
              <a
                href="/api/v1/auth/oauth/yandex/login"
                className="flex items-center justify-center gap-2.5 w-full py-2.5 px-4 rounded-xl border border-slate-900 bg-black hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-sm active:scale-[0.98] text-center"
                title="Войти с помощью Яндекс ID"
              >
                <div className="w-5 h-5 rounded-full bg-[#FC3F1D] flex items-center justify-center text-[11px] font-black leading-none text-white shrink-0">
                  Я
                </div>
                <span>Войти через Яндекс ID</span>
              </a>
            </div>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setMode((m) => (m === 'login' ? 'register' : 'login'));
                  setError('');
                  setInfoMsg('');
                }}
                className="cx-link-button text-xs text-[#054FA6] font-semibold hover:underline"
              >
                {mode === 'login' ? 'Нет учётной записи? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
