import React, { FormEvent, ReactNode, useEffect, useState } from 'react';
import { getMe, login, User } from '../../api/authApi';
import { PochtaEmblem } from '../../components/common/PochtaBrand';
import { ShieldAlert } from 'lucide-react';

export function AuthBoundary({ children, area, loginPage }: { children: ReactNode; area: 'operator' | 'admin'; loginPage: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getMe().then(value => { if (active) setUser(value); })
      .catch(() => { if (active) setError('Не удалось проверить сессию. Обновите страницу.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  // Синхронизация с выходом через шапку (ProductHeader): сбрасываем сессию,
  // чтобы показать форму входа без перезагрузки страницы.
  useEffect(() => {
    const handleLogoutEvent = () => setUser(null);
    window.addEventListener('pochta:logout', handleLogoutEvent);
    return () => window.removeEventListener('pochta:logout', handleLogoutEvent);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      await login(String(fields.get('email')), String(fields.get('password')));
      const me = await getMe();
      setUser(me);
      window.dispatchEvent(new CustomEvent('pochta:auth', { detail: me }));
    } catch {
      setError('Не удалось войти. Проверьте почту, пароль и соединение с сервером.');
    } finally { setPending(false); }
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p role="status" className="font-mono text-xs text-slate-500 font-bold animate-pulse">Проверяем сессию…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[500px] px-4 py-8">
        <section className="bg-white rounded-3xl border border-[#D2D8E2] p-6 sm:p-8 max-w-md w-full shadow-lg space-y-6">
          <div className="text-center space-y-2">
            <div className="flex justify-center">
              <PochtaEmblem className="w-12 h-12 drop-shadow-md" bg="#003B73" fg="#FFFFFF" />
            </div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              {area === 'operator' ? 'Вход оператора' : 'Вход администратора'}
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              Единая система управления очередью Почты России
            </p>
          </div>

          {error && (
            <div role="alert" className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4 text-xs font-semibold text-slate-700">
            <div>
              <label className="block mb-1.5 font-bold">
                Электронная почта
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  disabled={pending}
                  placeholder="operator@pochta.local"
                  className="mt-1 block w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent transition-all"
                />
              </label>
            </div>

            <div>
              <label className="block mb-1.5 font-bold">
                Пароль
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={pending}
                  placeholder="••••••••"
                  className="mt-1 block w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent transition-all"
                />
              </label>
            </div>

            <button
              disabled={pending}
              className="w-full min-h-[46px] py-3 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors shadow-md disabled:opacity-50 mt-2"
            >
              {pending ? 'Входим…' : 'Войти'}
            </button>
          </form>
        </section>
      </div>
    );
  }

  const allowed = area === 'admin'
    ? user.role === 'opc_chief'
    : user.role === 'employee' || user.role === 'opc_chief';

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">{error}</p>}

      {!allowed ? (
        <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm space-y-3">
          <ShieldAlert className="w-12 h-12 text-[#D92534] mx-auto mb-2" />
          <p role="alert" className="text-sm font-bold text-slate-800">У вашей учётной записи нет доступа к этому рабочему месту.</p>
          <p className="text-xs text-slate-500">Обратитесь к администратору ОПС или войдите под учётной записью сотрудника.</p>
        </div>
      ) : loginPage ? (
        <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm space-y-4 max-w-md mx-auto">
          <h2 className="text-lg font-black text-slate-900">Успешная авторизация</h2>
          <p className="text-xs text-slate-600">Сессия активна. Вы можете перейти в рабочую зону.</p>
          <a
            href={`/${area}`}
            className="inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors shadow-md"
          >
            Открыть рабочее место
          </a>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
