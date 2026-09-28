import React, { useCallback, useEffect, useState, useRef } from 'react';
import { AccessibilityIcon, AltArrowDownIcon, AltArrowRightIcon, ChartIcon, CheckCircleIcon, ClockCircleIcon, CloseCircleIcon, LogoutIcon, MapPointIcon, MenuDotsVerticalIcon, RestartIcon, UserCircleIcon, VolumeCrossIcon, VolumeIcon } from '@solar-icons/react/linear';
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
      if ([100, 125, 150].includes(stored)) return stored;
      localStorage.setItem('pochta_a11y_scale', '100');
      return 100;
    } catch {
      return 100;
    }
  });
  const [a11yOpen, setA11yOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [contrast, setContrast] = useState(() => {
    try { return localStorage.getItem('pochta_a11y_contrast') === 'true'; } catch { return false; }
  });
  const [timeStr, setTimeStr] = useState('');
  const [geoStatus, setGeoStatus] = useState<'prompt' | 'locating' | 'granted' | 'denied' | 'unavailable'>('prompt');
  const accessibilityActive = scale !== 100 || contrast;

  const a11yRef = useRef<HTMLDivElement>(null);
  const a11yButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

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
    window.requestAnimationFrame(() => {
      if (window.matchMedia('(min-width: 768px)').matches) a11yButtonRef.current?.focus();
      else mobileMenuButtonRef.current?.focus();
    });
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

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMobileMenuOpen(false);
        window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(e.target as Node) &&
        mobileMenuButtonRef.current &&
        !mobileMenuButtonRef.current.contains(e.target as Node)
      ) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAccountMenuOpen(false);
        window.requestAnimationFrame(() => accountButtonRef.current?.focus());
      }
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)
          && !accountButtonRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [accountMenuOpen]);

  const handleResetA11y = () => {
    setScale(100);
    setContrast(false);
    try {
      localStorage.setItem('pochta_a11y', 'false');
      localStorage.setItem('pochta_a11y_scale', '100');
      localStorage.setItem('pochta_a11y_contrast', 'false');
      localStorage.removeItem('pochta_a11y_motion');
      document.documentElement.dataset.textScale = '100';
      document.documentElement.classList.remove('a11y-mode', 'a11y-contrast');
      document.documentElement.removeAttribute('data-reduced-motion');
      document.documentElement.removeAttribute('data-font-size');
      document.documentElement.removeAttribute('data-accessibility');
    } catch {}
  };

  useEffect(() => {
    document.documentElement.dataset.textScale = String(scale);
    document.documentElement.classList.toggle('a11y-mode', accessibilityActive);
    document.documentElement.classList.toggle('a11y-contrast', contrast);
    try {
      localStorage.setItem('pochta_a11y', String(accessibilityActive));
      localStorage.setItem('pochta_a11y_scale', String(scale));
      localStorage.setItem('pochta_a11y_contrast', String(contrast));
      if (!accessibilityActive) {
        document.documentElement.removeAttribute('data-font-size');
        document.documentElement.removeAttribute('data-accessibility');
        document.documentElement.removeAttribute('data-reduced-motion');
      }
    } catch {}
  }, [accessibilityActive, scale, contrast]);

  useEffect(() => {
    // Удаляем настройку старого пункта меню, чтобы он не мог включиться сам.
    document.documentElement.removeAttribute('data-reduced-motion');
    document.documentElement.removeAttribute('data-font-size');
    document.documentElement.removeAttribute('data-accessibility');
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
    setAccountMenuOpen(false);
    setMobileMenuOpen(false);
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
  const roleLabel = currentUser?.role === 'opc_chief' ? 'Начальник' : currentUser?.role === 'employee' ? 'Оператор' : 'Клиент';

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-[#FFE600] focus:text-black focus:px-4 focus:py-2">К содержимому</a>
      <header className="main-product-header relative sticky top-0 z-40 bg-[#082E5A] text-white shadow-[0_2px_12px_rgba(4,29,59,0.16)]">
        <div className="product-header-row mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 md:gap-4 md:px-5 md:py-2.5">
          <a href="/" className="group flex min-w-0 shrink-0 items-center gap-2.5 select-none md:gap-3" aria-label="Почта России — на главную">
            <PochtaEmblem className="h-8 w-8 shrink-0 md:h-9 md:w-9" bg="#082E5A" fg="#FFFFFF" />
            <span className="hidden min-w-0 flex-col sm:flex">
              <PochtaWordmark className="h-4 w-auto md:h-5" color="#FFFFFF" />
              <span className="mt-0.5 text-[10px] leading-none tracking-[0.08em] text-blue-100/70">Электронная очередь</span>
            </span>
          </a>

          <div className="product-header-tools flex shrink-0 items-center gap-1 text-xs md:gap-2">
            <div className="hidden items-center gap-1 rounded-xl border border-white/15 bg-white/[0.035] p-0.5 md:flex">
              <button type="button" onClick={() => toggleSound()} aria-pressed={soundEnabled}
                aria-label="Звуковое оповещение" title={soundEnabled ? 'Выключить звук' : 'Включить звук'}
                className="flex h-11 w-11 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-blue-100/80 hover:bg-white/10 hover:text-white">
                {soundEnabled ? <VolumeIcon className="h-5 w-5" /> : <VolumeCrossIcon className="h-5 w-5" />}
              </button>
            </div>

            <button type="button" onClick={handleRequestGeo} disabled={geoStatus === 'locating'}
              aria-busy={geoStatus === 'locating'} aria-pressed={geoStatus === 'granted'}
              aria-label={geoStatus === 'locating' ? 'Определяем местоположение' : 'Определить местоположение'}
              title={geoStatus === 'granted' ? 'Геолокация активна' : 'Определить местоположение'}
              className={`inline-flex h-11 min-w-[92px] items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold text-white transition-colors md:min-w-[104px] md:px-3 ${geoStatus === 'granted' ? 'border-emerald-300/45 bg-emerald-300/15' : 'border-white/25 bg-white/10 hover:bg-white/15'}`}>
              {geoStatus === 'locating' ? <RestartIcon className="h-5 w-5 animate-spin" /> : <MapPointIcon className="h-5 w-5" />}
              <span>{geoStatus === 'locating' ? 'Поиск…' : 'Гео'}</span>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${geoStatus === 'granted' ? 'bg-emerald-300' : 'bg-white/45'}`} />
            </button>

            <div className="hidden items-center gap-1 rounded-xl border border-white/15 bg-white/[0.035] p-0.5 md:flex">
              <button ref={a11yButtonRef} type="button" onClick={() => setA11yOpen(value => !value)}
                aria-pressed={accessibilityActive} aria-expanded={a11yOpen} aria-controls="a11y-settings"
                aria-label="Настройки доступности" title="Настройки доступности"
                className={`flex h-11 w-11 items-center justify-center rounded-lg border-0 bg-transparent p-0 hover:bg-white/10 ${accessibilityActive ? 'text-emerald-300' : 'text-blue-100/80 hover:text-white'}`}>
                <AccessibilityIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="hidden items-center gap-1.5 whitespace-nowrap px-1 text-xs font-medium tabular-nums text-blue-100/70 lg:flex" title="Московское время (Europe/Moscow)">
              <ClockCircleIcon className="h-[18px] w-[18px]" />
              <span>{timeStr || 'МСК'}</span>
            </div>

            {currentUser ? (
              <div className="relative hidden md:block">
                <button ref={accountButtonRef} type="button" onClick={() => setAccountMenuOpen(value => !value)}
                  aria-expanded={accountMenuOpen} aria-controls="account-menu" aria-haspopup="menu"
                  aria-label={`Учётная запись: ${currentUser.email.split('@')[0]}`}
                  className="flex h-11 max-w-[200px] items-center gap-2 rounded-xl border border-white/15 bg-white/[0.045] px-2.5 text-left text-white hover:bg-white/10 xl:max-w-[240px]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10"><UserCircleIcon className="h-5 w-5" /></span>
                  <span className="min-w-0 truncate text-xs font-semibold">{currentUser.email.split('@')[0]}</span>
                  <AltArrowDownIcon className="h-4 w-4 shrink-0 text-blue-100/70" />
                </button>
                {accountMenuOpen && <div ref={accountMenuRef} id="account-menu" role="menu" aria-label="Учётная запись"
                  className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 rounded-xl border border-white/15 bg-[#082E5A] p-1.5 text-white shadow-xl">
                  <div className="truncate px-3 py-2 text-xs text-blue-100/65" title={currentUser.email}>{currentUser.email}<span className="block">{roleLabel}</span></div>
                  <button role="menuitem" type="button" onClick={() => { setAccountMenuOpen(false); setIsProfileOpen(true); }} className="flex min-h-11 w-full items-center rounded-lg border-0 bg-transparent px-3 text-left text-xs text-white hover:bg-white/10">Профиль</button>
                  <button role="menuitem" type="button" onClick={() => { setAccountMenuOpen(false); setA11yOpen(true); }} className="flex min-h-11 w-full items-center rounded-lg border-0 bg-transparent px-3 text-left text-xs text-white hover:bg-white/10">Настройки</button>
                  <button role="menuitem" type="button" onClick={handleLogout} className="flex min-h-11 w-full items-center rounded-lg border-0 bg-transparent px-3 text-left text-xs text-white hover:bg-white/10">Выйти</button>
                </div>}
              </div>
            ) : !isStaffArea ? (
              <button type="button" onClick={() => setIsAuthModalOpen(true)}
                className="hidden h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.045] px-3 text-xs font-semibold text-white hover:bg-white/10 md:flex">
                <UserCircleIcon className="h-5 w-5" /><span>Личный кабинет</span>
              </button>
            ) : null}

            <button ref={mobileMenuButtonRef} type="button" onClick={() => setMobileMenuOpen(value => !value)}
              aria-expanded={mobileMenuOpen} aria-controls="mobile-service-menu" aria-label="Дополнительное меню" title="Меню"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-transparent text-white hover:bg-white/10 md:hidden">
              <MenuDotsVerticalIcon className="h-5 w-5" />
            </button>

            {a11yOpen && (
              <div
                ref={a11yRef}
                id="a11y-settings"
                role="dialog"
                aria-labelledby="a11y-settings-title"
                className="absolute right-2 sm:right-4 top-[3.25rem] sm:top-14 z-50 w-[calc(100vw-1rem)] sm:w-80 max-w-[340px] rounded-2xl border border-white/20 bg-[#002B55] p-3.5 text-left text-xs text-white shadow-2xl backdrop-blur-md"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-2.5 border-b border-white/15 mb-3">
                  <div className="flex items-center gap-2">
                    <AccessibilityIcon className="w-4 h-4 text-blue-300" />
                    <span id="a11y-settings-title" className="font-bold text-sm text-white">Панель доступности</span>
                  </div>
                  <button
                    type="button"
                    onClick={closeA11y}
                    className="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Закрыть настройки доступности"
                  >
                    <CloseCircleIcon className="w-4 h-4" />
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
                            ? 'bg-[#0B4DA2] text-white border-blue-400 shadow-sm'
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
                          ? 'bg-[#0B4DA2] text-white border-blue-400 shadow-sm'
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
                          ? 'bg-black text-white border-white shadow'
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
                    <RestartIcon className="w-3 h-3" />
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

          </div>
        </div>

        {/* Mobile Dropdown Menu (⋯) */}
        {mobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            id="mobile-service-menu"
            className="absolute right-2.5 top-[calc(100%+4px)] z-50 w-72 max-w-[calc(100vw-1.25rem)] rounded-2xl border border-white/20 bg-[#002B55] p-3 text-white shadow-2xl backdrop-blur-md space-y-2.5 animate-in fade-in md:hidden"
          >
            {/* Header info */}
            <div className="flex items-center justify-between pb-2 border-b border-white/15 text-xs text-blue-200">
              <span className="font-bold text-white">Меню сервиса</span>
              <div className="flex items-center gap-1 text-[11px] font-mono">
                <ClockCircleIcon className="w-3 h-3 text-[#86BBFF]" />
                <span>{timeStr || 'МСК'}</span>
              </div>
            </div>

            {/* Звук */}
            <button
              type="button"
              onClick={() => toggleSound()}
              aria-pressed={soundEnabled}
              className="w-full h-10 px-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-between text-xs font-bold text-white transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {soundEnabled ? <VolumeIcon className="w-4 h-4 text-[#86BBFF]" /> : <VolumeCrossIcon className="w-4 h-4 text-slate-400" />}
                <span>Звуковое оповещение</span>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${soundEnabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/60'}`}>
                {soundEnabled ? 'ВКЛ' : 'ВЫКЛ'}
              </span>
            </button>

            {/* Пользователь / Войти */}
            {currentUser ? (
              <div className="p-2.5 rounded-xl bg-white/10 border border-white/15 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-bold text-white truncate max-w-[150px]">{currentUser.email}</span>
                    {currentUser.phoneVerified && <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-300 shrink-0" />}
                  </div>
                  <span className="text-[9px] font-mono text-blue-200 uppercase bg-blue-900/60 px-1.5 py-0.5 rounded">
                    {currentUser.role === 'opc_chief' ? 'Начальник' : currentUser.role === 'employee' ? 'Оператор' : 'Клиент'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setMobileMenuOpen(false); setIsProfileOpen(true); }}
                    className="flex-1 py-1.5 px-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-bold text-white text-center cursor-pointer"
                  >
                    Профиль
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                    className="py-1.5 px-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold text-red-200 flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <LogoutIcon className="w-3.5 h-3.5" />
                    <span>Выйти</span>
                  </button>
                </div>
              </div>
            ) : !isStaffArea ? (
              <button
                type="button"
                onClick={() => { setMobileMenuOpen(false); setIsAuthModalOpen(true); }}
                className="w-full h-10 px-3 rounded-xl bg-[#003B73] hover:bg-[#002B55] active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all border border-blue-400/30 cursor-pointer"
              >
                <UserCircleIcon className="w-4 h-4 text-blue-200" />
                <span>Войти в личный кабинет</span>
              </button>
            ) : null}

            {/* Доступность быстрые опции */}
            <div className="pt-2 border-t border-white/15 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-blue-200 font-bold">
                <span>Размер шрифта</span>
                {scale !== 100 && <span className="text-blue-300 font-mono">{scale}%</span>}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[100, 125, 150].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setScale(val)}
                    aria-pressed={scale === val}
                    className={`py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      scale === val
                        ? 'bg-[#0B4DA2] text-white border-blue-400 shadow-sm'
                        : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => { setMobileMenuOpen(false); setA11yOpen(true); }}
                className="w-full py-2 px-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-blue-100 flex items-center justify-between transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <AccessibilityIcon className="w-3.5 h-3.5 text-blue-300" />
                  <span>Все настройки доступности</span>
                </div>
                <AltArrowRightIcon className="w-3.5 h-3.5 text-blue-300" />
              </button>
            </div>
          </div>
        )}

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
              <ChartIcon className="w-3.5 h-3.5 text-amber-400" />
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
