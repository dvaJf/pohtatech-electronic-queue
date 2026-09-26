import React, { useState } from 'react';
import { X, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { login, register, getMe, User } from '../../api/authApi';

interface ClientAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserChanged: (user: User | null) => void;
}

export function ClientAuthModal({ isOpen, onClose, onUserChanged }: ClientAuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password);
        await login(email, password);
      }
      const me = await getMe();
      onUserChanged(me);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Ошибка авторизации. Проверьте данные и соединение.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in border border-slate-200">
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-black text-lg text-slate-900 tracking-tight">
            {mode === 'login' ? 'Вход в аккаунт' : 'Регистрация'}
          </h3>
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

        {/* Разделитель авторизации */}
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
            }}
            className="text-xs text-[#054FA6] font-semibold hover:underline"
          >
            {mode === 'login' ? 'Нет учётной записи? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
          </button>
        </div>
      </div>
    </div>
  );
}
