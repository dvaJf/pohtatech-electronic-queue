import React, { useCallback, useEffect, useState, useRef } from 'react';
import { BarChart3, CheckCircle2, Clock, Eye, Loader2, MapPin, RotateCcw, Smartphone, UserPlus, UserX, Volume2, VolumeX, X } from 'lucide-react';
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
  const [scale, setScale] = useState(() => {
    try {
      const stored = Number(localStorage.getItem('pochta_a11y_scale') || '100');
      return [100, 125, 150].includes(stored) ? stored : 100;
    } catch {
      return 100;
    }
  });
  const [a11yOpen, setA11yOpen] = useState(false);
  const [contrast, setContrast] = useState(() => {
    try { return localStorage.getItem('pochta_a11y_contrast') === 'true'; } catch { return false; }
  });
  const [timeStr, setTimeStr] = useState('');
  const [geoStatus, setGeoStatus] = useState<'prompt' | 'locating' | 'granted' | 'denied' | 'unavailable'>('prompt');
  const accessibilityActive = scale !== 100 || contrast;

  const a11yRef = useRef<HTMLDivElement>(null);
  const a11yButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((res) => {
        setGeoStatus(current => current === 'locating' ? current : (res.state === 'granted' ? 'granted' : res.state));
        res.onchange = () => setGeoStatus(res.state === 'granted' ? 'granted' : res.state);
      }).catch(() => {});
    }
    const handleGeoStatus = (e: Event) => {
      const custom = e as CustomEvent<{ granted?: boolean; status?: typeof geoStatus }>;
      if (custom.detail?.status) {
        setGeoStatus(custom.detail.status);
      } else if (typeof custom.detail?.granted === 'boolean') {
        setGeoStatus(custom.detail.granted ? 'granted' : 'prompt');
      }
    };
    window.addEventListener('pochta:geo-status', handleGeoStatus);
    return () => window.removeEventListener('pochta:geo-status', handleGeoStatus);
  }, []);

  const handleRequestGeo = () => {
    if (geoStatus === 'locating') return;
    setGeoStatus('locating');
    window.dispatchEvent(new CustomEvent('pochta:request-geo'));
  };

  const closeA11y = useCallback(() => {
    setA11yOpen(false);
    window.requestAnimationFrame(() => a11yButtonRef.current?.focus());
  }, []);

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
      if (e.key === 'Escape') {
        e.preventDefault();
        closeA11y();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        a11yRef.current &&
        !a11yRef.current.contains(e.target as Node) &&
        a11yButtonRef.current &&
        !a11yButtonRef.current.contains(e.target as Node)
      ) {
        closeA11y();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [a11yOpen, closeA11y]);

  const handleResetA11y = () => {
    setScale(100);
    setContrast(false);
    try {
      localStorage.removeItem('pochta_a11y');
      localStorage.removeItem('pochta_a11y_scale');
      localStorage.removeItem('pochta_a11y_contrast');
    } catch {}
  };

  useEffect(() => {
    document.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`;
    document.documentElement.classList.toggle('a11y-mode', accessibilityActive);
    document.documentElement.classList.toggle('a11y-contrast', contrast);
    try {
      localStorage.setItem('pochta_a11y', String(accessibilityActive));
      localStorage.setItem('pochta_a11y_scale', String(scale));
      localStorage.setItem('pochta_a11y_contrast', String(contrast));
    } catch {}
  }, [accessibilityActive, scale, contrast]);

  useEffect(() => {
    // Удаляем настройку старого пункта меню, чтобы он не мог включиться сам.
    document.documentElement.removeAttribute('data-reduced-motion');
    try {
      localStorage.removeItem('pochta_a11y_motion');
    } catch {}
  }, []);

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
        <div className="product-header-row max-w-7xl mx-auto px-2.5 sm:px-4 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-white/10">
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
          <div className="product-header-tools flex min-w-0 items-center gap-1 sm:gap-2 text-xs font-mono sm:shrink-0">
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
              disabled={geoStatus === 'locating'}
              aria-busy={geoStatus === 'locating'}
              aria-label={geoStatus === 'locating' ? 'Определяем местоположение' : 'Определить местоположение'}
              className={`cx-header-btn h-8 px-2 sm:px-2.5 gap-1.5 ${
                geoStatus === 'granted' ? '!bg-white/20 !border-white/40 text-emerald-300' : ''
              }`}
              title={geoStatus === 'granted' ? 'Геолокация активна (определение отделений)' : 'Разрешить геолокацию для точного поиска отделений'}
            >
              {geoStatus === 'locating' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FFE600]" /> : <MapPin className={`w-3.5 h-3.5 ${geoStatus === 'granted' ? 'text-emerald-400' : 'text-[#86BBFF]'}`} />}
              <span className="font-bold text-white hidden sm:inline whitespace-nowrap">
                {geoStatus === 'locating' ? 'Определяем…' : geoStatus === 'granted' ? 'Гео: ВКЛ' : 'Геолокация'}
              </span>
            </button>

            {/* 3. Доступность (Accessibility Button & Popup) */}
            <button
              ref={a11yButtonRef}
              type="button"
              onClick={() => setA11yOpen((prev: boolean) => !prev)}
              aria-pressed={accessibilityActive}
              aria-expanded={a11yOpen}
              aria-controls="a11y-settings"
              aria-label="Настройки доступности"
              className={`cx-header-btn h-8 w-8 sm:w-auto sm:min-w-[104px] sm:px-2.5 sm:gap-1.5 ${
                accessibilityActive ? '!bg-[#FFE600] !text-black !border-[#FFE600] font-bold shadow-md' : ''
              }`}
              title="Настройки доступности (версия для слабовидящих)"
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="font-bold hidden sm:inline whitespace-nowrap">
                {accessibilityActive ? 'Доступность: ВКЛ' : 'Доступность'}
              </span>
            </button>

            {a11yOpen && (
              <div
                ref={a11yRef}
                id="a11y-settings"
                role="dialog"
                aria-labelledby="a11y-settings-title"
                className="absolute right-2 sm:right-4 top-[5.75rem] sm:top-14 z-50 w-[calc(100vw-1rem)] sm:w-80 max-w-[340px] rounded-2xl border border-white/20 bg-[#002B55] p-3.5 text-left text-xs text-white shadow-2xl backdrop-blur-md"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-2.5 border-b border-white/15 mb-3">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-[#FFE600]" />
                    <span id="a11y-settings-title" className="font-bold text-sm text-white">Панель доступности</span>
                  </div>
                  <button
                    type="button"
                    onClick={closeA11y}
                    className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Закрыть настройки доступности"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Font Scale */}
                <div className="mb-3" role="group" aria-label="Размер текста">
                  <div className="text-[11px] font-bold text-blue-200 mb-1.5">Размер текста</div>
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
                        onClick={() => setScale(val)}
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
                <div className="mb-3" role="group" aria-label="Цветовая схема">
                  <div className="text-[11px] font-bold text-blue-200 mb-1.5">Цветовая схема</div>
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
                    onClick={closeA11y}
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
