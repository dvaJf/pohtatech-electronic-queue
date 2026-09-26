import React, { useEffect, useState, useRef } from 'react';
import { BarChart3, CheckCircle2, Clock, Eye, MapPin, RotateCcw, Smartphone, UserPlus, UserX, Volume2, VolumeX, X } from 'lucide-react';
import { PochtaEmblem, PochtaWordmark } from './PochtaBrand';
import { getMe, logout, User } from '../../api/authApi';
import { ClientAuthModal } from '../../features/auth/ClientAuthModal';
import { UserProfileModal } from '../../features/auth/UserProfileModal';
import { isSoundEnabled, setSoundEnabled } from '../../utils/postalVoice';

interface ProductHeaderProps {
  currentPath: string;
}

export function ProductHeader({ currentPath }: ProductHeaderProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [soundEnabled, setSoundEnabledState] = useState(() => isSoundEnabled());
  const [isA11y, setIsA11y] = useState(() => {
    try {
      return localStorage.getItem('pochta_a11y') === 'true';
    } catch {
      return false;
    }
  });
  const [a11yOpen, setA11yOpen] = useState(false);
  const [scale, setScale] = useState(() => Number(localStorage.getItem('pochta_a11y_scale') || (isA11y ? '125' : '100')));
  const [contrast, setContrast] = useState(() => localStorage.getItem('pochta_a11y_contrast') === 'true');
  const [timeStr, setTimeStr] = useState('');
  const [geoGranted, setGeoGranted] = useState(false);

  const a11yRef = useRef<HTMLDivElement>(null);
  const a11yButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((res) => {
        setGeoGranted(res.state === 'granted');
        res.onchange = () => setGeoGranted(res.state === 'granted');
      }).catch(() => {});
    }
    const handleGeoStatus = (e: Event) => {
      const custom = e as CustomEvent<{ granted: boolean }>;
      if (custom.detail && typeof custom.detail.granted === 'boolean') {
        setGeoGranted(custom.detail.granted);
      }
    };
    window.addEventListener('pochta:geo-status', handleGeoStatus);
    return () => window.removeEventListener('pochta:geo-status', handleGeoStatus);
  }, []);

  const handleRequestGeo = () => {
    window.dispatchEvent(new CustomEvent('pochta:request-geo'));
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => setGeoGranted(true),
        () => setGeoGranted(false),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  };

  useEffect(() => {
    const handleSound = (e: Event) => {
      const custom = e as CustomEvent<{ enabled: boolean }>;
      if (custom.detail && typeof custom.detail.enabled === 'boolean') {
        setSoundEnabledState(custom.detail.enabled);
      }
    };
    window.addEventListener('pochta:sound', handleSound);
    return () => window.removeEventListener('pochta:sound', handleSound);
  }, []);

  const toggleSound = (val?: boolean) => {
    const next = typeof val === 'boolean' ? val : !soundEnabled;
    setSoundEnabledState(next);
    setSoundEnabled(next);
  };

  useEffect(() => {
    if (!a11yOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setA11yOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        a11yRef.current &&
        !a11yRef.current.contains(e.target as Node) &&
        a11yButtonRef.current &&
        !a11yButtonRef.current.contains(e.target as Node)
      ) {
        setA11yOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [a11yOpen]);

  const toggleA11yMode = (enable: boolean) => {
    setIsA11y(enable);
    if (!enable) setScale(100);
    if (enable && scale === 100) {
      setScale(125);
    }
  };

  const handleResetA11y = () => {
    setIsA11y(false);
    setScale(100);
    setContrast(false);
    try {
      localStorage.removeItem('pochta_a11y');
      localStorage.removeItem('pochta_a11y_scale');
      localStorage.removeItem('pochta_a11y_contrast');
    } catch {}
  };

  useEffect(() => {
    if (isA11y) {
      document.documentElement.classList.add('a11y-mode');
      document.documentElement.style.fontSize = `${scale}%`;
      try {
        localStorage.setItem('pochta_a11y', 'true');
        localStorage.setItem('pochta_a11y_scale', String(scale));
      } catch {}
    } else {
      document.documentElement.style.fontSize = '';
      try {
        localStorage.removeItem('pochta_a11y');
      } catch {}
    }
    document.documentElement.classList.toggle('a11y-mode', isA11y || contrast);
  }, [isA11y, scale, contrast]);

  useEffect(() => {
    // Удаляем настройку старого пункта меню, чтобы он не мог включиться сам.
    document.documentElement.removeAttribute('data-reduced-motion');
    try {
      localStorage.removeItem('pochta_a11y_motion');
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('a11y-contrast', contrast);
    try {
      localStorage.setItem('pochta_a11y_contrast', String(contrast));
    } catch {}
  }, [contrast, isA11y]);

  useEffect(() => {
    let active = true;
    getMe()
      .then((user) => {
        if (active) setCurrentUser(user);
      })
      .catch(() => {
        // Guest user
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('ru-RU', {
          timeZone: 'Europe/Moscow',
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      setCurrentUser(null);
      // Уведомляем AuthBoundary, чтобы на /operator и /admin сразу
      // показалась форма входа без перезагрузки страницы.
      window.dispatchEvent(new CustomEvent('pochta:logout'));
      // Клиентские экраны должны сбросить «мои талоны» на анонимного владельца.
      window.dispatchEvent(new CustomEvent('pochta:auth'));
    } catch {
      // ignore
    }
  };

  const isStaffArea = currentPath.startsWith('/operator') || currentPath.startsWith('/admin');

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-[#FFE600] focus:text-black focus:px-4 focus:py-2">К содержимому</a>
      <header className="main-product-header bg-[#003B73] text-white shadow-lg sticky top-0 z-40">
        {/* Top Status & Brand Line */}
        <div className="max-w-7xl mx-auto px-2.5 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between gap-1.5 sm:gap-2 border-b border-white/10">
          {/* Brand Block */}
          <a href="/" className="flex items-center gap-2 sm:gap-3 select-none group transition-transform shrink-0">
            <PochtaEmblem className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 drop-shadow-md transition-transform group-hover:scale-105" bg="#003B73" fg="#FFFFFF" />
            <div className="flex flex-col">
              <PochtaWordmark className="h-3 sm:h-5 w-auto" color="#FFFFFF" />
              <div className="text-[10px] sm:text-[11px] text-blue-200 hidden xs:flex items-center gap-1.5 mt-0.5 font-medium">
                <span className="font-mono">Электронная очередь</span>
              </div>
            </div>
          </a>

          {/* Quick Tools Panel */}
          <div className="flex items-center gap-1 sm:gap-2 text-xs font-mono shrink-0">
            {/* 1. Звук (Audio Toggle) */}
            <button
              type="button"
              onClick={() => toggleSound()}
              aria-pressed={soundEnabled}
              aria-label={soundEnabled ? 'Выключить звук' : 'Включить звук'}
              className="cx-header-btn h-8 w-8 sm:w-auto sm:min-w-[104px] sm:px-2.5 sm:gap-1.5"
              title="Звуковое оповещение"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-[#86BBFF]" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
              <span className="font-bold text-white hidden sm:inline whitespace-nowrap">{soundEnabled ? 'Звук: ВКЛ' : 'Звук: ВЫКЛ'}</span>
            </button>

            {/* 2. Гео (Geo Location Permission Button in Header) */}
            <button
              type="button"
              onClick={handleRequestGeo}
              className={`cx-header-btn h-8 px-2 sm:px-2.5 gap-1.5 ${
                geoGranted ? '!bg-white/20 !border-white/40 text-emerald-300' : ''
              }`}
              title={geoGranted ? 'Геолокация активна (определение отделений)' : 'Разрешить геолокацию для точного поиска отделений'}
            >
              <MapPin className={`w-3.5 h-3.5 ${geoGranted ? 'text-emerald-400' : 'text-[#86BBFF]'}`} />
              <span className="font-bold text-white hidden sm:inline whitespace-nowrap">
                {geoGranted ? 'Гео: ВКЛ' : 'Геолокация'}
              </span>
            </button>

            {/* 3. Доступность (Accessibility Button & Popup) */}
            <button
              ref={a11yButtonRef}
              type="button"
              onClick={() => setA11yOpen((prev: boolean) => !prev)}
              aria-pressed={isA11y}
              aria-expanded={a11yOpen}
              aria-controls="a11y-settings"
              className={`cx-header-btn h-8 w-8 sm:w-auto sm:min-w-[104px] sm:px-2.5 sm:gap-1.5 ${
                isA11y ? '!bg-[#FFE600] !text-black !border-[#FFE600] font-bold shadow-md' : ''
              }`}
              title="Настройки доступности (версия для слабовидящих)"
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="font-bold hidden sm:inline whitespace-nowrap">
                {isA11y ? 'Доступность: ВКЛ' : 'Доступность'}
              </span>
            </button>

            {a11yOpen && (
              <div
                ref={a11yRef}
                id="a11y-settings"
                role="region"
                aria-label="Настройки доступности"
                className="absolute right-2 sm:right-4 top-12 sm:top-14 z-50 w-[calc(100vw-1rem)] sm:w-80 max-w-[340px] rounded-2xl border border-white/20 bg-[#002B55] p-4 text-left text-xs text-white shadow-2xl backdrop-blur-md"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-2.5 border-b border-white/15 mb-3">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-[#FFE600]" />
                    <span className="font-bold text-sm text-white">Панель доступности</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setA11yOpen(false)}
                    className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Закрыть настройки доступности"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Master Toggle */}
                <div className="mb-3.5 bg-white/10 p-2.5 rounded-xl flex items-center justify-between">
                  <div className="pr-2">
                    <div className="font-bold text-xs text-white">Увеличенный текст</div>
                    <div className="text-[10px] text-blue-200">Без изменения цветовой схемы</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleA11yMode(!isA11y)}
                    aria-pressed={isA11y}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      isA11y
                        ? 'bg-[#FFE600] text-black shadow-sm'
                        : 'bg-white/20 text-white hover:bg-white/30'
                    }`}
                  >
                    {isA11y ? 'ВКЛЮЧЕН' : 'ВЫКЛ'}
                  </button>
                </div>

                {/* Font Scale */}
                <div className="mb-3">
                  <div className="text-[11px] font-bold text-blue-200 mb-1.5 flex items-center justify-between">
                    <span>Размер шрифта:</span>
                    <span className="font-mono text-white font-bold">{scale}%</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { val: 100, label: 'А 100%' },
                      { val: 125, label: 'А+ 125%' },
                      { val: 150, label: 'А++ 150%' },
                    ].map(({ val, label }) => (
                      <button
                        key={val}
                        type="button"
                        aria-pressed={scale === val}
                        onClick={() => {
                          setScale(val);
                          setIsA11y(val !== 100);
                        }}
                        className={`py-1.5 px-1 text-center rounded-lg text-xs font-bold border transition-all ${
                          scale === val
                            ? 'bg-[#FFE600] text-black border-[#FFE600] shadow'
                            : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color Theme / Contrast */}
                <div className="mb-3">
                  <div className="text-[11px] font-bold text-blue-200 mb-1.5">Цветовая схема:</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      aria-pressed={!contrast}
                      onClick={() => setContrast(false)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all ${
                        !contrast
                          ? 'bg-blue-600 text-white border-blue-400 shadow'
                          : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                      }`}
                    >
                      Стандартная
                    </button>
                    <button
                      type="button"
                      aria-pressed={contrast}
                      onClick={() => setContrast(true)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all ${
                        contrast
                          ? 'bg-black text-[#FFE600] border-[#FFE600] shadow'
                          : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                      }`}
                    >
                      Контрастная (ч/б)
                    </button>
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="mt-3.5 pt-2.5 border-t border-white/15 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleResetA11y}
                    className="header-reset-button text-[11px] text-blue-200 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Сбросить</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setA11yOpen(false)}
                    className="px-3 py-1 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-bold text-white transition-colors"
                  >
                    Готово
                  </button>
                </div>
              </div>
            )}

            {/* 4. Время (Moscow Clock: HH:mm without seconds) */}
            <div className="flex items-center justify-center gap-1.5 h-8 px-2 sm:px-2.5 sm:min-w-[72px] rounded-lg border transition-all bg-white/15 border-white/30 text-white hover:bg-white/25 select-none" title="Московское время (Europe/Moscow)">
              <Clock className="w-3.5 h-3.5 text-[#86BBFF] shrink-0" />
              <span className="font-bold text-white tabular-nums text-xs leading-none whitespace-nowrap">{timeStr || 'МСК'}</span>
            </div>

            {/* Auth / Account Area */}
            <div className="flex items-center gap-1.5 sm:gap-2 border-l border-white/20 pl-1.5 sm:pl-2 ml-0.5">
              {currentUser ? (
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setIsProfileOpen(true)}
                    className="flex flex-col items-end hover:bg-white/10 px-1.5 py-0.5 rounded-lg transition-colors text-left"
                    title="Открыть профиль и управление СМС-напоминаниями"
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-bold text-white max-w-[70px] sm:max-w-[120px] truncate">{currentUser.email.split('@')[0]}</span>
                      {currentUser.phoneVerified ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-300 shrink-0" />
                      ) : (
                        <Smartphone className="w-3 h-3 text-blue-200 shrink-0" />
                      )}
                    </div>
                    <span className="text-[9px] text-blue-200 font-mono uppercase hidden xs:inline">
                      {currentUser.role === 'opc_chief' ? 'Начальник' : currentUser.role === 'employee' ? 'Оператор' : 'Клиент'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="p-1.5 hover:bg-white/20 rounded-lg text-blue-100 transition-colors"
                    title="Выйти из учётной записи"
                  >
                    <UserX className="w-4 h-4" />
                  </button>
                </div>
              ) : !isStaffArea ? (
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="cx-auth-btn h-8 px-2 sm:px-3 text-xs shadow-sm whitespace-nowrap"
                  title="Войти в личный кабинет клиента"
                >
                  <UserPlus className="w-3.5 h-3.5 text-[#003B73] shrink-0" />
                  <span className="text-[#003B73] font-bold hidden sm:inline">Личный кабинет</span>
                  <span className="text-[#003B73] font-bold sm:hidden text-[11px]">Войти</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Secondary Navigation (Staff Only) */}
        {isStaffArea && (
          <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center justify-between text-xs text-blue-100 font-medium border-t border-white/5">
            <nav aria-label="Разделы системы" className="flex items-center gap-4">
              <a
                href="/operator"
                className={`hover:text-white transition-colors pb-0.5 ${currentPath.startsWith('/operator') ? 'text-white font-bold border-b-2 border-white' : 'text-blue-200'}`}
              >
                Окно оператора
              </a>
              {currentUser?.role === 'opc_chief' && (
                <>
                  <span className="text-white/30">·</span>
                  <a
                    href="/admin"
                    className={`hover:text-white transition-colors pb-0.5 ${currentPath.startsWith('/admin') ? 'text-white font-bold border-b-2 border-white' : 'text-blue-200'}`}
                  >
                    Панель начальника ОПС
                  </a>
                </>
              )}
            </nav>

            <a
              href="/grafana/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-blue-200 hover:text-white transition-colors font-semibold"
              title="Перейти в систему мониторинга Grafana (Метрики, Логи, Алерты)"
            >
              <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
              <span>Grafana (Метрики & Логи) ↗</span>
            </a>
          </div>
        )}

        {/* Thin Postal Red Line */}
        <div className="h-[2px] w-full bg-[#D92534]"></div>
      </header>

      <ClientAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onUserChanged={(user) => {
          setCurrentUser(user);
          // Сообщаем клиентским экранам, что сменился владелец талонов.
          window.dispatchEvent(new CustomEvent('pochta:auth'));
        }}
      />

      {currentUser && (
        <UserProfileModal
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          user={currentUser}
          onUserUpdate={(updated) => {
            setCurrentUser(updated);
            window.dispatchEvent(new CustomEvent('pochta:auth'));
          }}
        />
      )}
    </>
  );
}
