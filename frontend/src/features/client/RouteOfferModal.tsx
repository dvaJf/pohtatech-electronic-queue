import React, { useId, useRef } from 'react';
import {
  CloseCircleIcon,
  MapPointIcon,
  RouteIcon,
  TicketIcon,
} from '@solar-icons/react/linear';
import { useModalFocus } from '../../hooks/useModalFocus';
import type { RankedBranch } from './map/branchLocations';

interface RouteOfferModalProps {
  branch: RankedBranch;
  origin?: { lat: number; lng: number };
  timeSavedMinutes?: number;
  onClose: () => void;
  onTakeTicket: (branchId: string) => void;
  onOpenMap: (branchId: string) => void;
}

export function RouteOfferModal({
  branch,
  origin,
  timeSavedMinutes = 0,
  onClose,
  onTakeTicket,
  onOpenMap,
}: RouteOfferModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(true, dialogRef, onClose);
  const routeOrigin = origin ? `${origin.lat},${origin.lng}` : '';
  const directionsUrl = `https://yandex.ru/maps/?rtext=${routeOrigin}~${branch.lat},${branch.lng}&rtt=pd`;

  return (
    <div
      data-testid="route-offer-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs animate-in fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="route-offer-dialog"
        className="relative w-full max-w-md space-y-5 rounded-[var(--radius-overlay)] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-5 font-[var(--font)] text-[var(--text-primary)] shadow-[var(--shadow-md)] sm:p-6"
      >
        <header className="min-w-0 pr-10">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Пеший маршрут</p>
          <h2 id={titleId} className="text-lg font-bold leading-tight text-[var(--text-primary)]">{branch.name}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{branch.address}</p>
        </header>

        <div className="rounded-[var(--radius-card)] border border-emerald-200 bg-[var(--color-success-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-success)]">
          <p>Суммарно ~{Math.round(branch.totalMinutes)} мин: {Math.round(branch.travelMinutes)} мин дорога + {Math.round(branch.waitMinutes)} мин очередь</p>
          {timeSavedMinutes > 0 && <p className="mt-1">Экономия ~{timeSavedMinutes} мин относительно ближайшего</p>}
        </div>

        <div className="space-y-2.5">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            <RouteIcon size={18} aria-hidden />
            <span>Проложить пеший маршрут в Яндекс.Картах</span>
          </a>
          <button
            type="button"
            onClick={() => { onClose(); onTakeTicket(branch.id); }}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-primary)] bg-[var(--surface-card)] px-4 py-2.5 text-sm font-bold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-soft)]"
          >
            <TicketIcon size={18} aria-hidden />
            <span>Взять талон в это отделение</span>
          </button>
          <button
            type="button"
            onClick={() => { onClose(); onOpenMap(branch.id); }}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <MapPointIcon size={18} aria-hidden />
            <span>Посмотреть на карте</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          aria-label="Закрыть предложение маршрута"
        >
          <CloseCircleIcon size={22} aria-hidden />
        </button>
      </div>
    </div>
  );
}
