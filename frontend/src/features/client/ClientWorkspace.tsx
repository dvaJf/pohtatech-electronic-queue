import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../../api/client/clientApi';
import type { BranchWorkload } from '../../api/client/clientApi';
import { getMe } from '../../api/authApi';
import { Appointment, Branch, Service, Ticket, TicketStatus, TicketSource, QueuePosition, TicketETA, NotificationCapabilities, NotificationChannel, NotificationSubscription } from '../../api/client/types';
import { CalendarClock, Ticket as TicketIcon, ListChecks, ChevronLeft, ChevronRight, MapPin, Clock, Check, Sparkles, Building2, AlertCircle, CheckCircle2, Navigation, X, Search, Zap, Star, Loader2, MapPinOff, Bell, Mail, Calendar, ChevronDown, Phone } from 'lucide-react';
import './client.css';
import './kiosk.css';
import { formatMoscowDate, formatMoscowDateTime, formatMoscowTime, parseMoscowDatetimeLocal, toMoscowDatetimeLocal } from '../../utils/time';
import { PochtaEmblem } from '../../components/common/PochtaBrand';
import { BranchWorkloadCard } from './BranchWorkloadCard';
import { Appointment24hPicker } from './Appointment24hPicker';
import { useGeofencing, GeofenceSimulationMode, calculateHaversineDistanceMeters, DEFAULT_GEOFENCE_THRESHOLD_METERS } from './arrival';
import { NearbyBranchCard } from './arrival/NearbyBranchCard';
import { RouteOfferModal } from './RouteOfferModal';
import { BranchMapModal } from './map/BranchMapModal';
import { calculateBranchTotalTime, isUsableDurationMinutes, MAX_QUEUE_WAIT_MINUTES, MAX_ROUTE_TRAVEL_MINUTES, MOSCOW_BRANCHES, BranchLocation, RankedBranch } from './map/branchLocations';

import { matchBranchLocation, matchesUserDefaultBranch, getUserDefaultBranchId } from './map/liveBranches';
import { canShowNearbyBranchCard, updateNearbyVisits, dismissNearbyVisit, type NearbyVisitState } from './arrival/arrivalPolicy';
import { VisitRatingSheet } from './rating/VisitRatingSheet';
import { shouldOfferVisitRating } from './rating/visitRatingPolicy';
import { BRANCH_PAGE_SIZES, BranchPage, BranchPageSize, getLandmarkPresentation, paginateBranches } from './branchOptions';
import { saveClientServiceRecord, resolveOperatorName } from './serviceHistory';
import { YandexIcon } from '../../components/common/YandexIcon';
import { getBranchScheduleStatus } from './map/branchSchedule';
import { WeeklyScheduleView } from './map/WeeklyScheduleView';
import { HomeHero } from './home/HomeHero';
import { SmartRouteHero } from './home/SmartRouteHero';
import { AppointmentCalendarMenu } from './calendar/AppointmentCalendarMenu';
import { isAppointmentCalendarEventAvailable } from './calendar/appointmentCalendar';

// calculateSmartRouting is the product-level routing policy represented by smartRouting below.

const MY_TICKETS_POLL_INTERVAL_MS = 2000;
const HOME_TICKET_POLL_INTERVAL_MS = 12000;
const terminalStatuses = new Set<TicketStatus>(['COMPLETED', 'CANCELLED', 'NO_SHOW']);

const STORAGE_BRANCH_KEY = 'client_selected_branch_id';
const STORAGE_SERVICE_KEY = 'client_selected_service_id';
const STORAGE_TICKETS_KEY = 'client_active_ticket_ids';
const STORAGE_APPOINTMENTS_KEY = 'client.appointments';
const STORAGE_MGMT_TOKENS_KEY = 'client_management_tokens';
const STORAGE_VISIT_RATINGS_KEY = 'client_visit_ratings';
const STORAGE_PENDING_IDEMPOTENCY_KEY = 'client_pending_idempotency';
const ANON_SCOPE = 'anon';

type ClientScreen = 'home' | 'booking' | 'walkin' | 'my';

function getTicketOperatorName(ticket: Ticket): string {
  return resolveOperatorName(ticket);
}

function getCompletedTicketMetadata(ticket: Ticket) {
  const windowText = ticket.window?.number ? `Окно №${ticket.window.number}` : 'Окно №1';
  const operatorName = getTicketOperatorName(ticket);

  const startRaw = ticket.serviceStartedAt || ticket.calledAt || ticket.createdAt;
  const endRaw = ticket.completedAt || ticket.serviceStartedAt || ticket.calledAt || ticket.createdAt;

  const startDate = startRaw ? new Date(startRaw) : null;
  const endDate = endRaw ? new Date(endRaw) : null;

  const validStart = Boolean(startDate && !isNaN(startDate.getTime()));
  const validEnd = Boolean(endDate && !isNaN(endDate.getTime()));

  // Дата: DD.MM.YYYY
  const dateStr = validEnd && endDate
    ? formatMoscowDate(endDate)
    : validStart && startDate
    ? formatMoscowDate(startDate)
    : formatMoscowDate(new Date());

  // Время работы (начало - конец): HH:MM — HH:MM
  const startTimeStr = validStart && startDate
    ? formatMoscowTime(startDate, { hour: '2-digit', minute: '2-digit', second: undefined })
    : '—';
  const endTimeStr = validEnd && endDate
    ? formatMoscowTime(endDate, { hour: '2-digit', minute: '2-digit', second: undefined })
    : '—';
  const timeRange = `${startTimeStr} — ${endTimeStr}`;

  // Общее время работы:
  let durationStr = '—';
  if (validStart && validEnd && startDate && endDate) {
    const diffSec = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 1000));
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    if (mins === 0 && secs === 0) {
      durationStr = '< 1 мин';
    } else if (mins === 0) {
      durationStr = `${secs} сек`;
    } else if (secs === 0) {
      durationStr = `${mins} мин`;
    } else {
      durationStr = `${mins} мин ${secs} сек`;
    }
  }

  return {
    windowText,
    operatorName,
    dateStr,
    timeRange,
    durationStr,
  };
}

interface VisitRatingHistory {
  pending: Ticket[];
  dismissed: string[];
}

function visitRatingKeyFor(scope: string): string { return `${STORAGE_VISIT_RATINGS_KEY}:${scope}`; }

function getVisitRatingHistory(scope: string): VisitRatingHistory {
  const empty: VisitRatingHistory = { pending: [], dismissed: [] };
  try {
    const value = JSON.parse(localStorage.getItem(visitRatingKeyFor(scope)) || 'null');
    if (!value || typeof value !== 'object') return empty;
    return {
      pending: Array.isArray(value.pending) ? value.pending.filter((item: Ticket) => item?.status === 'COMPLETED' && typeof item.id === 'string') : [],
      dismissed: Array.isArray(value.dismissed) ? value.dismissed.filter((id: unknown): id is string => typeof id === 'string') : [],
    };
  } catch { return empty; }
}

function saveVisitRatingHistory(scope: string, history: VisitRatingHistory) {
  try { localStorage.setItem(visitRatingKeyFor(scope), JSON.stringify(history)); } catch { /* local feedback is optional */ }
}

function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localDateTimeValue(date: Date): string {
  return toMoscowDatetimeLocal(date);
}

function statusMessage(status: TicketStatus, source?: TicketSource): string {
  switch (status) {
    case 'WAITING': return 'Вы в очереди';
    case 'CALLED': return 'Вас вызывают';
    case 'SERVING': return 'Идёт обслуживание';
    case 'COMPLETED': return 'Обслуживание завершено';
    case 'CANCELLED': return source === 'APPOINTMENT' ? 'Запись отменена' : 'Талон отменён';
    case 'NO_SHOW': return 'Вы не подошли к окну';
    case 'SCHEDULED': return 'Запись подтверждена';
    default: return 'Статус обновляется';
  }
}

function friendlyError(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    if (error.message.includes('NO_OPEN_WINDOW')) return 'Нет свободных или открытых окон для выбранной услуги';
    if (error.message.includes('INVALID_TIME')) return 'Выбранное время уже недоступно. Выберите другое время.';
    if (error.message.includes('PAST_TIME')) return 'Нельзя записаться на прошедшее время';
    return error.message;
  }
  return fallback;
}

function StatusBadge({ status, source }: { status: TicketStatus; source?: TicketSource }) {
  return <span className={`cx-badge cx-badge-${status.toLowerCase()}`}>{statusMessage(status, source)}</span>;
}

