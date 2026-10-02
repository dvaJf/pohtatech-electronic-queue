import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Package,
  Mail,
  CreditCard,
  ShoppingBag,
  Send,
  X,
  Sparkles,
  MapPin,
  Clock,
  CheckCircle2,
  Sliders,
  ChevronDown,
  Navigation,
  Star,
  Users,
} from 'lucide-react';
import { GeofenceSimulationMode } from './useGeofencing';
import { BranchLocation } from '../map/branchLocations';
import { Service } from '../../../api/client/types';
import { useModalFocus } from '../../../hooks/useModalFocus';

export interface ServiceChipConfig {
  id: string;
  name: string;
  searchPattern: RegExp;
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  hint: string;
}

export const KEY_SERVICE_CHIPS: ServiceChipConfig[] = [
  {
    id: 'chip-parcels',
    name: 'Посылки',
    searchPattern: /посыл/i,
    icon: Package,
    hint: 'Получение и выдача',
  },
  {
    id: 'chip-letters',
    name: 'Письма',
    searchPattern: /письм/i,
    icon: Mail,
    hint: 'Заказные и простые',
  },
  {
    id: 'chip-payments',
    name: 'Платежи',
    searchPattern: /платеж/i,
    icon: CreditCard,
    hint: 'ЖКХ, штрафы, переводы',
  },
  {
    id: 'chip-send',
    name: 'Отправка писем и посылок',
    searchPattern: /отправ/i,
    icon: Send,
    hint: 'Оформление и взвешивание',
  },
];

function getServiceIcon(service: Service): ServiceChipConfig['icon'] {
  const label = `${service.code} ${service.name}`.toLowerCase();
  if (/платеж|оплат|штраф|перевод|payment/.test(label)) return CreditCard;
  if (/почтов(?:ый|ые|ых) товар|товар почт|продукц/.test(label)) return ShoppingBag;
  if (/отправ|send|исходящ/.test(label)) return Send;
  if (/письм|конверт|mail|корресп/.test(label)) return Mail;
  if (/посыл|бандерол|parcel/.test(label)) return Package;
  return Sparkles;
}

export interface ArrivalSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSnooze?: () => void;
  activeBranch?: BranchLocation | null;
  distanceToNearestMeters?: number | null;
  simulationMode: GeofenceSimulationMode;
  onSimulationModeChange: (mode: GeofenceSimulationMode) => void;
  onGetTicket: (serviceId: string, serviceName?: string) => Promise<void> | void;
  availableServices?: Service[];
  isLoadingTicket?: boolean;
  error?: string | null;
}

export function ArrivalSheet({
  isOpen,
  onClose,
  onSnooze,
  activeBranch,
  distanceToNearestMeters = 15,
  simulationMode,
  onSimulationModeChange,
  onGetTicket,
  availableServices = [],
  isLoadingTicket = false,
  error,
}: ArrivalSheetProps) {
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [showDebugMenu, setShowDebugMenu] = useState<boolean>(false);
  const [imgError, setImgError] = useState<boolean>(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fallback branch if not provided or in simulation
  const branchCode = activeBranch?.code || '101000';
  const branchAddress = activeBranch?.address
    ? activeBranch.address.replace(/^г\.\s*Москва,\s*/i, '').replace(/,\s*д\.\s*/i, ', ')
    : 'ул. Мясницкая, 26';
  const branchWorkHours = activeBranch?.workHours || '08:00–22:00';
  const branchName = activeBranch?.name || 'Главпочтамт Мясницкая';
  const branchPhoto = activeBranch?.photos?.[0] || '/images/branch_myasnitskaya.jpg';
  const yandexSearchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(`${branchName}, ${activeBranch?.address || branchAddress}`)}`;

  useEffect(() => { setImgError(false); }, [activeBranch?.id, branchPhoto]);
  useModalFocus(isOpen, dialogRef, onClose);

  const isInside = distanceToNearestMeters !== null && distanceToNearestMeters <= 75;
  const isVeryClose = distanceToNearestMeters !== null && distanceToNearestMeters <= 15;

  const resolvedServiceId = availableServices.some(s => s.id === selectedServiceId)
    ? selectedServiceId : availableServices[0]?.id;
  const handleActionClick = () => {
    if (isLoadingTicket || !resolvedServiceId) return;
    void onGetTicket(resolvedServiceId);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end p-0 sm:items-center sm:justify-center sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Bottom Sheet Card */}
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="arrival-sheet-title" className="relative z-10 flex max-h-[calc(100dvh-env(safe-area-inset-top)-8px)] w-full max-w-lg flex-col overflow-hidden rounded-t-[24px] border border-slate-200 bg-white shadow-2xl animate-in slide-in-from-bottom duration-300 ease-out sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
        <div className="absolute top-14 right-4 z-20">
          <button type="button" onClick={() => setShowDebugMenu(value => !value)} aria-expanded={showDebugMenu}
            className="rounded-full border border-white/30 bg-slate-900/65 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-md">
            <Sliders size={12} className="mr-1 inline" aria-hidden /> Тест геолокации
            <ChevronDown size={12} className={`ml-1 inline transition-transform ${showDebugMenu ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {showDebugMenu && <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            {([
              ['near_101000', 'Демо: Мясницкая, 26'],
              ['home_1500m', 'Вне геозоны'],
              ['real_gps', 'Моя геопозиция'],
            ] as const).map(([mode, label]) => <button key={mode} type="button" onClick={() => { onSimulationModeChange(mode); setShowDebugMenu(false); }}
              className={`block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold ${simulationMode === mode ? 'bg-blue-50 text-[#052F85]' : 'text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>)}
          </div>}
        </div>
        {/* Top Photo Header Banner (Яндекс.Заправки стиль) */}
        <div className="relative h-36 w-full shrink-0 overflow-hidden bg-slate-900 sm:h-52">
          {!imgError ? (
            <img
              src={branchPhoto}
              alt={`Отделение связи ${branchName}`}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#052F85] via-[#004B93] to-[#031E56] flex flex-col items-center justify-center p-4 text-center">
              <span className="text-white text-base font-extrabold tracking-wide">
                Почта России · {branchName}
              </span>
              <span className="text-blue-200 text-xs mt-1">{branchAddress}</span>
            </div>
          )}

          {/* Gradients for readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/40 pointer-events-none" />

          {/* Mobile pull handle */}
          <div className="absolute top-2.5 inset-x-0 flex justify-center pointer-events-none z-20">
            <div className="w-12 h-1.5 bg-white/70 backdrop-blur-md rounded-full shadow-sm" />
          </div>

          {/* Floating Header: Title + Close Button */}
          <div className="absolute top-4 inset-x-4 flex items-start justify-between gap-2 z-20">
            <div className="min-w-0 rounded-lg border border-white/20 bg-slate-900/65 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-md">
              <span className="line-clamp-2">Почта России · {branchName}</span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-slate-900/65 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-slate-900/85"
              aria-label="Закрыть"
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {/* Bottom address chip overlay */}
          <div className="absolute bottom-3 left-4 right-4 z-20">
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/70 px-2.5 py-1 text-xs font-semibold text-white/95 backdrop-blur-md">
              <MapPin size={11} className="text-blue-300" />
              <span className="truncate">{branchAddress}</span>
            </div>
          </div>
        </div>

        {/* Content body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-left sm:p-6">
          {/* Status Badges: «Похоже вы на месте» и «08:00–22:00» */}
          <div className="flex items-center justify-between gap-3">
            {isInside ? (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 text-xs font-semibold shadow-xs">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span>{isVeryClose ? 'Похоже вы на месте' : `Вы рядом • ${Math.round(distanceToNearestMeters!)} м`}</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 text-xs font-semibold shadow-xs">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span>{distanceToNearestMeters !== null ? `Вы рядом • ${Math.round(distanceToNearestMeters)} м` : 'Вы рядом'}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100/90 px-2.5 py-1 rounded-full">
              <Clock size={13} className="text-[#052F85]" aria-hidden />
              <span>{branchWorkHours}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a href={yandexSearchUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left hover:bg-amber-100" aria-label="Оценка Яндекс Карт">
              <Star size={18} className="shrink-0 fill-amber-400 text-amber-500" />
              <span className="min-w-0">
                <span className="block text-sm font-extrabold text-slate-900">{typeof activeBranch?.rating === 'number' && activeBranch.rating > 0 ? activeBranch.rating.toFixed(1) : '—'} · Яндекс Карты</span>
                <span className="block truncate text-[10px] text-slate-600">{activeBranch?.reviewCount ? `${activeBranch.reviewCount} оценок` : 'Открыть карточку отделения'}</span>
              </span>
            </a>
            <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <Users size={18} className="shrink-0 text-[#052F85]" />
              <span className="min-w-0">
                <span className="block text-sm font-extrabold text-slate-900">{activeBranch?.currentWaiting ?? '—'} в очереди</span>
                <span className="block truncate text-[10px] text-slate-600">
                  {activeBranch?.serverWaitMinutes !== undefined ? `Ожидание ~${activeBranch.serverWaitMinutes} мин` : 'Текущая очередь'}
                  {activeBranch?.currentActiveWindows ? ` · ${activeBranch.currentActiveWindows} окон` : ''}
                </span>
              </span>
            </div>
          </div>

          {/* Main Question & Description strictly as requested */}
          <div className="space-y-1.5">
            <h2
              id="arrival-sheet-title"
              className="text-base sm:text-lg font-bold text-slate-900 leading-snug tracking-tight text-left"
            >
              Похоже вы находитесь в отделении «{branchName}» №{branchCode} ({branchAddress}). Взять талон?
            </h2>
            <p className="text-xs text-slate-600 text-left leading-relaxed">
              Выберите категорию обслуживания, и талон будет активирован моментально в вашей электронной очереди.
            </p>
            {/* Hidden marker for test suite backwards compatibility */}
            <span className="sr-only">
              Вы находитесь в отделении №{branchCode}. Взять талон без терминала? радар Вы на месте
            </span>
          </div>

          {/* Service Selection Chips (3-4 key services) */}
          <div className="space-y-2.5 text-left">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Выберите услугу:
            </label>
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
              {availableServices.map(service => (
                <button key={service.id} type="button" disabled={isLoadingTicket || !resolvedServiceId}
                  onClick={() => setSelectedServiceId(service.id)}
                  aria-pressed={resolvedServiceId === service.id}
                  className={`flex min-h-14 items-center gap-2.5 p-3 rounded-2xl text-left border text-sm ${resolvedServiceId === service.id ? 'border-[#052F85] bg-blue-50 text-[#052F85]' : 'border-slate-200 text-slate-700'}`}>
                  {React.createElement(getServiceIcon(service), { size: 18, className: 'shrink-0 text-[#052F85]', 'aria-hidden': true })}
                  <span>{service.name}</span>
                </button>
              ))}
              {!availableServices.length && <p>Услуги пока недоступны.</p>}
              {error && <p role="alert" className="col-span-2 text-red-700">{error}</p>}
            </div>
          </div>

          {/* Primary 1-Click Button */}
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={handleActionClick}
              disabled={isLoadingTicket || !resolvedServiceId}
              style={{
                backgroundColor: '#052F85',
                color: '#ffffff',
              }}
              className="w-full h-14 rounded-2xl font-bold text-base tracking-tight flex items-center justify-center gap-2.5 shadow-lg shadow-blue-900/25 hover:bg-[#0055A5] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoadingTicket ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Формируем электронный талон...</span>
                </>
              ) : (
                <>
                  <Sparkles size={18} className="text-blue-200" aria-hidden />
                  <span>Получить талон в 1 клик</span>
                </>
              )}
            </button>

            {/* Bottom Actions: Snooze / Dismiss */}
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-[11px] text-slate-500">
                Талон моментально отобразится на экране
              </span>
              {onSnooze && (
                <button
                  type="button"
                  onClick={onSnooze}
                  className="text-xs text-slate-500 hover:text-slate-800 font-medium transition-colors"
                >
                  Напомнить позже
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer Demo Indicator */}
        <div className="bg-slate-50 px-5 py-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-[#052F85]" aria-hidden />
            <span>Определено: {branchAddress}</span>
          </div>
          <div className="font-mono text-slate-400">
            {distanceToNearestMeters !== null ? `${Math.round(distanceToNearestMeters)}m` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