function TelegramIcon({ size = 18 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#229ED9"/><path d="M17.67 6.99 5.93 11.52c-.8.32-.8.76-.15.96l3.01.94 1.16 3.55c.14.39.07.55.48.55.32 0 .46-.15.64-.32l1.46-1.42 3.04 2.24c.56.31.96.15 1.1-.52l2-9.42c.2-.82-.31-1.19-1-0.88Zm-8.41 6.15 6.79-4.28c.34-.2.65-.09.4.14l-5.5 4.97-.22 2.42-1.47-3.26Z" fill="white"/></svg>;
}

function NotificationControls({ ticket, managementToken }: { ticket: Ticket; managementToken?: string }) {
  const [email, setEmail] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState(false);
  const [subscriptions, setSubscriptions] = useState<NotificationSubscription[]>([]);
  const [capabilities, setCapabilities] = useState<NotificationCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState(false);
  const [subscriptionsError, setSubscriptionsError] = useState(false);
  const [profilePushEnabled, setProfilePushEnabled] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('user_browser_push_enabled') !== 'false';
    }
    return true;
  });
  const [ticketPushDisabled, setTicketPushDisabled] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(`ticket_webpush_disabled:${ticket.id}`) === 'true';
    }
    return false;
  });

  useEffect(() => {
    const handleUpdate = () => {
      if (typeof localStorage !== 'undefined') {
        setProfilePushEnabled(localStorage.getItem('user_browser_push_enabled') !== 'false');
        setTicketPushDisabled(localStorage.getItem(`ticket_webpush_disabled:${ticket.id}`) === 'true');
      }
    };
    window.addEventListener('pochta:notifications_changed', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('pochta:notifications_changed', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [ticket.id]);

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(`ticket_notif_enabled:${ticket.id}`);
      if (saved !== null) return saved === 'true';
    }
    return true;
  });
  const token = managementToken || ticket.managementToken || undefined;
  const canManage = Boolean(token);
  const refresh = useCallback(async () => {
    setCapabilitiesError(false);
    setSubscriptionsError(false);
    try {
      setCapabilities(await api.getNotificationCapabilities());
    } catch {
      setCapabilitiesError(true);
    }
    if (!token) {
      setSubscriptions([]);
      return;
    }
    try {
      const subs = await api.listNotificationSubscriptions(ticket.id, token);
      setSubscriptions(subs);
      const tgSub = subs.find(s => s.channel === 'TELEGRAM' && s.enabled && s.destination && /^\d+$/.test(s.destination));
      if (tgSub && tgSub.destination && typeof localStorage !== 'undefined') {
        localStorage.setItem('user_telegram_chat_id', tgSub.destination);
        localStorage.setItem('user_telegram_connected', 'true');
      }
    } catch {
      setSubscriptionsError(true);
    }
  }, [ticket.id, token]);
  useEffect(() => { void refresh(); }, [refresh]);
  const connected = (channel: NotificationChannel) => subscriptions.find(item => item.channel === channel && item.enabled);
  const unavailable = (channel: 'telegram' | 'webPush' | 'email') => capabilities ? !capabilities[channel].enabled : true;

  // Auto-subscribe Telegram if user explicitly connected it in their profile
  useEffect(() => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('user_telegram_connected') === 'true') {
      const isTicketTgDisabled = localStorage.getItem(`ticket_telegram_disabled:${ticket.id}`) === 'true';
      const storedChatId = localStorage.getItem('user_telegram_chat_id');
      if (!isTicketTgDisabled && token && capabilities?.telegram?.enabled && !connected('TELEGRAM') && busy !== 'TELEGRAM' && storedChatId) {
        api.saveNotificationSubscription(ticket.id, 'TELEGRAM', storedChatId, token)
          .then(() => refresh())
          .catch(() => {});
      }
    }
  }, [ticket.id, token, capabilities?.telegram?.enabled, subscriptions.length, busy]);

  // Auto-subscribe Browser Push by default on new ticket creation if profile enabled
  useEffect(() => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('user_browser_push_enabled') !== 'false') {
      const isTicketPushDisabled = localStorage.getItem(`ticket_webpush_disabled:${ticket.id}`) === 'true';
      if (!isTicketPushDisabled && token && capabilities?.webPush?.enabled && !connected('WEB_PUSH') && busy !== 'WEB_PUSH' && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        push();
      }
    }
  }, [ticket.id, token, capabilities?.webPush?.enabled, subscriptions.length, busy]);

  const managementUnavailable = 'Для этого талона управление уведомлениями недоступно. Создайте новый талон.';
  const disconnect = async (channel: NotificationChannel) => {
    if (channel === 'WEB_PUSH') {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`ticket_webpush_disabled:${ticket.id}`, 'true');
        window.dispatchEvent(new Event('pochta:notifications_changed'));
      }
      setTicketPushDisabled(true);
    }
    if (channel === 'TELEGRAM') {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`ticket_telegram_disabled:${ticket.id}`, 'true');
      }
    }
    const item = connected(channel);
    if (!item) {
      if (channel === 'WEB_PUSH') {
        setNotice('Уведомления браузера отключены для этого талона.');
      }
      return;
    }
    setBusy(channel);
    try {
      await api.removeNotificationSubscription(ticket.id, channel, item.id, token);
      await refresh();
      if (channel === 'WEB_PUSH') {
        setNotice('Уведомления браузера отключены для этого талона.');
      }
    } catch (e) {
      setNotice(friendlyError(e, 'Не удалось отключить уведомления'));
    } finally {
      setBusy(null);
    }
  };
  const telegram = async () => {
    setBusy('TELEGRAM');
    setTelegramError(false);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`ticket_telegram_disabled:${ticket.id}`);
    }
    try {
      const storedChatId = typeof localStorage !== 'undefined' ? (localStorage.getItem('user_telegram_chat_id') || '') : '';
      if (storedChatId) {
        await api.saveNotificationSubscription(ticket.id, 'TELEGRAM', storedChatId, token);
        await refresh();
        setNotice('Telegram-уведомления включены.');
      } else {
        const url = await api.telegramLink(ticket.id, token);
        window.open(url, '_blank', 'noopener,noreferrer');
        setNotice('Откройте Telegram и нажмите /start для завершения привязки.');
      }
    } catch (e) {
      setTelegramError(true);
      setNotice(friendlyError(e, 'Не удалось подключить Telegram'));
    } finally {
      setBusy(null);
    }
  };
  const save = async (channel: 'EMAIL', value: string) => { const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); if (!valid) { setNotice('Введите корректный email.'); return; } setBusy(channel); try { await api.saveNotificationSubscription(ticket.id, channel, value, token); await refresh(); } catch (e) { setNotice(friendlyError(e, 'Не удалось сохранить уведомления')); } finally { setBusy(null); } };
  const push = async () => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('user_browser_push_enabled') === 'false') {
      setNotice('Уведомления браузера отключены в вашем профиле. Включить их можно в профиле пользователя.');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setNotice('Этот браузер не поддерживает системные уведомления.'); return; }
    if (Notification.permission === 'denied') { setNotice('Уведомления запрещены в настройках браузера.'); return; }
    const key = capabilities?.webPush?.vapidPublicKey || (import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY as string | undefined);
    if (!capabilities?.webPush.enabled || !key) { setNotice('Уведомления браузера временно недоступны.'); return; }
    setBusy('WEB_PUSH');
    try {
      if (await Notification.requestPermission() !== 'granted') { setNotice('Уведомления запрещены в настройках браузера.'); return; }
      await navigator.serviceWorker.register('/sw.js');
      const reg = await navigator.serviceWorker.ready;
      const padding = '='.repeat((4 - (key.length % 4)) % 4);
      const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const bytes = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) { bytes[i] = rawData.charCodeAt(i); }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      await api.saveNotificationSubscription(ticket.id, 'WEB_PUSH', JSON.stringify(sub), token);
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`ticket_webpush_disabled:${ticket.id}`);
      }
      setTicketPushDisabled(false);
      await refresh();
    } catch {
      setNotice('Не удалось включить уведомления браузера. Повторите попытку.');
    } finally {
      setBusy(null);
    }
  };
  const action = (channel: NotificationChannel, label: string, onClick: () => void, providerUnavailable = false) => connected(channel) ? <button type="button" className="cx-notification-link" disabled={busy !== null} onClick={() => disconnect(channel)}>Отключить</button> : <button type="button" className="cx-btn cx-btn-secondary" disabled={busy !== null || providerUnavailable || !canManage} onClick={onClick}>{busy === channel ? <Loader2 className="w-4 h-4 animate-spin" /> : label}</button>;
  const telegramAction = () => { if (!capabilities || unavailable('telegram')) return null; if (connected('TELEGRAM')) return <button type="button" className="cx-notification-link" disabled={busy !== null} onClick={() => disconnect('TELEGRAM')}>Отключить</button>; if (telegramError) return <button type="button" className="cx-btn cx-btn-secondary" disabled={busy !== null || !canManage} onClick={telegram}>Повторить</button>; return <button type="button" className="cx-btn cx-btn-secondary" disabled={busy !== null || !canManage} onClick={telegram}>{busy === 'TELEGRAM' ? <span className="inline-flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Открываем Telegram…</span> : 'Подключить Telegram'}</button>; };
  const webPushAction = () => {
    if (!capabilities || unavailable('webPush')) return null;
    // 1. Если в профиле отключено -> в талоне включить нельзя!
    if (!profilePushEnabled) {
      return (
        <span
          className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 select-none cursor-help inline-block"
          title="Включить браузерные уведомления можно только в настройках вашего профиля (иконка профиля в шапке)"
          onClick={() => setNotice('Уведомления браузера отключены в вашем профиле. Включить их можно только в профиле пользователя.')}
        >
          Только в профиле
        </span>
      );
    }
    // 2. Если в профиле включено, но отключено для этого талона:
    if (ticketPushDisabled) {
      return (
        <button
          type="button"
          className="cx-btn cx-btn-secondary"
          disabled={busy !== null || !canManage}
          onClick={async () => {
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem(`ticket_webpush_disabled:${ticket.id}`);
            }
            setTicketPushDisabled(false);
            setNotice('Уведомления браузера включены для этого талона.');
            await push();
          }}
        >
          {busy === 'WEB_PUSH' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Включить'}
        </button>
      );
    }
    // 3. Если активно для этого талона -> кнопка «Отключить»
    return (
      <button
        type="button"
        className="cx-notification-link text-rose-600 hover:text-rose-700 font-bold"
        disabled={busy !== null}
        onClick={() => void disconnect('WEB_PUSH')}
      >
        Отключить
      </button>
    );
  };
  const providerAction = (provider: 'telegram' | 'webPush', channel: NotificationChannel, label: string, onClick: () => void) =>
    capabilities && !unavailable(provider)
      ? (channel === 'TELEGRAM' ? telegramAction() : channel === 'WEB_PUSH' ? webPushAction() : action(channel, label, onClick))
      : null;
  const subscriptionForm = (provider: 'email', form: React.ReactNode) => capabilities && !unavailable(provider) ? form : null;
  const channelText = (channel: NotificationChannel, defaultDesc: string, unavailMsg?: string) => {
    if (channel === 'WEB_PUSH') {
      if (!profilePushEnabled) {
        return 'Отключено в профиле. Включить можно только в профиле пользователя.';
      }
      if (ticketPushDisabled) {
        return 'Отключено для этого талона (на другие талоны будет приходить)';
      }
      return '✓ Уведомления браузера включены';
    }
    if (connected(channel)) {
      if (channel === 'TELEGRAM') return '✓ Telegram подключён';
      return `✓ ${connected(channel)?.destination || 'Подключено'}`;
    }
    if (channel === 'TELEGRAM' && telegramError) return 'Не удалось подключить Telegram';
    return unavailMsg || defaultDesc;
  };
  const row = (icon: React.ReactNode, title: string, description: string, channel: NotificationChannel, content: React.ReactNode, unavailable?: string) => <div className="cx-notification-row"><div className="cx-notification-icon">{icon}</div><div className="cx-notification-main"><strong>{title}</strong><p>{channelText(channel, description, unavailable)}</p>{content}</div></div>;
  const emailForm = <div className="cx-notification-form"><label className="sr-only" htmlFor={`email-${ticket.id}`}>Email для подтверждения записи</label><input id={`email-${ticket.id}`} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" disabled={busy !== null || !canManage || unavailable('email')}/><button type="button" className="cx-btn cx-btn-secondary" disabled={busy !== null || !canManage || unavailable('email')} onClick={() => save('EMAIL', email)}>{busy === 'EMAIL' ? <Loader2 className="w-4 h-4 animate-spin"/> : 'Получить подтверждение'}</button></div>;
  const unavailableMessage = (provider: 'telegram' | 'webPush' | 'email', label: string) => {
    if (!capabilities) return 'Проверяем доступность канала…';
    if (!unavailable(provider)) return undefined;
    if (provider === 'telegram') return 'Telegram временно недоступен';
    if (provider === 'webPush') return 'Уведомления браузера временно недоступны';
    return `${label} временно недоступен.`;
  };

  const handleToggleSwitch = async (val: boolean) => {
    setNotificationsEnabled(val);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`ticket_notif_enabled:${ticket.id}`, String(val));
    }
    if (!val) {
      const active = subscriptions.filter(s => s.enabled);
      for (const s of active) {
        try {
          await api.removeNotificationSubscription(ticket.id, s.channel, s.id, token);
        } catch {}
      }
      if (active.length > 0) {
        await refresh();
      }
      setNotice('Уведомления по талону выключены.');
    } else {
      setNotice('Уведомления по талону включены. Выберите удобный канал получения сообщений ниже.');
    }
  };

  const isTgProfileEnabled = typeof localStorage !== 'undefined' && localStorage.getItem('user_telegram_connected') === 'true';
  const isPushProfileEnabled = typeof localStorage !== 'undefined' ? localStorage.getItem('user_browser_push_enabled') !== 'false' : true;
  const isSmsProfileEnabled = typeof localStorage !== 'undefined' && (localStorage.getItem('user_sms_enabled') === 'true' || Boolean(localStorage.getItem('user_phone')));

  const [tgOptState, setTgOptState] = useState<boolean | null>(null);
  const isTgActive = tgOptState !== null 
    ? tgOptState 
    : (connected('TELEGRAM') && typeof localStorage !== 'undefined' && localStorage.getItem(`ticket_telegram_disabled:${ticket.id}`) !== 'true');

  const isPushActive = isPushProfileEnabled && !ticketPushDisabled;
  const [smsTicketEnabled, setSmsTicketEnabled] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(`ticket_sms_disabled:${ticket.id}`) !== 'true';
    }
    return true;
  });

  const handleToggleTgChannel = async (target: boolean) => {
    setTgOptState(target);
    if (target) {
      await telegram();
    } else {
      await disconnect('TELEGRAM');
    }
  };

  const handleTogglePushChannel = async (target: boolean) => {
    if (target) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`ticket_webpush_disabled:${ticket.id}`);
        localStorage.setItem('user_browser_push_enabled', 'true');
      }
      setTicketPushDisabled(false);
      setProfilePushEnabled(true);
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {}
      }
      if (token && capabilities?.webPush?.enabled) {
        await push();
      }
      setNotice('Уведомления в браузере включены (звуковой гонг и push-оповещения).');
    } else {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`ticket_webpush_disabled:${ticket.id}`, 'true');
      }
      setTicketPushDisabled(true);
      if (connected('WEB_PUSH')) {
        await disconnect('WEB_PUSH');
      }
      setNotice('Уведомления в браузере для этого талона отключены.');
    }
  };

  const handleToggleSmsChannel = (target: boolean) => {
    if (!isSmsProfileEnabled) return;
    setSmsTicketEnabled(target);
    if (typeof localStorage !== 'undefined') {
      if (target) {
        localStorage.removeItem(`ticket_sms_disabled:${ticket.id}`);
      } else {
        localStorage.setItem(`ticket_sms_disabled:${ticket.id}`, 'true');
      }
    }
    setNotice(target ? 'СМС-уведомления по талону включены.' : 'СМС-уведомления по талону отключены.');
  };

  const renderChannelRow = (
    icon: React.ReactNode,
    title: string,
    description: string,
    profileEnabled: boolean,
    ticketActive: boolean,
    onToggle: (checked: boolean) => void,
    busyChannel?: boolean
  ) => (
    <div className="p-3 rounded-2xl border border-slate-200/90 bg-white flex items-center justify-between gap-3 shadow-2xs">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 mt-0.5 text-slate-700">
          {icon}
        </div>
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <strong className="text-xs font-bold text-slate-900">{title}</strong>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${!profileEnabled ? 'bg-slate-100 text-slate-400' : ticketActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {!profileEnabled ? 'Отключено в профиле' : ticketActive ? 'Включено' : 'Выключено'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-tight">
            {!profileEnabled ? 'Для активации включите этот канал в профиле' : description}
          </p>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={profileEnabled && ticketActive}
        disabled={!profileEnabled || busyChannel}
        onClick={() => onToggle(!ticketActive)}
        title={!profileEnabled ? 'Канал отключен в профиле пользователя' : ticketActive ? 'Отключить для этого талона' : 'Включить для этого талона'}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent p-0 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#003B73] focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed ${
          profileEnabled && ticketActive ? 'bg-[#003B73]' : 'bg-slate-300'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
            profileEnabled && ticketActive ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );

  return (
    <section className="cx-notifications space-y-2" aria-label="Каналы уведомлений талона">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
        Каналы уведомлений по талону:
      </div>
      {renderChannelRow(
        <TelegramIcon size={18} />,
        'Telegram',
        'Сообщения о движении очереди и вызове к окну',
        true,
        Boolean(isTgActive),
        (val) => void handleToggleTgChannel(val),
        busy === 'TELEGRAM'
      )}
      {renderChannelRow(
        <Bell size={18} />,
        'Браузер',
        'Всплывающие push-уведомления на устройстве',
        isPushProfileEnabled,
        Boolean(isPushActive),
        (val) => void handleTogglePushChannel(val),
        busy === 'WEB_PUSH'
      )}
      {renderChannelRow(
        <Phone size={18} />,
        'СМС',
        'Бесплатное СМС-напоминание и вызов к окну',
        isSmsProfileEnabled,
        smsTicketEnabled,
        (val) => handleToggleSmsChannel(val)
      )}

      {subscriptionsError && token && <p className="cx-notification-status" role="status" aria-live="polite">Не удалось загрузить настройки уведомлений. <button type="button" className="cx-notification-link" onClick={() => void refresh()}>Повторить</button></p>}
      {capabilitiesError && <p className="cx-notification-status" role="status" aria-live="polite">Не удалось определить доступность каналов. <button type="button" className="cx-notification-link" onClick={() => void refresh()}>Повторить</button></p>}
      {notice && <p className="cx-notification-status" role="status" aria-live="polite">{notice}</p>}
    </section>
  );
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      role="alert"
      className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm animate-fade-in"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
        <span className="cx-message-text">{message}</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-red-400 hover:text-red-700 p-1 rounded-lg hover:bg-red-100 transition-colors shrink-0 leading-none font-bold"
        aria-label="Закрыть ошибку"
      >
        ✕
      </button>
    </div>
  );
}

function NoticeBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm animate-fade-in"
    >
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-emerald-500 hover:text-emerald-800 p-1 rounded-lg hover:bg-emerald-100 transition-colors shrink-0 leading-none font-bold"
        aria-label="Закрыть уведомление"
      >
        ✕
      </button>
    </div>
  );
}

function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="cx-steps" aria-label="Этапы оформления">
      {steps.map((label, index) => (
        <li
          key={label}
          className={`cx-step${index < current ? ' cx-step-done' : ''}${index === current ? ' cx-step-active' : ''}`}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="cx-step-dot">{index < current ? <Check size={13} strokeWidth={3} aria-hidden /> : index + 1}</span>
          <span className="cx-step-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

interface BranchCardProps {
  branch: Branch;
  selected: boolean;
  onSelect: () => void;
  distanceMeters?: number;
  travelMinutes?: number;
  waitMinutes?: number;
  totalMinutes?: number;
  isFastest?: boolean;
  isClosest?: boolean;
  isDefault?: boolean;
  timeSavedMinutes?: number;
  location?: BranchLocation;
  ratingAverage?: number | null;
  ratingCount?: number;
  workload?: BranchWorkload;
}

interface RecommendationListBranch {
  id: string;
  name: string;
  travelMinutes?: number;
  waitMinutes?: number;
  totalMinutes?: number;
}

function BranchRecommendation({
  nearestBranch,
  fastestBranch,
  savingMinutes,
}: {
  nearestBranch: RecommendationListBranch | null;
  fastestBranch: RecommendationListBranch | null;
  savingMinutes: number;
}) {
  if (!nearestBranch || !fastestBranch
      || !Number.isFinite(fastestBranch.travelMinutes)
      || !Number.isFinite(fastestBranch.waitMinutes)
      || !Number.isFinite(fastestBranch.totalMinutes)) return null;
  const isNearest = nearestBranch.id === fastestBranch.id;
  const total = Math.round(fastestBranch.totalMinutes!);
  const travel = Math.round(fastestBranch.travelMinutes!);
  const wait = Math.round(fastestBranch.waitMinutes!);
  const saving = Number.isFinite(savingMinutes) && savingMinutes > 0 ? Math.round(savingMinutes) : 0;

  return (
    <div className="p-3.5 bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs">
          <Sparkles size={16} />
        </div>
        <div className="text-left min-w-0">
          <div className="font-extrabold text-emerald-950 flex items-center gap-1.5 flex-wrap">
            <span>{isNearest ? 'Рекомендуем ближайшее к вам' : 'Рекомендуем быстрее всего'}: {fastestBranch.name} · ~{total} мин</span>
            {saving > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                Экономия ~{saving} мин относительно ближайшего
              </span>
            )}
          </div>
          <p className="text-[11px] text-emerald-800 mt-0.5">
            Суммарно ~{total} мин: {travel} мин дорога + {wait} мин очередь
          </p>
        </div>
      </div>
    </div>
  );
}

function BranchCard({
  branch,
  selected,
  onSelect,
  distanceMeters,
  travelMinutes,
  waitMinutes,
  totalMinutes,
  isFastest,
  isClosest,
  isDefault,
  timeSavedMinutes,
  location,
  ratingAverage, ratingCount,
  workload,
}: BranchCardProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [showWeeklySchedule, setShowWeeklySchedule] = useState(false);
  const photoUrl = location?.photos?.[0];
  const landmark = getLandmarkPresentation(location);
  const distText = typeof distanceMeters === 'number'
    ? (distanceMeters < 1000 ? `${distanceMeters} м` : `${(distanceMeters / 1000).toFixed(1)} км`)
    : null;

  const scheduleStatus = getBranchScheduleStatus(
    { code: location?.code, name: branch.name, workHours: branch.workHours },
    workload
  );
  const isClosed = scheduleStatus.isClosed;

  return (
    <button
      type="button"
      className={`cx-choice active:scale-[0.99] transition-all relative overflow-hidden ${
        selected ? ' cx-choice-selected' : ''
      } ${isDefault && !selected ? 'border-[#003B73]/60 bg-blue-50/30 ring-1 ring-[#003B73]/25 shadow-xs' : ''} ${
        isFastest && !isClosed ? 'ring-2 ring-emerald-500/60 bg-emerald-50/20' : ''
      } ${
        isClosed ? 'bg-slate-50/70 border-slate-200 opacity-90' : ''
      }`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3 w-full min-w-0 text-left">
        {photoUrl && !photoFailed && (
          <img
            src={photoUrl}
            alt="Иллюстрация почтового отделения"
            loading="lazy"
            decoding="async"
            onError={() => setPhotoFailed(true)}
            className={`w-20 h-16 sm:w-24 sm:h-20 rounded-xl object-cover shrink-0 bg-slate-100 ${isClosed ? 'grayscale' : ''}`}
          />
        )}
        <div className="min-w-0 flex-1">
          {/* Верхняя строка: Рейтинг и бейджи слева, статус закрытия в правом верхнем углу */}
          <div className="flex items-center justify-between gap-1.5 mb-1.5 w-full flex-wrap">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {isDefault && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-[#003B73] text-white border border-[#003B73] shadow-xs">
                  <Building2 size={11} className="text-white" />
                  <span>Отделение по умолчанию</span>
                </span>
              )}
              {!isClosed && (
                <>
                  {isFastest && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs">
                      <Zap size={11} className="fill-emerald-600 text-emerald-600" />
                      <span>Рекомендуем: быстрее всего</span>
                      {typeof totalMinutes === 'number' && <span className="opacity-80">· ~{totalMinutes} мин</span>}
                    </span>
                  )}
                  {isFastest && typeof timeSavedMinutes === 'number' && timeSavedMinutes > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      Экономия ~{timeSavedMinutes} мин vs ближайшего
                    </span>
                  )}
                  {isClosest && !isFastest && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                      <Navigation size={10} />
                      <span>Ближайшее к вам</span>
                    </span>
                  )}
                </>
              )}
              {location?.rating && location.rating > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800" title="Рейтинг Яндекс Карт">
                  <YandexIcon size={11} className="shrink-0" />
                  <span>{location.rating.toFixed(1)} · Яндекс Карты</span>
                </span>
              ) : null}
              {ratingAverage !== null && typeof ratingAverage === 'number' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                  <Star size={10} className="fill-amber-400 text-amber-400" />
                  <span>{ratingAverage.toFixed(1)} · {ratingCount ?? 0} оценок</span>
                </span>
              ) : <span className="text-[10px] font-semibold text-slate-500">Нет оценок</span>}
            </div>
          </div>

          <div className="flex items-start justify-between gap-2 w-full">
            <div className="flex-1 min-w-0">
              <span className="cx-choice-title text-sm sm:text-base font-extrabold">{branch.name}</span>

              {/* Расстояние, время в пути и общее расчетное время T = T_travel + T_wait */}
              {(distText || typeof totalMinutes === 'number') && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 my-1 font-medium">
                  {distText && (
                    <span className="inline-flex items-center gap-1 text-[#052F85] font-bold">
                      <Navigation size={12} className="shrink-0" />
                      <span>{distText} ({travelMinutes ?? Math.round((distanceMeters! / 1000) * 12)} мин пешком)</span>
                    </span>
                  )}
                  {typeof waitMinutes === 'number' && !isClosed && (
                    <span className="text-slate-500">
                      Очередь: ~<strong>{waitMinutes} мин</strong>
                    </span>
                  )}
                  {typeof totalMinutes === 'number' && !isClosed && (
                    <span className="text-slate-700 font-semibold">
                      Дорога + очередь: <strong>~{totalMinutes} мин</strong>
                    </span>
                  )}
                </div>
              )}

              {landmark && (
                <span className="cx-choice-meta text-xs" data-landmark-type={landmark.isMetro ? 'metro' : 'landmark'} aria-label={landmark.isMetro ? `Метро ${landmark.label}` : landmark.label}>
                  {landmark.isMetro ? (
                    <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: landmark.color }} aria-hidden />
                  ) : (
                    <Navigation size={13} aria-hidden className="shrink-0 text-slate-400" />
                  )}
                  <span>{landmark.label}</span>
                </span>
              )}

              {branch.address ? (
                <span className="cx-choice-meta text-xs">
                  <MapPin size={13} aria-hidden className="shrink-0 text-slate-400" />
                  <span className="cx-message-text">{branch.address}</span>
                </span>
              ) : null}

              {branch.workHours ? (
                <span className="cx-choice-meta text-xs">
                  <Clock size={13} aria-hidden className="shrink-0 text-slate-400" />
                  <span>{branch.workHours}</span>
                </span>
              ) : null}

              {/* Кнопка просмотра официального расписания на всю неделю и статус закрытия в правом нижнем углу */}
              <div
                className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap text-xs"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowWeeklySchedule(prev => !prev);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowWeeklySchedule(prev => !prev);
                    }
                  }}
                  className="font-bold text-[#052F85] hover:text-[#031E56] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5 hover:underline">
                    <Calendar size={13} />
                    <span>{showWeeklySchedule ? 'Скрыть расписание на неделю' : 'Расписание на всю неделю'}</span>
                    <ChevronDown size={13} className={`transition-transform duration-200 ${showWeeklySchedule ? 'rotate-180' : ''}`} />
                  </span>
                </div>

                {/* Правый нижний угол: статус закрытия */}
                {isClosed && (
                  <span className="max-w-full inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl sm:rounded-full text-[11px] font-bold bg-rose-50 border border-rose-200 text-rose-700 shadow-2xs ml-auto text-left leading-tight break-words">
                    <Clock size={11} className="text-rose-500 shrink-0 self-start mt-0.5" />
                    <span className="break-words">Отделение закрыто {scheduleStatus.closedUntilText}</span>
                  </span>
                )}
              </div>

              {showWeeklySchedule && (
                <div className="mt-2.5 w-full cursor-default" onClick={(e) => e.stopPropagation()}>
                  <WeeklyScheduleView schedule={scheduleStatus.weeklySchedule} />
                </div>
              )}
            </div>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 transition-all mt-0.5 ${selected ? 'bg-[#003B73] border-[#003B73] text-white' : 'border-slate-300 bg-white'}`}>
              {selected && <Check size={12} strokeWidth={3} />}
            </div>
          </div>
        </div>
      </div>
      {!isClosed && (
        <div className="pt-1 w-full">
          <BranchWorkloadCard branch={branch} compact />
        </div>
      )}
    </button>
  );
}

function BranchListPageControls<T>({
  pageData,
  pageSize,
  onPageSizeChange,
  onPageChange,
}: {
  pageData: BranchPage<T>;
  pageSize: BranchPageSize;
  onPageSizeChange: (size: BranchPageSize) => void;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <label className="inline-flex items-center gap-2 font-semibold text-slate-600">
        <span>Показывать:</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value) as BranchPageSize)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-bold text-slate-800 focus:border-[#052F85] focus:outline-none focus:ring-2 focus:ring-[#052F85]/20"
          aria-label="Количество отделений на странице"
        >
          {BRANCH_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <span className="font-medium text-slate-500">{pageData.items.length} из {pageData.totalItems} отделений</span>
      {pageData.totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => onPageChange(pageData.page - 1)} disabled={pageData.page === 1}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 disabled:opacity-40" aria-label="Предыдущая страница">
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-14 text-center font-semibold text-slate-600">{pageData.page} / {pageData.totalPages}</span>
          <button type="button" onClick={() => onPageChange(pageData.page + 1)} disabled={pageData.page === pageData.totalPages}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 disabled:opacity-40" aria-label="Следующая страница">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ServiceCard({ service, selected, onSelect }: { service: Service; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`cx-choice active:scale-[0.99] transition-all${selected ? ' cx-choice-selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-3 w-full">
        <div className="flex-1 min-w-0">
          <span className="cx-choice-title text-sm sm:text-base">{service.name}</span>
          <span className="cx-choice-meta text-xs">Обслуживание в порядке электронной очереди</span>
        </div>
        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 transition-all ${selected ? 'bg-[#003B73] border-[#003B73] text-white' : 'border-slate-300 bg-white'}`}>
          {selected && <Check size={12} strokeWidth={3} />}
        </div>
      </div>
    </button>
  );
}

function ticketsKeyFor(scope: string): string {
  return `${STORAGE_TICKETS_KEY}:${scope}`;
}

function appointmentsKeyFor(scope: string): string {
  return `${STORAGE_APPOINTMENTS_KEY}:${scope}`;
}

const STORAGE_TICKETS_CACHE_KEY = 'client_active_tickets_cache';

function ticketsCacheKeyFor(scope: string): string {
  return `${STORAGE_TICKETS_CACHE_KEY}:${scope}`;
}

function getCachedTickets(scope: string): Ticket[] {
  try {
    const val = sessionStorage.getItem(ticketsCacheKeyFor(scope)) || localStorage.getItem(ticketsCacheKeyFor(scope));
    if (!val) return [];
    const parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is Ticket => t && typeof t.id === 'string' && !terminalStatuses.has(t.status));
  } catch {
    return [];
  }
}

function saveCachedTickets(scope: string, ticketList: Ticket[]) {
  try {
    const active = ticketList.filter(t => !terminalStatuses.has(t.status));
    const serialized = JSON.stringify(active);
    sessionStorage.setItem(ticketsCacheKeyFor(scope), serialized);
    localStorage.setItem(ticketsCacheKeyFor(scope), serialized);
  } catch {}
}

// Талоны храним строго по владельцу: ключ `client_active_ticket_ids:<userId|anon>`.
// Используем sessionStorage и localStorage для надёжного восстановления сессии
// после перезагрузки страницы, обрыва связи или закрытия вкладки (Требование 14 ТЗ).
function getSavedTicketIds(scope: string): string[] {
  try {
    const val = sessionStorage.getItem(ticketsKeyFor(scope)) || localStorage.getItem(ticketsKeyFor(scope));
    if (!val) return [];
    const parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function addSavedTicketId(id: string, scope: string) {
  const ids = getSavedTicketIds(scope);
  if (!ids.includes(id)) {
    const updated = JSON.stringify([...ids, id]);
    try { sessionStorage.setItem(ticketsKeyFor(scope), updated); } catch {}
    try { localStorage.setItem(ticketsKeyFor(scope), updated); } catch {}
  }
}

function removeSavedTicketId(id: string, scope: string) {
  const ids = getSavedTicketIds(scope);
  const newIds = ids.filter(i => i !== id);
  if (newIds.length === 0) {
    try { sessionStorage.removeItem(ticketsKeyFor(scope)); } catch {}
    try { localStorage.removeItem(ticketsKeyFor(scope)); } catch {}
  } else {
    const updated = JSON.stringify(newIds);
    try { sessionStorage.setItem(ticketsKeyFor(scope), updated); } catch {}
    try { localStorage.setItem(ticketsKeyFor(scope), updated); } catch {}
  }
}

function mgmtTokensKeyFor(scope: string): string {
  return `${STORAGE_MGMT_TOKENS_KEY}:${scope}`;
}

function getSavedMgmtTokens(scope: string): Record<string, string> {
  try {
    const val = sessionStorage.getItem(mgmtTokensKeyFor(scope)) || localStorage.getItem(mgmtTokensKeyFor(scope));
    if (!val) return {};
    const parsed = JSON.parse(val);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function saveMgmtToken(id: string, token: string | undefined | null, scope: string) {
  if (!id || !token) return;
  const tokens = getSavedMgmtTokens(scope);
  tokens[id] = token;
  const updated = JSON.stringify(tokens);
  try { sessionStorage.setItem(mgmtTokensKeyFor(scope), updated); } catch {}
  try { localStorage.setItem(mgmtTokensKeyFor(scope), updated); } catch {}
}

function removeMgmtToken(id: string, scope: string) {
  const tokens = getSavedMgmtTokens(scope);
  if (!tokens[id]) return;
  delete tokens[id];
  const updated = JSON.stringify(tokens);
  try { sessionStorage.setItem(mgmtTokensKeyFor(scope), updated); } catch {}
  try { localStorage.setItem(mgmtTokensKeyFor(scope), updated); } catch {}
}

function getStoredIdempotencyKey(identity: string): string {
  try {
    const val = sessionStorage.getItem(STORAGE_PENDING_IDEMPOTENCY_KEY) || localStorage.getItem(STORAGE_PENDING_IDEMPOTENCY_KEY);
    if (val) {
      const parsed = JSON.parse(val);
      if (parsed && parsed.identity === identity && typeof parsed.key === 'string' && parsed.key.length > 0) {
        return parsed.key;
      }
    }
  } catch {}
  const key = makeIdempotencyKey();
  try {
    const data = JSON.stringify({ identity, key });
    sessionStorage.setItem(STORAGE_PENDING_IDEMPOTENCY_KEY, data);
    localStorage.setItem(STORAGE_PENDING_IDEMPOTENCY_KEY, data);
  } catch {}
  return key;
}

function clearStoredIdempotencyKey(identity?: string) {
  try {
    if (identity) {
      const val = sessionStorage.getItem(STORAGE_PENDING_IDEMPOTENCY_KEY) || localStorage.getItem(STORAGE_PENDING_IDEMPOTENCY_KEY);
      if (val) {
        const parsed = JSON.parse(val);
        if (parsed?.identity !== identity) return;
      }
    }
    sessionStorage.removeItem(STORAGE_PENDING_IDEMPOTENCY_KEY);
    localStorage.removeItem(STORAGE_PENDING_IDEMPOTENCY_KEY);
  } catch {}
}

try {
  sessionStorage.removeItem(STORAGE_TICKETS_KEY);
  sessionStorage.removeItem(STORAGE_APPOINTMENTS_KEY);
} catch {
  /* ignore legacy shared keys */
}

export function ClientWorkspace({ qrBranchId, kiosk = false, resetToken = 0 }: { qrBranchId?: string; kiosk?: boolean; resetToken?: number }) {
  const [screen, setScreen] = useState<ClientScreen>(qrBranchId ? 'walkin' : 'home');
  const screenRef = useRef<ClientScreen>(qrBranchId ? 'walkin' : 'home');
  screenRef.current = screen;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const servicesLoadingBranchRef = useRef<string | null>(null);
  const [confirmedServicesByBranch, setConfirmedServicesByBranch] = useState<Record<string, Service[] | null>>({});
  const pendingServicesRef = useRef(new Map<string, Promise<Service[]>>());
  const loadConfirmedServices = useCallback((targetBranchId: string) => {
    const pending = pendingServicesRef.current.get(targetBranchId);
    if (pending) return pending;
    const request = api.listServices(targetBranchId).then(slist => {
      setConfirmedServicesByBranch(previous => ({ ...previous, [targetBranchId]: slist }));
      return slist;
    }, reason => {
      setConfirmedServicesByBranch(previous => ({ ...previous, [targetBranchId]: null }));
      throw reason;
    }).finally(() => { pendingServicesRef.current.delete(targetBranchId); });
    pendingServicesRef.current.set(targetBranchId, request);
    return request;
  }, []);

  const [branchId, setBranchId] = useState(() => {
    if (qrBranchId) return qrBranchId;
    const v = sessionStorage.getItem(STORAGE_BRANCH_KEY) || (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_BRANCH_KEY) : null);
    if (v && v !== 'undefined' && v !== 'null') return v;
    const defaultBranch = typeof localStorage !== 'undefined' ? localStorage.getItem('user_default_branch_id') : null;
    return defaultBranch || '';
  });
  const [serviceId, setServiceId] = useState(() => {
    const urlServiceId = new URLSearchParams(window.location.search).get('serviceId');
    if (urlServiceId) return urlServiceId;
    const v = sessionStorage.getItem(STORAGE_SERVICE_KEY);
    return v && v !== 'undefined' && v !== 'null' ? v : '';
  });
  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [isAppointmentDateDayOff, setIsAppointmentDateDayOff] = useState(false);
  const [smsReminderEnabled, setSmsReminderEnabled] = useState(true);
  const [bookingStep, setBookingStep] = useState(0);
  const [walkinStep, setWalkinStep] = useState(qrBranchId ? 1 : 0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  const [, setFioSyncVersion] = useState(0);
  const [defaultBranchSyncVersion, setDefaultBranchSyncVersion] = useState(0);
  useEffect(() => {
    const handleFioSync = () => setFioSyncVersion(v => v + 1);
    const handleBranchSync = () => setDefaultBranchSyncVersion(v => v + 1);
    window.addEventListener('auth_fio_updated', handleFioSync);
    window.addEventListener('client_default_branch_updated', handleBranchSync);
    window.addEventListener('storage', handleFioSync);
    window.addEventListener('storage', handleBranchSync);
    return () => {
      window.removeEventListener('auth_fio_updated', handleFioSync);
      window.removeEventListener('client_default_branch_updated', handleBranchSync);
      window.removeEventListener('storage', handleFioSync);
      window.removeEventListener('storage', handleBranchSync);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Владелец талонов. Талоны храним и показываем строго по текущему пользователю,
  // чтобы новый пользователь не видел талоны, созданные другим.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const ownerScope = currentUserId ?? ANON_SCOPE;
  const [tickets, setTickets] = useState<Ticket[]>(() => getCachedTickets(ANON_SCOPE));
  const [kioskTicket, setKioskTicket] = useState<Ticket | null>(null);
  const alertedCallsRef = useRef<Set<string>>(new Set());

  // Держим актуальный scope доступным внутри колбэков без пересоздания pollAll.
  const ownerScopeRef = useRef(ownerScope);
  ownerScopeRef.current = ownerScope;
  const [appointments, setAppointments] = useState<Record<string, Appointment>>({});
  // Записи (appointments) тоже храним по владельцу, чтобы они не «переезжали» к другому пользователю.
  const appointmentsScopeRef = useRef<string | null>(null);
  useEffect(() => {
    appointmentsScopeRef.current = null;
    let loaded: Record<string, Appointment> = {};
    try { loaded = JSON.parse(sessionStorage.getItem(appointmentsKeyFor(ownerScope)) || localStorage.getItem(appointmentsKeyFor(ownerScope)) || '{}'); } catch { loaded = {}; }
    appointmentsScopeRef.current = ownerScope;
    setAppointments(loaded);
  }, [ownerScope]);
  useEffect(() => {
    if (appointmentsScopeRef.current !== ownerScope) return;
    try { sessionStorage.setItem(appointmentsKeyFor(ownerScope), JSON.stringify(appointments)); } catch { /* ignore */ }
    try { localStorage.setItem(appointmentsKeyFor(ownerScope), JSON.stringify(appointments)); } catch { /* ignore */ }
  }, [appointments, ownerScope]);

  useEffect(() => {
    const cached = getCachedTickets(ownerScope);
    if (cached.length > 0) {
      setTickets(prev => {
        if (prev.length === 0) return cached;
        const ids = new Set(prev.map(t => t.id));
        const added = cached.filter(t => !ids.has(t.id));
        return added.length > 0 ? [...prev, ...added] : prev;
      });
    }
  }, [ownerScope]);

  useEffect(() => {
    saveCachedTickets(ownerScope, tickets);
  }, [tickets, ownerScope]);

  const [positions, setPositions] = useState<Record<string, QueuePosition>>({});
  const [etas, setEtas] = useState<Record<string, TicketETA>>({});
  const [pollError, setPollError] = useState<string | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [arrivalAcknowledgedTicketIds, setArrivalAcknowledgedTicketIds] = useState<Set<string>>(new Set());
  const [visitRatingQueue, setVisitRatingQueue] = useState<Ticket[]>(() => getVisitRatingHistory(ownerScope).pending);

  useEffect(() => {
    setVisitRatingQueue(getVisitRatingHistory(ownerScope).pending);
  }, [ownerScope]);

  const [creating, setCreating] = useState(false);
  const [cancellingTicketId, setCancellingTicketId] = useState<string | null>(null);
  const [arriving, setArriving] = useState(false);

  // Live workloads belong to SmartRouteHero. Keeping this record empty here
  // preserves map/list props without starting recommendation polling on Home.
  const workloads = useMemo<Record<string, api.BranchWorkload>>(() => ({}), []);
  const locatedBranches = useMemo(() => {
    const list = branches.length > 0 ? branches : (MOSCOW_BRANCHES as unknown as Branch[]);
    return list.flatMap(b => {
      const loc = matchBranchLocation(b, MOSCOW_BRANCHES);
      if (!loc) return [];
      return [{ ...loc, ...b, address: b.address!, id: b.id }];
    });
  }, [branches]);
  // One location stream supplies recommendation, nearby visits and the map marker.
  const {
    currentCoordinates,
    simulationMode,
    setSimulationMode,
    hasRealGpsFix,
    hasReliableGpsFix,
    gpsPermissionStatus,
    requestGpsPermission,
    locationCenterRequest,
    gpsError,
  } = useGeofencing({
    branches: locatedBranches,
    initialMode: 'real_gps',
    thresholdMeters: DEFAULT_GEOFENCE_THRESHOLD_METERS, // 75m threshold
  });

  const [routeOfferBranch, setRouteOfferBranch] = useState<RankedBranch | null>(null);
  const [routeOfferTimeSaved, setRouteOfferTimeSaved] = useState(0);

  const [nearbyVisits, setNearbyVisits] = useState<NearbyVisitState>({ visits: {}, activeBranchId: null });
  const nearbyDistances = useMemo(() => locatedBranches.map(branch => ({
    id: branch.id,
    distanceMeters: calculateHaversineDistanceMeters(currentCoordinates.lat, currentCoordinates.lng, branch.lat, branch.lng),
  })), [locatedBranches, currentCoordinates.lat, currentCoordinates.lng]);
  useEffect(() => {
    setNearbyVisits(previous => updateNearbyVisits(previous, nearbyDistances, hasReliableGpsFix));
  }, [nearbyDistances, hasReliableGpsFix]);
  const nearbyBranch = hasReliableGpsFix ? locatedBranches.find(branch => branch.id === nearbyVisits.activeBranchId) ?? null : null;
  const nearbyDistanceMeters = nearbyDistances.find(branch => branch.id === nearbyBranch?.id)?.distanceMeters ?? 0;

  useEffect(() => {
    if (currentCoordinates && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('pochta_user_lat', String(currentCoordinates.lat));
        localStorage.setItem('pochta_user_lng', String(currentCoordinates.lng));
      } catch {}
    }
  }, [currentCoordinates]);

  // Map Modal State
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [mapInitialFilter, setMapInitialFilter] = useState<'all' | 'parcels' | 'letters' | 'pensions' | 'accessible'>('all');
  const [mapTargetBranchId, setMapTargetBranchId] = useState<string | null>(null);

  // Check if client already took a ticket for this branch (walkin or online appointment)
  const hasActiveTicketForBranch = useMemo(() => {
    if (!nearbyBranch) return false;
    const targetBranchId = nearbyBranch.id;

    // 1. Проверяем в текущем состоянии tickets
    if (tickets.some(t => !terminalStatuses.has(t.status) && t.branchId === targetBranchId)) {
      return true;
    }

    // 2. Проверяем в синхронном кэше активных талонов (localStorage/sessionStorage)
    const cached = getCachedTickets(ownerScope);
    if (cached.some(t => !terminalStatuses.has(t.status) && t.branchId === targetBranchId)) {
      return true;
    }

    // 3. Проверяем в предварительных записях (appointments)
    if (Object.values(appointments).some(a => a.ticket && !terminalStatuses.has(a.ticket.status) && a.ticket.branchId === targetBranchId)) {
      return true;
    }

    return false;
  }, [tickets, nearbyBranch, ownerScope, appointments]);

  // Request GPS on mount and notify header
  useEffect(() => {
    const handleGeoRequest = () => requestGpsPermission();
    const handleGeoPreset = (e: Event) => {
      const custom = e as CustomEvent<{ mode: GeofenceSimulationMode }>;
      if (custom.detail?.mode) {
        handleSimulationModeChange(custom.detail.mode);
      }
    };
    window.addEventListener('pochta:request-geo', handleGeoRequest);
    window.addEventListener('pochta:geo-preset', handleGeoPreset);
    return () => {
      window.removeEventListener('pochta:request-geo', handleGeoRequest);
      window.removeEventListener('pochta:geo-preset', handleGeoPreset);
    };
  }, [requestGpsPermission]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('pochta:geo-status', {
        detail: { status: gpsPermissionStatus, granted: gpsPermissionStatus === 'granted' },
      })
    );
  }, [gpsPermissionStatus]);

  const handleSimulationModeChange = (mode: GeofenceSimulationMode) => {
    setSimulationMode(mode);
  };

  const handleOpenMap = (filter: 'all' | 'parcels' | 'letters' | 'pensions' | 'accessible' = 'all', targetBranchId: string | null = null) => {
    setMapInitialFilter(filter);
    setMapTargetBranchId(targetBranchId);
    setIsMapModalOpen(true);
  };

  const handleSelectBranchFromMap = (b: Branch, action?: 'walkin' | 'booking') => {
    handleBranchSelect(b.id);
    setIsMapModalOpen(false);
    if (action === 'booking') {
      setScreen('booking');
      setBookingStep(1);
    } else if (action === 'walkin') {
      const scheduleStatus = getBranchScheduleStatus(b, workloads[b.id]);
      if (scheduleStatus.isClosed) {
        setScreen('booking');
        setBookingStep(1);
        setNotice('Отделение сейчас закрыто. Запись доступна на следующий рабочий день.');
        return;
      }
      setScreen('walkin');
      setWalkinStep(1);
    }
  };

  useEffect(() => {
    if (resetToken > 0) {
      setScreen('walkin');
      setWalkinStep(qrBranchId ? 1 : 0);
      setKioskTicket(null);
      setServiceId('');
      sessionStorage.removeItem(STORAGE_SERVICE_KEY);
      setError(null);
      if (qrBranchId) void fetchServices(qrBranchId);
    }
    // Kiosk idle reset intentionally restores the first walk-in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  const pollTimer = useRef<number | null>(null);
  const pollGeneration = useRef(0);
  const pollInFlight = useRef(false);
  const createLock = useRef(false);
  const requestKey = useRef<{ identity: string; key: string } | null>(null);
  const keyFor = (identity: string) => {
    if (requestKey.current?.identity === identity) return requestKey.current.key;
    const stored = getStoredIdempotencyKey(identity);
    requestKey.current = { identity, key: stored };
    return stored;
  };

  useEffect(() => {
    let active = true;
    const refreshOwner = () => {
      getMe()
        .then((me) => { if (active) setCurrentUserId(me?.id ?? null); })
        .catch(() => { if (active) setCurrentUserId(null); });
    };
    refreshOwner();
    // Реагируем на вход/выход через шапку: «мои талоны» пересчитываются для нового владельца.
    const handleAuthChanged = () => refreshOwner();
    window.addEventListener('pochta:auth', handleAuthChanged);
    return () => {
      active = false;
      window.removeEventListener('pochta:auth', handleAuthChanged);
    };
  }, []);

  const arrivalStorageKey = (ticketId: string) => `client-arrived:${ticketId}`;
  const hasArrivalAcknowledgement = (ticketId: string): boolean => {
    try { return sessionStorage.getItem(arrivalStorageKey(ticketId)) === '1'; } catch { return false; }
  };
  const rememberArrival = (ticketId: string) => {
    try { sessionStorage.setItem(arrivalStorageKey(ticketId), '1'); } catch { /* ignore */ }
  };

  const loadBranches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const loaded = await api.listBranches();
      setBranches(loaded);
      setBranchId(current => {
        if (current) return current;
        const userDefault = (typeof localStorage !== 'undefined')
          ? (localStorage.getItem('user_default_branch_id') || localStorage.getItem(STORAGE_BRANCH_KEY))
          : null;
        if (userDefault && loaded.some(b => b.id === userDefault)) {
          return userDefault;
        }
        return loaded[0]?.id || '';
      });
    } catch (err: any) {
      setError(friendlyError(err, 'Не удалось загрузить данные отделений'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  // Поиск и сортировка отделений по удаленности / минимальному общему времени T = дорога + очередь
  const [branchSearchQuery, setBranchSearchQuery] = useState('');
  const [branchSortMode, setBranchSortMode] = useState<'distance' | 'fastest'>('distance');
  const [branchPageSize, setBranchPageSize] = useState<BranchPageSize>(5);
  const [branchPage, setBranchPage] = useState(1);

  const {
    enrichedBranches,
    fastestBranch,
    closestBranch,
    timeSavedMinutes,
  } = useMemo(() => {
    if (!branches || branches.length === 0) {
      return { enrichedBranches: [], fastestBranch: null, closestBranch: null, timeSavedMinutes: 0 };
    }

    const clientLat = currentCoordinates.lat;
    const clientLng = currentCoordinates.lng;

    const list = branches.map((b) => {
      const loc = matchBranchLocation(b, MOSCOW_BRANCHES);
      const hasPosition = hasReliableGpsFix && simulationMode === 'real_gps';
      const dMeters = loc && hasPosition ? calculateHaversineDistanceMeters(clientLat, clientLng, loc.lat, loc.lng) : undefined;
      const rawTravelMin = dMeters === undefined ? undefined : Math.round((dMeters / 1000) * 12);
      const travelMin = isUsableDurationMinutes(rawTravelMin, MAX_ROUTE_TRAVEL_MINUTES) ? rawTravelMin : undefined;
      const rawWaitMin = undefined;
      const waitMin = isUsableDurationMinutes(rawWaitMin, MAX_QUEUE_WAIT_MINUTES) ? rawWaitMin : undefined;
      const totalMin = calculateBranchTotalTime(travelMin, waitMin);
      return { ...b, loc, distanceMeters: dMeters, travelMinutes: travelMin,
        waitMinutes: waitMin, totalMinutes: totalMin, metro: loc?.metro };
    });

    const openBranches = list.filter(b => !getBranchScheduleStatus({ code: b.loc?.code, name: b.name, workHours: b.workHours }, workloads[b.id]).isClosed);
    const eligibleBranches = openBranches.length > 0 ? openBranches : list;

    const sortedByDist = eligibleBranches.filter(b => b.distanceMeters !== undefined).sort((a, b) => a.distanceMeters! - b.distanceMeters!);
    const closest = sortedByDist[0] || null;

    const sortedByTotal = eligibleBranches.filter(b => b.totalMinutes !== undefined).sort((a, b) => a.totalMinutes! - b.totalMinutes!);
    const fastest = sortedByTotal[0] || null;

    const saved =
      closest && fastest && closest.totalMinutes !== undefined && fastest.totalMinutes !== undefined && closest.id !== fastest.id
        ? Math.max(0, closest.totalMinutes - fastest.totalMinutes)
        : 0;

    return {
      enrichedBranches: list,
      fastestBranch: fastest,
      closestBranch: closest,
      timeSavedMinutes: saved,
    };
  }, [branches, currentCoordinates, hasReliableGpsFix, simulationMode]);

  // Фильтрация по поиску и применение сортировки: открытые сверху, закрытые снизу
  const displayBranches = useMemo(() => {
    const userDefaultBranchId = getUserDefaultBranchId(currentUserId);
    let result = enrichedBranches;
    const q = branchSearchQuery.trim().toLowerCase();
    if (q) {
      const defaultBranch = enrichedBranches.find(b => matchesUserDefaultBranch(b, userDefaultBranchId));
      result = result.filter(
        (b) =>
          (defaultBranch && b.id === defaultBranch.id) ||
          b.name.toLowerCase().includes(q) ||
          (b.address && b.address.toLowerCase().includes(q)) ||
          (b.metro && b.metro.toLowerCase().includes(q)) ||
          (b.loc?.code && b.loc.code.includes(q))
      );
    }

    const isFastestMode = screen !== 'booking' && branchSortMode === 'fastest';

    return [...result].sort((a, b) => {
      // Отделение по умолчанию пользователя ВСЕГДА первое в списке и результатах поиска
      if (userDefaultBranchId) {
        const aIsDefault = matchesUserDefaultBranch(a, userDefaultBranchId);
        const bIsDefault = matchesUserDefaultBranch(b, userDefaultBranchId);
        if (aIsDefault && !bIsDefault) return -1;
        if (bIsDefault && !aIsDefault) return 1;
      }

      const aClosed = getBranchScheduleStatus({ code: a.loc?.code, name: a.name, workHours: a.workHours }, workloads[a.id]).isClosed;
      const bClosed = getBranchScheduleStatus({ code: b.loc?.code, name: b.name, workHours: b.workHours }, workloads[b.id]).isClosed;
      if (aClosed && !bClosed) return 1;
      if (!aClosed && bClosed) return -1;

      if (isFastestMode) {
        return (a.totalMinutes ?? Infinity) - (b.totalMinutes ?? Infinity);
      } else {
        return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
      }
    });
  }, [enrichedBranches, branchSearchQuery, branchSortMode, screen, workloads, currentUserId, defaultBranchSyncVersion]);

  const branchPageData = useMemo(
    () => paginateBranches(displayBranches, branchPage, branchPageSize),
    [displayBranches, branchPage, branchPageSize]
  );

  useEffect(() => {
    setBranchPage(1);
  }, [branchSearchQuery, branchSortMode, branchPageSize, screen]);

  useEffect(() => {
    if (branchPage !== branchPageData.page) setBranchPage(branchPageData.page);
  }, [branchPage, branchPageData.page]);

  const fetchServices = useCallback(async (targetBranchId: string) => {
    if (!targetBranchId) {
      setServices([]);
      setServicesLoading(false);
      return;
    }
    servicesLoadingBranchRef.current = targetBranchId;
    setServicesLoading(true);
    try {
      const slist = await loadConfirmedServices(targetBranchId);
      if (servicesLoadingBranchRef.current === targetBranchId) {
        setServices(slist);
        const urlParams = new URLSearchParams(window.location.search);
        const urlServiceId = urlParams.get('serviceId');
        const urlServiceCode = urlParams.get('service');
        if (urlServiceId && slist.some(s => s.id === urlServiceId)) {
          setServiceId(urlServiceId);
        } else if (urlServiceCode) {
          const found = slist.find(s => s.code?.toUpperCase() === urlServiceCode.toUpperCase());
          if (found) setServiceId(found.id);
        }
      }
    } catch (err: any) {
      if (servicesLoadingBranchRef.current === targetBranchId) {
        // Fallback к стандартным услугам отделения при отсутствии отдельной бэкенд-записи
        const geoBranch = MOSCOW_BRANCHES.find(b => b.id === targetBranchId);
        if (geoBranch && geoBranch.services && geoBranch.services.length > 0) {
          const fallbackServices = geoBranch.services.map((s, idx) => ({
            id: s.id,
            branchId: targetBranchId,
            name: s.name,
            code: s.category.toUpperCase().slice(0, 3) || `SRV${idx + 1}`,
            description: s.name,
            avgServiceTimeMinutes: s.avgServiceMinutes || 5,
            slaMinutes: 15,
            windowMin: 1,
            windowMax: 4,
          }));
          setServices(fallbackServices as any);
          setError(null);
        } else {
          setError(friendlyError(err, 'Не удалось загрузить услуги'));
        }
      }
    } finally {
      if (servicesLoadingBranchRef.current === targetBranchId) {
        setServicesLoading(false);
      }
    }
  }, [kiosk, loadConfirmedServices]);

  useEffect(() => {
    if (!branchId) {
      setServices([]);
      return;
    }
    fetchServices(branchId);
  }, [branchId, fetchServices]);

  useEffect(() => {
    if (branchId && ((screen === 'walkin' && walkinStep === 1) || (screen === 'booking' && bookingStep === 1))) {
      if (services.length === 0 && !servicesLoading && servicesLoadingBranchRef.current !== branchId) {
        fetchServices(branchId);
      }
    }
  }, [screen, walkinStep, bookingStep, branchId, services.length, servicesLoading, fetchServices]);

  useEffect(() => {
    if (kiosk) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (!action) return;

    window.history.replaceState({}, '', window.location.pathname);

    if (action === 'booking') {
      resetBooking();
      setScreen('booking');
    } else if (action === 'walkin') {
      resetWalkin();
      setScreen('walkin');
    } else if (action === 'my') {
      setScreen('my');
    }
  }, []);

  const stopPolling = useCallback(() => {
    pollGeneration.current += 1;
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const pollAll = useCallback(async () => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    const generation = pollGeneration.current;
    const scope = ownerScopeRef.current;

    // Для авторизованных пользователей сверяем активные талоны с сервером
    // (включая созданные через Алису)
    if (scope !== 'anon') {
      try {
        const remoteTickets = await api.listMyActiveTickets();
        if (generation === pollGeneration.current && Array.isArray(remoteTickets)) {
          // Добавляем новые талоны, появившиеся на сервере (например, через Алису)
          for (const t of remoteTickets) {
            addSavedTicketId(t.id, scope);
          }
        }
      } catch {}
    }

    const ids = getSavedTicketIds(scope);

    if (ids.length === 0) {
      setTicketsLoading(false);
      setPollError(null);
      setTickets([]);
      setAppointments({});
      setPositions({});
      setEtas({});
      pollInFlight.current = false;
      if (generation === pollGeneration.current && scope !== 'anon' && document.visibilityState === 'visible') {
        const interval = screenRef.current === 'my' ? MY_TICKETS_POLL_INTERVAL_MS : HOME_TICKET_POLL_INTERVAL_MS;
        pollTimer.current = window.setTimeout(pollAll, interval);
      }
      return;
    }

    const fetchedTickets: Ticket[] = [];
    const fetchedPositions: Record<string, QueuePosition> = {};
    const fetchedEtas: Record<string, TicketETA> = {};
    const failedIds = new Set<string>();

    Promise.allSettled(ids.map(async id => {
      try {
        const nextTicket = await api.getTicket(id);
        if (generation !== pollGeneration.current) return;

        // Обработка вызова талона к окну (TICKET_CALLED) -> отправляем системный Web Push и звуковой сигнал
        if (nextTicket.status === 'CALLED') {
          const winNum = nextTicket.window?.number ?? 1;
          const callKey = `${nextTicket.id}:${winNum}`;
          if (!alertedCallsRef.current.has(callKey)) {
            alertedCallsRef.current.add(callKey);

            let notifEnabled = true;
            try {
              // 1. Проверяем статус в профиле: если в профиле явно выключено -> уведомлений не будет.
              const profilePushEnabled = localStorage.getItem('user_browser_push_enabled') !== 'false';
              if (!profilePushEnabled) {
                notifEnabled = false;
              }
              // 2. Если в профиле включено, проверяем индивидуальный статус талона: если в конкретном талоне выключено -> не придет только для этого талона.
              if (
                localStorage.getItem(`ticket_notif_enabled:${nextTicket.id}`) === 'false' ||
                localStorage.getItem(`ticket_webpush_disabled:${nextTicket.id}`) === 'true'
              ) {
                notifEnabled = false;
              }
            } catch {}

            if (notifEnabled) {
              // Звуковой гонг (Web Audio API)
              try {
                const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
                if (AudioCtx) {
                  const ctx = new AudioCtx();
                  const osc = ctx.createOscillator();
                  const gain = ctx.createGain();
                  osc.type = 'sine';
                  osc.frequency.setValueAtTime(587.33, ctx.currentTime);
                  osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
                  gain.gain.setValueAtTime(0.25, ctx.currentTime);
                  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                  osc.connect(gain);
                  gain.connect(ctx.destination);
                  osc.start();
                  osc.stop(ctx.currentTime + 0.4);
                }
              } catch {}

              // Системный Web Push / Notification браузера
              try {
                if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                  if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.ready.then(reg => {
                      reg.showNotification(`Почта России — Вас вызывают!`, {
                        body: `Талон ${nextTicket.publicNumber}, пройдите к окну №${winNum}`,
                        icon: '/favicon.svg',
                        badge: '/favicon.svg',
                        tag: `ticket-called-${nextTicket.id}`,
                      });
                    }).catch(() => {
                      new Notification(`Почта России — Вас вызывают!`, {
                        body: `Талон ${nextTicket.publicNumber}, пройдите к окну №${winNum}`,
                        icon: '/favicon.svg',
                      });
                    });
                  } else {
                    new Notification(`Почта России — Вас вызывают!`, {
                      body: `Талон ${nextTicket.publicNumber}, пройдите к окну №${winNum}`,
                      icon: '/favicon.svg',
                    });
                  }
                }
              } catch {}
            }
          }
        }
        if (nextTicket.source === 'APPOINTMENT' && nextTicket.status === 'SCHEDULED') {
          setAppointments(prev => ({ ...prev, [id]: { ticket: nextTicket, scheduledAt: nextTicket.queueEnteredAt } }));
        }

        if (nextTicket.source === 'APPOINTMENT' && nextTicket.status === 'SCHEDULED') {
          if (hasArrivalAcknowledgement(nextTicket.id)) {
            setArrivalAcknowledgedTicketIds(prev => {
              const next = new Set(prev);
              next.add(nextTicket.id);
              return next;
            });
          }
        }

        if (!terminalStatuses.has(nextTicket.status)) {
          fetchedTickets.push(nextTicket);
          const etaRequest = api.getTicketETA(nextTicket.id).then(eta => {
            if (generation === pollGeneration.current && eta.ticketId === id) fetchedEtas[id] = eta;
          }).catch(() => {});
          try {
            const pos = await api.getQueuePosition(nextTicket.id);
            if (generation !== pollGeneration.current) return;
            fetchedPositions[id] = pos;
          } catch {}
          await etaRequest;
        } else {
          if (nextTicket.status === 'COMPLETED') {
            const history = getVisitRatingHistory(scope);
            if (shouldOfferVisitRating(nextTicket.status, nextTicket.id, [], history.dismissed)
                && !history.pending.some(item => item.id === nextTicket.id)) {
              history.pending = [...history.pending, nextTicket];
              saveVisitRatingHistory(scope, history);
              setVisitRatingQueue(history.pending);
            }
            try {
              const meta = getCompletedTicketMetadata(nextTicket);
              saveClientServiceRecord(scope, {
                id: nextTicket.id,
                publicNumber: nextTicket.publicNumber,
                serviceName: services.find(s => s.id === nextTicket.serviceId)?.name || 'Почтовые услуги',
                branchName: branches.find(b => b.id === nextTicket.branchId)?.name || 'Почта России',
                windowText: meta.windowText,
                operatorName: meta.operatorName,
                date: meta.dateStr,
                timeRange: meta.timeRange,
                duration: meta.durationStr,
                completedAt: nextTicket.completedAt || new Date().toISOString(),
              });
            } catch {}
          }
          removeSavedTicketId(id, scope);
        }
      } catch (err: any) {
        if (generation !== pollGeneration.current) return;
        if (err.status === 404 || err.message === 'NOT_FOUND') {
          removeSavedTicketId(id, scope);
        } else failedIds.add(id);
      }
    })).then(() => {
      if (generation !== pollGeneration.current) return;
      setTickets(prev => [...fetchedTickets, ...prev.filter(t => failedIds.has(t.id))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setPositions(fetchedPositions);
      setEtas(fetchedEtas);
      setPollError(failedIds.size ? 'Не удалось обновить часть талонов. Повторяем подключение…' : null);
    }).catch(reason => {
      if (generation !== pollGeneration.current) return;
      setPollError(friendlyError(reason, 'Не удалось обновить талоны'));
    }).finally(() => {
      pollInFlight.current = false;
      if (generation === pollGeneration.current) setTicketsLoading(false);
      if (generation === pollGeneration.current && (getSavedTicketIds(scope).length > 0 || scope !== 'anon') && document.visibilityState === 'visible') {
        const interval = screenRef.current === 'my' ? MY_TICKETS_POLL_INTERVAL_MS : HOME_TICKET_POLL_INTERVAL_MS;
        pollTimer.current = window.setTimeout(pollAll, interval);
      }
    });
  }, []);

  useEffect(() => {
    if (screen !== 'my') return;
    stopPolling();
    setTicketsLoading(true);
    pollAll();
    return stopPolling;
  }, [screen, pollAll, stopPolling]);

  // При смене пользователя (вход/выход/регистрация) перезагружаем талоны
  // строго для нового владельца, подтягивая серверные талоны (в т.ч. созданные через Алису)
  useEffect(() => {
    setTickets([]);
    setPositions({});
    setEtas({});
    stopPolling();
    if (ownerScope !== 'anon') {
      api.listMyActiveTickets().then(remoteTickets => {
        if (Array.isArray(remoteTickets) && remoteTickets.length > 0) {
          for (const t of remoteTickets) {
            addSavedTicketId(t.id, ownerScope);
          }
        }
        pollAll();
      }).catch(() => {
        pollAll();
      });
    } else {
      pollAll();
    }
  }, [ownerScope, pollAll, stopPolling]);

  // Слушаем создание нового талона (в т.ч. через AI Ассистента) и синхронизацию хранилища
  useEffect(() => {
    const handleTicketCreated = (e: Event) => {
      const custom = e as CustomEvent<Ticket>;
      const newTicket = custom.detail;
      if (newTicket && newTicket.id) {
        addSavedTicketId(newTicket.id, ownerScope);
        setTickets(prev => {
          if (prev.some(t => t.id === newTicket.id)) return prev;
          return [newTicket, ...prev];
        });
        stopPolling();
        pollAll();
      }
    };
    const handleStorage = () => {
      stopPolling();
      pollAll();
    };
    const handleShowTickets = () => {
      setScreen('my');
    };
    window.addEventListener('pochta:ticket-created', handleTicketCreated);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('pochta:show-tickets', handleShowTickets);
    return () => {
      window.removeEventListener('pochta:ticket-created', handleTicketCreated);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('pochta:show-tickets', handleShowTickets);
    };
  }, [ownerScope, pollAll, stopPolling]);

  useEffect(() => {
    const refreshActiveTickets = () => {
      if (document.visibilityState !== 'visible') return;
      if (ownerScopeRef.current !== 'anon') {
        api.listMyActiveTickets().then(remoteTickets => {
          if (Array.isArray(remoteTickets) && remoteTickets.length > 0) {
            let changed = false;
            const currentIds = getSavedTicketIds(ownerScopeRef.current);
            for (const t of remoteTickets) {
              if (!currentIds.includes(t.id)) {
                addSavedTicketId(t.id, ownerScopeRef.current);
                changed = true;
              }
            }
            if (changed) pollAll();
          }
        }).catch(() => {});
      }
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
      pollAll();
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refreshActiveTickets(); };
    window.addEventListener('online', refreshActiveTickets);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('online', refreshActiveTickets);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [pollAll]);

  const resetBooking = () => {
    setBookingStep(0);
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    setScheduledAtInput('');
    setError(null);
  };

  const resetWalkin = () => {
    setWalkinStep(qrBranchId ? 1 : 0);
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    setError(null);
    if (qrBranchId) {
      fetchServices(qrBranchId);
    }
  };

  const createQrTicket = async () => {
    if (createLock.current || !branches.some(b => b.id === branchId) || !services.some(s => s.id === serviceId)) return;
    createLock.current = true;
    setCreating(true);
    setError(null);
    const identity = `qr:${branchId}:${serviceId}`;
    try {
      const created = await api.createQrTicket(branchId, serviceId, keyFor(identity));
      clearStoredIdempotencyKey(identity);
      requestKey.current = null;
      if (created.managementToken) {
        saveMgmtToken(created.id, created.managementToken, ownerScope);
      }
      if (kiosk) {
        setKioskTicket(created);
      } else {
        addSavedTicketId(created.id, ownerScope);
        setTickets(prev => [created, ...prev]);
        setScreen('my');
      }
    } catch (reason: unknown) {
      setError(friendlyError(reason, 'Не удалось получить талон'));
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  };

  const createAppointmentData = async () => {
    if (!branchId || !serviceId || !scheduledAtInput) return;
    if (createLock.current) return;
    let scheduledAt: Date;
    try { scheduledAt = new Date(parseMoscowDatetimeLocal(scheduledAtInput)); }
    catch { setError('Укажите корректное московское время'); return; }
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setError('Выберите будущее время записи');
      return;
    }
    createLock.current = true;
    setCreating(true);
    setError(null);
    const identity = `appointment:${branchId}:${serviceId}:${scheduledAt.toISOString()}`;
    try {
      const created = await api.createAppointment(
        branchId,
        serviceId,
        scheduledAt.toISOString(),
        keyFor(identity)
      );
      clearStoredIdempotencyKey(identity);
      requestKey.current = null;

      const finalTicket = created.ticket;
      const mgmtToken = created.managementToken || finalTicket.managementToken;
      if (mgmtToken) {
        saveMgmtToken(finalTicket.id, mgmtToken, ownerScope);
      }

      if (!smsReminderEnabled && mgmtToken) {
        try {
          const subs = await api.listNotificationSubscriptions(finalTicket.id, mgmtToken);
          const smsSub = subs.find(s => s.channel === 'SMS');
          if (smsSub) {
            await api.removeNotificationSubscription(finalTicket.id, 'SMS', smsSub.id, mgmtToken);
          }
        } catch {}
      }

      addSavedTicketId(finalTicket.id, ownerScope);
      setTickets(prev => [finalTicket, ...prev]);
      setAppointments(prev => ({ ...prev, [finalTicket.id]: created }));
      setScreen('my');
    } catch (reason: unknown) {
      setError(friendlyError(reason, 'Не удалось создать запись'));
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  };

  const cancel = async (ticket: Ticket) => {
    if (cancellingTicketId || (ticket.status !== 'SCHEDULED' && ticket.status !== 'WAITING')) return;
    const isAppointment = ticket.source === 'APPOINTMENT' && ticket.status === 'SCHEDULED';
    const confirmMessage = isAppointment
      ? 'Вы уверены, что хотите отменить предварительную запись?'
      : 'Вы уверены, что хотите отказаться от талона и покинуть очередь?';
    if (!window.confirm(confirmMessage)) return;

    setCancellingTicketId(ticket.id);
    try {
      let cancelledTicket: Ticket;
      const tokens = getSavedMgmtTokens(ownerScope);
      const mgmtToken = tokens[ticket.id] || ticket.managementToken || undefined;
      if (isAppointment) {
        try {
          const res = await api.cancelAppointment(ticket.id, mgmtToken);
          cancelledTicket = res.ticket;
        } catch (appErr) {
          // Fallback: try cancelTicket if status was already transitioned to waiting or type mismatch
          cancelledTicket = await api.cancelTicket(ticket.id, mgmtToken);
        }
      } else {
        cancelledTicket = await api.cancelTicket(ticket.id, mgmtToken);
      }
      removeSavedTicketId(ticket.id, ownerScope);
      removeMgmtToken(ticket.id, ownerScope);
      setTickets(prev => prev.filter(t => t.id !== ticket.id));
      setAppointments(prev => { const next = { ...prev }; delete next[ticket.id]; return next; });
      setPositions(prev => { const next = { ...prev }; delete next[ticket.id]; return next; });
      setEtas(prev => { const next = { ...prev }; delete next[ticket.id]; return next; });
      stopPolling();
      pollAll();
    } catch (reason: unknown) {
      setError(friendlyError(reason, isAppointment ? 'Не удалось отменить запись' : 'Не удалось отказаться от талона'));
    } finally {
      setCancellingTicketId(null);
    }
  };

  const arrive = async (ticket: Ticket) => {
    if (arriving || ticket.status !== 'SCHEDULED') return;
    setArriving(true);
    try {
      const arrived = await api.arriveAppointment(ticket.id);
      setArrivalAcknowledgedTicketIds(prev => {
        const next = new Set(prev);
        next.add(arrived.ticket.id);
        return next;
      });
      rememberArrival(arrived.ticket.id);
      stopPolling();
      pollAll();
    } catch (reason: unknown) {
      setError(friendlyError(reason, 'Не удалось подтвердить прибытие. Попробуйте ещё раз.'));
    } finally {
      setArriving(false);
    }
  };

  const handleBranchSelect = (id: string) => {
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    sessionStorage.setItem(STORAGE_BRANCH_KEY, id);
    const selectedBranchObj = branches.find((b) => b.id === id);
    const scheduleStatus = selectedBranchObj ? getBranchScheduleStatus(selectedBranchObj, workloads[id]) : null;

    if (screen === 'booking') {
      setBookingStep(1);
    } else if (screen === 'walkin') {
      if (scheduleStatus?.isClosed) {
        setScreen('booking');
        setBookingStep(1);
        setNotice('Отделение сейчас закрыто. Запись доступна на следующий рабочий день.');
      } else {
        setWalkinStep(1);
      }
    }

    if (id !== branchId) {
      setServices([]);
      setBranchId(id);
    }
  };

  useEffect(() => {
    const handleDefaultBranchUpdated = (e: Event) => {
      const custom = e as CustomEvent<{ branchId: string }>;
      if (custom.detail?.branchId) {
        const targetId = custom.detail.branchId;
        const matched = branches.find(b => matchesUserDefaultBranch(b, targetId));
        handleBranchSelect(matched ? matched.id : targetId);
      }
    };
    window.addEventListener('client_default_branch_updated', handleDefaultBranchUpdated);
    return () => window.removeEventListener('client_default_branch_updated', handleDefaultBranchUpdated);
  }, [branches, handleBranchSelect]);

  useEffect(() => {
    if (currentUserId && typeof localStorage !== 'undefined' && branches.length > 0) {
      const preferred = localStorage.getItem(`user_default_branch_id:${currentUserId}`) || localStorage.getItem('user_default_branch_id');
      if (preferred) {
        const matched = branches.find(b => matchesUserDefaultBranch(b, preferred));
        if (matched && matched.id !== branchId) {
          handleBranchSelect(matched.id);
        }
      }
    }
  }, [currentUserId, branchId, branches, handleBranchSelect]);

  const handleRepeatTicket = (targetBranchId: string) => {
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    sessionStorage.setItem(STORAGE_BRANCH_KEY, targetBranchId);
    setWalkinStep(1);
    setScreen('walkin');

    if (targetBranchId !== branchId) {
      setServices([]);
      setBranchId(targetBranchId);
    }
  };

  const handleServiceSelect = (id: string) => {
    setServiceId(id);
    sessionStorage.setItem(STORAGE_SERVICE_KEY, id);
    if (screen === 'booking') setBookingStep(2);
  };

  const resetKioskScreen = () => {
    if (!kiosk) return;
    if (kioskTicket) removeSavedTicketId(kioskTicket.id, ownerScope);
    setKioskTicket(null);
    setTickets([]);
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    setError(null);
    setScreen('walkin');
    setWalkinStep(1);
    if (qrBranchId) void fetchServices(qrBranchId);
  };

  useEffect(() => {
    if (!kiosk || !kioskTicket) return;
    const timer = window.setTimeout(resetKioskScreen, 30000);
    return () => window.clearTimeout(timer);
  }, [kiosk, kioskTicket]);

  const finishVisitRating = async (kind: 'reviewed' | 'dismissed', rating?: number, comment = '') => {
    const ticket = visitRatingQueue[0];
    if (!ticket) return;
    const history = getVisitRatingHistory(ownerScope);
    history.pending = history.pending.filter(item => item.id !== ticket.id);
    if (kind === 'reviewed' && typeof rating === 'number') {
      try {
        await api.submitFeedback(ticket.id, rating, comment, ticket.managementToken || getSavedMgmtTokens(ownerScope)[ticket.id]);
      } catch (err) {
        setError(friendlyError(err, 'Не удалось отправить оценку'));
        return;
      }
    } else if (!history.dismissed.includes(ticket.id)) history.dismissed.push(ticket.id);
    saveVisitRatingHistory(ownerScope, history);
    setVisitRatingQueue(history.pending);
  };

  const savedCount = tickets.length > 0
    ? tickets.filter(t => !terminalStatuses.has(t.status)).length
    : getSavedTicketIds(ownerScope).length;

  const renderHome = () => {
    const activeTicket = tickets.find(ticket => !terminalStatuses.has(ticket.status)) ?? null;
    const rec: any = null;
    const fastest: any = null;
    const totalMin = 0;
    const travelMin = 0;
    const waitMin = 0;
    const actions: string[] = [];

    return (
      <div className="max-w-5xl xl:max-w-6xl mx-auto space-y-3.5 sm:space-y-5 pb-6">
        {/* Accessible screen-reader heading (visual title is already present in header) */}
        <h1 className="sr-only">Цифровая очередь</h1>

        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
        {notice && <NoticeBanner message={notice} onClose={() => setNotice(null)} />}

        <HomeHero
          ticketsLoading={ticketsLoading}
          error={pollError}
          activeTicket={activeTicket}
          position={activeTicket ? positions[activeTicket.id] : undefined}
          eta={activeTicket ? etas[activeTicket.id] : undefined}
          branch={activeTicket ? branches.find(branch => branch.id === activeTicket.branchId) : undefined}
          onRetry={() => { setTicketsLoading(true); pollAll(); }}
          onOpenTicket={() => setScreen('my')}
          onOpenRoute={() => activeTicket && handleOpenMap('all', activeTicket.branchId)}
          smartRoute={<SmartRouteHero
            branches={branches}
            currentCoordinates={currentCoordinates}
            hasReliableGpsFix={hasReliableGpsFix}
            hasRealGpsFix={hasRealGpsFix}
            simulationMode={simulationMode}
            gpsPermissionStatus={gpsPermissionStatus}
            requestGpsPermission={requestGpsPermission}
            confirmedServicesByBranch={confirmedServicesByBranch}
            onNeedServices={branch => { void loadConfirmedServices(branch).catch(() => {}); }}
            onTakeTicket={handleRepeatTicket}
            onOpenRoute={(branch, saved) => { setRouteOfferBranch(branch as RankedBranch); setRouteOfferTimeSaved(saved); }}
            onOpenMap={() => handleOpenMap()}
            onBook={branch => { handleBranchSelect(branch); setScreen('booking'); setBookingStep(1); }}
          />}
        />

        {routeOfferBranch && <RouteOfferModal
          branch={routeOfferBranch}
          origin={hasRealGpsFix ? currentCoordinates : undefined}
          timeSavedMinutes={routeOfferTimeSaved}
          onClose={() => setRouteOfferBranch(null)}
          onTakeTicket={handleRepeatTicket}
          onOpenMap={(id) => handleOpenMap('all', id)}
        />}

        {/* Состояние поиска геолокации (Skeleton) */}
        {false && <>
        {!hasReliableGpsFix && gpsPermissionStatus !== 'denied' && gpsPermissionStatus !== 'unavailable' && (
          <div className="rounded-2xl border border-blue-200/80 bg-blue-50/70 p-3.5 sm:p-4 animate-pulse flex items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-blue-200 flex items-center justify-center text-blue-700 shrink-0">
                <Loader2 size={16} className="animate-spin" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-blue-900">Определяем ваше местоположение…</p>
                <p className="text-xs text-blue-700 mt-0.5">Подберём ближайшее отделение после GPS fix.</p>
              </div>
            </div>
            <span className="text-[11px] font-mono font-bold text-blue-700 shrink-0 bg-blue-100/80 px-2.5 py-1 rounded-full border border-blue-200">
              Поиск гео…
            </span>
          </div>
        )}

        {/* Умный маршрут: Высокоинформативная карточка с чётким KUDO, SKOLKO, CHTO DELAT */}
        {rec && fastest && (
          <div role="region" aria-label="Рекомендация отделения" className="bg-gradient-to-br from-emerald-50/80 via-teal-50/40 to-white rounded-2xl border border-emerald-200/80 p-4 sm:p-5 shadow-xs space-y-3.5">
            {/* Top Row: Badge + Branch + Big Time */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider uppercase bg-emerald-100 text-emerald-800 mb-1.5 border border-emerald-200/60">
                  <Sparkles size={11} className="text-emerald-700" />
                  <span>Умный маршрут</span>
                </div>
                <h2 className="text-base sm:text-lg font-black text-[#031E56] leading-snug">
                  {fastest.name}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 mb-0 truncate">
                  {fastest.address}
                </p>
              </div>

              {/* Big Time Stat */}
              <div className="text-right shrink-0 bg-white/90 border border-emerald-200/80 rounded-2xl px-3 py-2 shadow-2xs">
                <div className="text-2xl sm:text-3xl font-black text-[#031E56] leading-none tabular-nums">
                  ≈{totalMin} мин
                </div>
                <div className="text-[10px] font-bold text-slate-500 mt-0.5 uppercase tracking-wider">
                  всего
                </div>
              </div>
            </div>

            {/* Sub-breakdown Row */}
            <div className="flex items-center justify-between text-xs text-slate-600 gap-2 flex-wrap bg-white/70 px-3 py-1.5 rounded-xl border border-emerald-100/80">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-800">{travelMin} мин дорога</span>
                <span className="text-slate-400">·</span>
                <span className="font-semibold text-emerald-700">{waitMin} мин очередь</span>
              </div>
              {rec.timeSavedMinutes > 0 && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                  Экономия ~{rec.timeSavedMinutes} мин
                </span>
              )}
            </div>

            {/* Appointment is offered only after this branch's enabled services are confirmed. */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => handleRepeatTicket(fastest.id)}
                className="w-full sm:flex-1 min-h-[44px] px-4 rounded-xl bg-[#003B73] hover:bg-[#002D5A] active:scale-[0.98] text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <TicketIcon size={16} />
                <span>Взять талон</span>
              </button>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {actions.includes('appointment') && (
                  <button
                    type="button"
                    onClick={() => { handleBranchSelect(fastest.id); setScreen('booking'); setBookingStep(1); }}
                    className="flex-1 sm:flex-initial min-h-[44px] px-3.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 active:scale-[0.98] text-slate-700 hover:text-slate-900 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <span>Записаться онлайн</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRouteOfferBranch(fastest)}
                  className="flex-1 sm:flex-initial min-h-[44px] px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 active:scale-[0.98] text-slate-700 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Navigation size={14} className="text-slate-500" />
                  <span>Маршрут</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Calm notice when geolocation is explicitly denied or unavailable */}
        {!hasRealGpsFix && simulationMode === 'real_gps' && (gpsPermissionStatus === 'denied' || gpsPermissionStatus === 'unavailable') && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:p-4 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                <MapPinOff size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-800">
                  Включите геолокацию, чтобы подобрать ближайшее отделение
                </p>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                  Показаны отделения Москвы. Выберите ближайшее на карте или включите геопозицию.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                type="button"
                onClick={() => handleOpenMap()}
                className="flex-1 sm:flex-none min-h-[38px] px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 active:scale-95 text-slate-700 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MapPin size={13} />
                <span>Карта</span>
              </button>
              <button
                type="button"
                onClick={() => requestGpsPermission()}
                className="flex-1 sm:flex-none min-h-[38px] px-3 py-1.5 rounded-xl bg-[#003B73] hover:bg-[#002B55] active:scale-95 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Navigation size={13} />
                <span>Включить гео</span>
              </button>
            </div>
          </div>
        )}

        {routeOfferBranch && (
          <RouteOfferModal
            branch={routeOfferBranch!}
            origin={hasRealGpsFix ? currentCoordinates : undefined}
            timeSavedMinutes={rec?.fastestBranch.id === routeOfferBranch!.id ? rec.timeSavedMinutes : 0}
            onClose={() => setRouteOfferBranch(null)}
            onTakeTicket={handleRepeatTicket}
            onOpenMap={(id) => handleOpenMap('all', id)}
          />
        )}
        </>}

        {/* 4 Action Cards - Mobile-First Layout & Prominent Hierarchy */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* 1. Взять талон (Главный сценарий) */}
          <button
            type="button"
            onClick={() => { resetWalkin(); setScreen('walkin'); }}
            className="col-span-2 sm:col-span-1 p-4 sm:p-5 min-h-[76px] sm:min-h-[175px] rounded-2xl bg-gradient-to-br from-[#003B73] via-[#00478F] to-[#054FA6] text-white shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-left group flex flex-row sm:flex-col items-center sm:items-start justify-between cursor-pointer"
          >
            <div className="flex items-center sm:block min-w-0 flex-1">
              <div className="relative w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center mr-3 sm:mr-0 sm:mb-3 group-hover:scale-105 transition-transform shrink-0">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/20 absolute" />
                <TicketIcon size={20} className="relative z-10 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5 sm:mb-1 flex-wrap">
                  <h3 className="text-base sm:text-lg font-black text-white group-hover:text-blue-100 transition-colors">
                    Взять талон
                  </h3>
                  <span className="text-[9px] sm:text-[10px] font-mono font-bold bg-[#FFE600] text-black px-1.5 py-0.5 rounded-full uppercase tracking-wider shadow-2xs">
                    Сейчас
                  </span>
                </div>
                <p className="text-xs text-blue-100 leading-relaxed">
                  Получите электронный номерок прямо сейчас
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-white/70 group-hover:text-white shrink-0 sm:hidden transition-transform group-hover:translate-x-0.5 ml-2" />
          </button>

          {/* 2. Записаться онлайн (Secondary 1) */}
          <button
            type="button"
            onClick={() => { resetBooking(); setScreen('booking'); }}
            className="col-span-1 p-3.5 sm:p-5 min-h-[105px] sm:min-h-[175px] rounded-2xl bg-slate-50/80 hover:bg-white hover:shadow-sm active:scale-[0.98] transition-all text-left group flex flex-col justify-between cursor-pointer"
          >
            <div className="relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center sm:mb-3 group-hover:scale-105 transition-transform shrink-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-100/70 absolute" />
              <CalendarClock size={19} className="relative z-10 text-[#003B73]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-base font-black text-slate-900 group-hover:text-[#003B73] transition-colors mb-0.5 leading-snug">
                Записаться онлайн
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 leading-snug">
                К точному времени визита
              </p>
            </div>
          </button>

          {/* 3. Карта отделений (Secondary 2) */}
          <button
            type="button"
            onClick={() => handleOpenMap()}
            className="col-span-1 p-3.5 sm:p-5 min-h-[105px] sm:min-h-[175px] rounded-2xl bg-slate-50/80 hover:bg-white hover:shadow-sm active:scale-[0.98] transition-all text-left group flex flex-col justify-between cursor-pointer"
          >
            <div className="relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center sm:mb-3 group-hover:scale-105 transition-transform shrink-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-100/70 absolute" />
              <MapPin size={19} className="relative z-10 text-[#003B73]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-base font-black text-slate-900 group-hover:text-[#003B73] transition-colors mb-0.5 leading-snug">
                Карта отделений
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 leading-snug">
                26 отделений и маршруты
              </p>
            </div>
          </button>

          {/* 4. Мои талоны (Full width compact row on mobile) */}
          <button
            type="button"
            onClick={() => setScreen('my')}
            className="col-span-2 sm:col-span-1 p-3.5 sm:p-5 min-h-[56px] sm:min-h-[175px] rounded-2xl bg-slate-50/80 hover:bg-white hover:shadow-sm active:scale-[0.98] transition-all text-left group flex flex-row sm:flex-col items-center sm:items-start justify-between relative cursor-pointer"
          >
            <div className="flex items-center sm:block min-w-0 flex-1">
              <div className="relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center mr-2.5 sm:mr-0 sm:mb-3 group-hover:scale-105 transition-transform shrink-0">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-100/70 absolute" />
                <ListChecks size={19} className="relative z-10 text-emerald-700" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs sm:text-base font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                    Мои талоны
                  </h3>
                </div>
                <p className="hidden sm:block text-xs text-slate-500 leading-relaxed mt-1">
                  Текущие очереди и статус вызова к окну
                </p>
              </div>
            </div>
            {savedCount > 0 && (
              <span className="hidden sm:inline absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                {savedCount} активных
              </span>
            )}
            <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600 shrink-0 sm:hidden transition-transform group-hover:translate-x-0.5 ml-2" />
          </button>
        </div>
      </div>
    );
  };

  const renderBooking = () => {
    const steps = ['Отделение', 'Услуга', 'Время'];

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <header className="flex items-center justify-between pb-1">
          <button
            type="button"
            className="cx-back-btn"
            onClick={() => (bookingStep === 0 ? setScreen('home') : setBookingStep(b => b - 1))}
          >
            <ChevronLeft size={18} />
            <span>Назад</span>
          </button>
          <h2 className="text-lg font-black text-slate-900">Онлайн-запись</h2>
          <div className="w-12" />
        </header>

        <div className="space-y-4">
          <StepIndicator steps={steps} current={bookingStep} />
          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

          {bookingStep === 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Выберите отделение</h3>
                <button
                  type="button"
                  onClick={() => handleOpenMap()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[#052F85] text-xs font-bold hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <MapPin size={14} />
                  <span>На карте</span>
                </button>
              </div>

              {/* Поиск отделения */}
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={branchSearchQuery}
                  onChange={(e) => setBranchSearchQuery(e.target.value)}
                  placeholder="Поиск по названию, адресу, метро или индексу..."
                  style={{ paddingLeft: '2.75rem', paddingRight: '2.5rem' }}
                  className="w-full pl-11 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#052F85]/20 focus:border-[#052F85]"
                />
                {branchSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setBranchSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200/60 transition-colors border-0 bg-transparent p-0 cursor-pointer"
                    aria-label="Очистить поиск"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Переключатель сортировки */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                  <button
                    type="button"
                    onClick={() => setBranchSortMode('distance')}
                    className="px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer bg-[#052F85] text-white shadow-xs"
                  >
                    <Navigation size={12} />
                    <span>По удалённости</span>
                  </button>
                </div>
              </div>
              <BranchListPageControls
                pageData={branchPageData}
                pageSize={branchPageSize}
                onPageSizeChange={setBranchPageSize}
                onPageChange={setBranchPage}
              />

              <BranchRecommendation nearestBranch={closestBranch} fastestBranch={fastestBranch}
                savingMinutes={timeSavedMinutes} />

              {loading ? (
                <p className="text-xs text-slate-400 font-mono py-8 text-center animate-pulse">Загрузка отделений...</p>
              ) : branchPageData.items.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <p>Отделения не найдены по вашему запросу</p>
                  <button type="button" onClick={() => setBranchSearchQuery('')} className="cx-link-button mt-2 text-xs font-semibold text-[#003B73] underline cursor-pointer">Сбросить поиск</button>
                </div>
              ) : (
                branchPageData.items.map((b) => (
                  <BranchCard
                    key={b.id}
                    branch={b}
                    selected={branchId === b.id}
                    onSelect={() => handleBranchSelect(b.id)}
                    distanceMeters={b.distanceMeters}
                    travelMinutes={b.travelMinutes}
                    waitMinutes={b.waitMinutes}
                    totalMinutes={b.totalMinutes}
                    isFastest={fastestBranch?.id === b.id}
                    isClosest={closestBranch?.id === b.id}
                    isDefault={matchesUserDefaultBranch(b, getUserDefaultBranchId(currentUserId))}
                    timeSavedMinutes={timeSavedMinutes}
                    location={b.loc}
                    ratingAverage={b.ratingAverage} ratingCount={b.ratingCount}
                    workload={workloads[b.id]}
                  />
                ))
              )}
            </div>
          )}

          {bookingStep === 1 && (
            <div className="space-y-3">
              <p className="cx-selection-summary">
                <Building2 size={18} aria-hidden />
                {branches.find(b => b.id === branchId)?.name || 'Выбранное отделение'}
              </p>
              <h3 className="text-sm font-bold text-slate-800">Выберите услугу</h3>
              {servicesLoading ? (
                <p className="text-xs text-slate-400 font-mono py-8 text-center animate-pulse">Загрузка услуг...</p>
              ) : services.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-xs text-slate-500">В этом отделении пока нет доступных услуг</p>
                  {branchId && (
                    <button
                      type="button"
                      onClick={() => fetchServices(branchId)}
                      className="text-xs text-[#054FA6] hover:underline font-medium"
                    >
                      Повторить загрузку
                    </button>
                  )}
                </div>
              ) : (
                services.map(s => (
                  <ServiceCard key={s.id} service={s} selected={serviceId === s.id} onSelect={() => handleServiceSelect(s.id)} />
                ))
              )}
            </div>
          )}

          {bookingStep === 2 && (
            <div className="space-y-4">
              <div className="cx-selection-summary">
                <Building2 size={18} aria-hidden />
                <div>
                  <strong>{branches.find(b => b.id === branchId)?.name}</strong>
                  <p>{services.find(s => s.id === serviceId)?.name}</p>
                  <p>Дата и время указаны по Москве (МСК)</p>
                </div>
              </div>
              <BranchWorkloadCard branch={branches.find(b => b.id === branchId)} />
              <div className="p-4 sm:p-6 rounded-3xl bg-white border border-[#D2D8E2] shadow-sm space-y-4 max-w-full min-w-0 overflow-hidden">
              <Appointment24hPicker
                value={scheduledAtInput}
                onChange={setScheduledAtInput}
                disabled={creating}
                workHours={branches.find(b => b.id === branchId)?.workHours}
                branch={branches.find(b => b.id === branchId)}
                workload={branchId ? workloads[branchId] : undefined}
                onDayOffChange={setIsAppointmentDateDayOff}
              />

              <button
                type="button"
                className="w-full min-h-[48px] py-3 bg-[#003B73] hover:bg-[#054FA6] active:bg-[#00274D] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
                disabled={creating || !scheduledAtInput || isAppointmentDateDayOff}
                onClick={createAppointmentData}
              >
                {creating ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    <span>Оформляем...</span>
                  </>
                ) : isAppointmentDateDayOff ? (
                  <span>Выберите рабочий день</span>
                ) : (
                  <span>Подтвердить запись</span>
                )}
              </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderWalkin = () => {
    const steps = ['Отделение', 'Услуга'];

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <header className="flex items-center justify-between pb-1">
          {!kiosk ? (
            <button
              type="button"
              className="cx-back-btn"
              onClick={() => (walkinStep === 0 ? setScreen('home') : setWalkinStep(w => w - 1))}
            >
              <ChevronLeft size={18} />
              <span>Назад</span>
            </button>
          ) : <div className="w-12" />}
          <h2 className="text-lg font-black text-slate-900">Взять талон</h2>
          {!kiosk && getSavedTicketIds(ownerScope).length > 0 ? (
            <button
              type="button"
              onClick={() => setScreen('my')}
              className="px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[#054FA6] text-xs font-bold hover:bg-blue-100 transition-colors"
            >
              Мои талоны
            </button>
          ) : (
            <div className="w-12" />
          )}
        </header>

        <div className="space-y-4">
          <StepIndicator steps={steps} current={walkinStep} />
          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
          {notice && <NoticeBanner message={notice} onClose={() => setNotice(null)} />}

          {walkinStep === 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Выберите отделение</h3>
                <button
                  type="button"
                  onClick={() => handleOpenMap()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[#052F85] text-xs font-bold hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <MapPin size={14} />
                  <span>На карте</span>
                </button>
              </div>

              {/* Поиск отделения */}
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={branchSearchQuery}
                  onChange={(e) => setBranchSearchQuery(e.target.value)}
                  placeholder="Поиск по названию, адресу, метро или индексу..."
                  style={{ paddingLeft: '2.75rem', paddingRight: '2.5rem' }}
                  className="w-full pl-11 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#052F85]/20 focus:border-[#052F85]"
                />
                {branchSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setBranchSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200/60 transition-colors border-0 bg-transparent p-0 cursor-pointer"
                    aria-label="Очистить поиск"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Переключатель сортировки */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                  <button
                    type="button"
                    onClick={() => setBranchSortMode('distance')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      branchSortMode === 'distance'
                        ? 'bg-[#052F85] text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <Navigation size={12} />
                    <span>По удалённости</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranchSortMode('fastest')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      branchSortMode === 'fastest'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <Zap size={12} />
                    <span>Быстрее всего (дорога + очередь)</span>
                  </button>
                </div>
              </div>
              <BranchListPageControls
                pageData={branchPageData}
                pageSize={branchPageSize}
                onPageSizeChange={setBranchPageSize}
                onPageChange={setBranchPage}
              />

              <BranchRecommendation nearestBranch={closestBranch} fastestBranch={fastestBranch}
                savingMinutes={timeSavedMinutes} />

              {loading ? (
                <p className="text-xs text-slate-400 font-mono py-8 text-center animate-pulse">Загрузка отделений...</p>
              ) : branchPageData.items.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <p>Отделения не найдены по вашему запросу</p>
                  <button type="button" onClick={() => setBranchSearchQuery('')} className="cx-link-button mt-2 text-xs font-semibold text-[#003B73] underline cursor-pointer">Сбросить поиск</button>
                </div>
              ) : (
                branchPageData.items.map((b) => (
                  <BranchCard
                    key={b.id}
                    branch={b}
                    selected={branchId === b.id}
                    onSelect={() => handleBranchSelect(b.id)}
                    distanceMeters={b.distanceMeters}
                    travelMinutes={b.travelMinutes}
                    waitMinutes={b.waitMinutes}
                    totalMinutes={b.totalMinutes}
                    isFastest={fastestBranch?.id === b.id}
                    isClosest={closestBranch?.id === b.id}
                    isDefault={matchesUserDefaultBranch(b, getUserDefaultBranchId(currentUserId))}
                    timeSavedMinutes={timeSavedMinutes}
                    location={b.loc}
                    ratingAverage={b.ratingAverage} ratingCount={b.ratingCount}
                    workload={workloads[b.id]}
                  />
                ))
              )}
            </div>
          )}

          {walkinStep === 1 && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#003B73]" />
                <span>Отделение: <strong>{branches.find(b => b.id === branchId)?.name}</strong></span>
              </div>

              {!kiosk && <BranchWorkloadCard branch={branches.find(b => b.id === branchId)} />}

              <h3 className="text-sm font-bold text-slate-800">Выберите услугу</h3>
              {servicesLoading ? (
                <p className="text-xs text-slate-400 font-mono py-8 text-center animate-pulse">Загрузка услуг...</p>
              ) : services.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-xs text-slate-500">В этом отделении пока нет доступных услуг</p>
                  {branchId && (
                    <button
                      type="button"
                      onClick={() => fetchServices(branchId)}
                      className="text-xs text-[#054FA6] hover:underline font-medium"
                    >
                      Повторить загрузку
                    </button>
                  )}
                </div>
              ) : (
                <div className={kiosk ? 'kiosk-services-grid' : 'space-y-2.5'}>
                  {services.map(s => (
                    <ServiceCard key={s.id} service={s} selected={serviceId === s.id} onSelect={() => handleServiceSelect(s.id)} />
                  ))}
                </div>
              )}

              <div className="sticky bottom-3 sm:static z-20 pt-2 pb-1 bg-[#F8FAFC]/90 backdrop-blur-xs sm:bg-transparent">
                <button
                  type="button"
                  className="w-full min-h-[48px] py-3.5 bg-[#003B73] hover:bg-[#054FA6] active:bg-[#00274D] text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all shadow-lg active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  disabled={creating || !services.some(s => s.id === serviceId)}
                  onClick={createQrTicket}
                >
                  {creating ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      <span>Оформляем…</span>
                    </>
                  ) : (
                    <span>Получить талон</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMy = () => {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <header className="flex items-center justify-between pb-1">
          <button
            type="button"
            className="cx-back-btn"
            onClick={() => setScreen('home')}
          >
            <ChevronLeft size={18} />
            <span>Главная</span>
          </button>
          <h2 className="text-lg font-black text-slate-900">Мои талоны</h2>
          <div className="w-12" />
        </header>

        <div className="space-y-4">
          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
          {notice && <NoticeBanner message={notice} onClose={() => setNotice(null)} />}
          {pollError && <div role="status" className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-[#054FA6] text-xs font-semibold">{pollError}</div>}

          {ticketsLoading && tickets.length === 0 ? (
            <div className="cx-request-state" role="status">Загружаем ваши талоны…</div>
          ) : pollError && tickets.length === 0 ? (
            <div className="cx-request-state" role="status">Восстанавливаем соединение. Ваши талоны сохранены, повторная загрузка выполняется автоматически.</div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-16 px-4 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                <TicketIcon size={32} />
              </div>
              <h3 className="text-base font-bold text-slate-800">У вас нет активных талонов</h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Оформите талон или выберите предварительную запись на главной странице
              </p>
              <button
                type="button"
                onClick={() => setScreen('home')}
                className="px-5 py-2.5 bg-[#003B73] hover:bg-[#054FA6] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm transition-colors mt-2"
              >
                Оформить талон
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {tickets.map(ticket => {
                const position = positions[ticket.id];
                const appointment = appointments[ticket.id];
                const branch = branches.find(b => b.id === ticket.branchId);
                const eta = etas[ticket.id];
                const managementToken = getSavedMgmtTokens(ownerScope)[ticket.id] || ticket.managementToken || undefined;
                const canExportAppointmentCalendar = ticket.source === 'APPOINTMENT'
                  && appointment
                  && isAppointmentCalendarEventAvailable(appointment, branch);

                return (
                  <div key={ticket.id} className="cx-active-ticket">
                    {/* Branded Ticket Header */}
                    <div className="cx-ticket-header" aria-live="polite" aria-atomic="true">
                      <span className="cx-ticket-num font-mono">{ticket.publicNumber}</span>
                      <StatusBadge status={ticket.status} source={ticket.source} />
                    </div>

                    {/* Details Body */}
                    <div className="cx-ticket-details">
                      <div className="cx-ticket-row">
                        <span>Услуга</span>
                        <strong>{services.find(s => s.id === ticket.serviceId)?.name || ticket.serviceId}</strong>
                      </div>
                      <div className="cx-ticket-row">
                        <span>Отделение</span>
                        <strong>{branch?.name || 'Почта России'}</strong>
                      </div>
                      {ticket.status === 'COMPLETED' && (() => {
                        const meta = getCompletedTicketMetadata(ticket);
                        return (
                          <>
                            <div className="cx-ticket-row">
                              <span>Окно</span>
                              <strong>{meta.windowText}</strong>
                            </div>
                            <div className="cx-ticket-row">
                              <span>Оператор</span>
                              <strong>{meta.operatorName}</strong>
                            </div>
                            <div className="cx-ticket-row">
                              <span>Дата</span>
                              <strong>{meta.dateStr}</strong>
                            </div>
                            <div className="cx-ticket-row">
                              <span>Время работы</span>
                              <strong>{meta.timeRange}</strong>
                            </div>
                            <div className="cx-ticket-row">
                              <span>Общее время работы</span>
                              <strong>{meta.durationStr}</strong>
                            </div>
                          </>
                        );
                      })()}
                      {appointment && (
                        <div className="cx-ticket-row">
                          <span>Время по записи</span>
                          <strong>{formatMoscowDateTime(appointment.scheduledAt)} МСК</strong>
                        </div>
                      )}
                      {ticket.status === 'CALLED' && ticket.window && (
                        <div className="cx-ticket-called-box">
                          Подойдите к окну <strong>№{ticket.window.number}</strong>
                        </div>
                      )}
                      {position?.ticketId === ticket.id && position.position !== null && position.position > 0 && (
                        <div className="cx-ticket-position">
                          <span className="cx-pos-label">Позиция в очереди</span>
                          <span className="cx-pos-val font-mono">{position.position}</span>
                        </div>
                      )}
                      {position?.reason === 'NOT_ELIGIBLE_YET' && (
                        <p className="text-xs text-slate-500 font-mono text-center">Время записи ещё не наступило</p>
                      )}
                      {position?.reason === 'NO_OPEN_COMPATIBLE_WINDOW' && (
                        <p className="text-xs text-slate-500 font-mono text-center">Ожидаем открытия подходящего окна</p>
                      )}
                      {!terminalStatuses.has(ticket.status) &&
                        eta?.ticketId === ticket.id &&
                        eta.ticketStatus === ticket.status &&
                        eta.reason === 'AVAILABLE' &&
                        eta.estimatedWaitSeconds !== null && (
                          <div className="cx-ticket-position cx-ticket-eta font-mono text-xs font-bold text-[#054FA6]">
                            <span className="cx-eta-label">Ожидание примерно{' '}<span className="cx-eta-duration">{Math.ceil(eta.estimatedWaitSeconds / 60)} мин</span></span>
                          </div>
                        )}
                      {!terminalStatuses.has(ticket.status) && (
                        <div className="pt-2 flex justify-center">
                          <BranchWorkloadCard
                            branch={branches.find(b => b.id === ticket.branchId)}
                            compact
                            overrideWaitMinutes={
                              eta?.ticketId === ticket.id && eta.estimatedWaitSeconds !== null
                                ? Math.ceil(eta.estimatedWaitSeconds / 60)
                                : undefined
                            }
                          />
                        </div>
                      )}
                    </div>

                    {!terminalStatuses.has(ticket.status) && <NotificationControls ticket={ticket} managementToken={managementToken} />}



                    {/* Actions Footer */}
                    <div className="cx-ticket-actions">
                      {canExportAppointmentCalendar && (
                        <AppointmentCalendarMenu appointment={appointment!} branch={branch!} />
                      )}
                      {ticket.status === 'SCHEDULED' && ticket.source === 'APPOINTMENT' && (
                        (ticket.arrivedAt || arrivalAcknowledgedTicketIds.has(ticket.id)) ? (
                          <div className="cx-ticket-alert cx-ticket-alert-success">
                            Ожидайте вызова, ваше прибытие отмечено
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="cx-btn cx-btn-primary cx-btn-block"
                            onClick={() => arrive(ticket)}
                            disabled={arriving}
                          >
                            {arriving ? 'Отмечаем...' : 'Я уже в отделении'}
                          </button>
                        )
                      )}
                      {(ticket.status === 'SCHEDULED' || ticket.status === 'WAITING') && (
                        <button
                          type="button"
                          className="cx-btn cx-btn-danger cx-btn-block"
                          onClick={() => cancel(ticket)}
                          disabled={cancellingTicketId !== null}
                        >
                          {cancellingTicketId === ticket.id
                            ? 'Отменяем...'
                            : (ticket.status === 'SCHEDULED' ? 'Отменить запись' : 'Отказаться от талона')}
                        </button>
                      )}
                      {terminalStatuses.has(ticket.status) && ticket.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          className="cx-btn cx-btn-primary cx-btn-block"
                          onClick={() => handleRepeatTicket(ticket.branchId)}
                        >
                          Взять новый талон
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderKioskTicket = () => (
    <div className="cx-wizard kiosk-ticket-card mx-auto text-center" aria-live="polite">
      <div className="kiosk-ticket-card__top">
        <div className="kiosk-ticket-card__icon"><TicketIcon size={28} aria-hidden /></div>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#054FA6]">Талон получен</p>
        <div className="cx-ticket-num kiosk-ticket-card__number font-mono">{kioskTicket?.publicNumber}</div>
        <p className="text-lg font-black text-slate-900">
          {services.find(service => service.id === kioskTicket?.serviceId)?.name || 'Выбранная услуга'}
        </p>
      </div>
      <div className="kiosk-ticket-card__message">
        <strong>Ожидайте вызова</strong>
        <span>Следите за номером талона на информационном табло.</span>
      </div>
      <button type="button" className="kiosk-ticket-card__button" onClick={resetKioskScreen}>
        На главный экран
      </button>
      <p className="mt-4 text-xs text-slate-400">Автоматический возврат к выбору услуги через 30 секунд</p>
    </div>
  );

  return (
    <div className={kiosk ? 'w-full' : 'cx-client-flow w-full'}>
      {kiosk && kioskTicket ? renderKioskTicket() : (
        <>
          {screen === 'booking' && renderBooking()}
          {screen === 'walkin' && renderWalkin()}
          {!kiosk && screen === 'my' && renderMy()}
          {!kiosk && screen === 'home' && renderHome()}
        </>
      )}

      {/* Interactive Yandex Map Modal */}
      {!kiosk && (
        <BranchMapModal
          isOpen={isMapModalOpen}
          onClose={() => setIsMapModalOpen(false)}
          branches={branches}
          workloads={workloads}
          userCoordinates={hasReliableGpsFix ? [currentCoordinates.lat, currentCoordinates.lng] : null}
          locationCenterRequest={locationCenterRequest}
          onRequestLocation={() => requestGpsPermission({ centerMap: true })}
          isLocatingUser={gpsPermissionStatus === 'locating'}
          locationError={gpsError}
          selectedBranchId={mapTargetBranchId}
          recommendedBranchId={null}
          initialFilter={mapInitialFilter}
          onSelectBranch={handleSelectBranchFromMap}
          onTakeTicket={(b) => handleSelectBranchFromMap(b, 'walkin')}
          onBookAppointment={(b) => handleSelectBranchFromMap(b, 'booking')}
        />
      )}

      {!kiosk && nearbyBranch && canShowNearbyBranchCard(ticketsLoading, hasActiveTicketForBranch) && (
        <NearbyBranchCard
          branch={nearbyBranch}
          distanceMeters={nearbyDistanceMeters}
          onTakeTicket={(id) => {
            setNearbyVisits(previous => dismissNearbyVisit(previous, id));
            handleRepeatTicket(id);
          }}
          onDetails={(id) => {
            setNearbyVisits(previous => dismissNearbyVisit(previous, id));
            handleOpenMap('all', id);
          }}
          onDismiss={(id) => setNearbyVisits(previous => dismissNearbyVisit(previous, id))}
        />
      )}

      {!kiosk && visitRatingQueue[0] && (
        <VisitRatingSheet
          ticket={visitRatingQueue[0]}
          branchName={branches.find(branch => branch.id === visitRatingQueue[0].branchId)?.name || 'Почта России'}
          onClose={() => finishVisitRating('dismissed')}
          onSubmit={(rating, comment) => finishVisitRating('reviewed', rating, comment)}
        />
      )}

    </div>
  );
}
