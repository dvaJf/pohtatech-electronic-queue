import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PochtaEmblem, PochtaWordmark } from '../../components/common/PochtaBrand';
import { useTVQueue } from '../../api/queries';
import { announceTicketCall, isSoundEnabled, setSoundEnabled, unlockSpeechSynthesis } from '../../utils/postalVoice';
import { enqueueAnnouncement } from '../../utils/announcementQueue';
import { subscribeToTVCalls } from '../../utils/tvNotification';
import { MOSCOW_BRANCHES } from './map/branchLocations';
import { resolveBranchIdFromSlug, getBranchDisplayName, getBranchSlug } from '../../utils/branchSlug';

/* ─────────────────────── types ─────────────────────── */
interface TVCall {
  windowId: number | string;
  windowName?: string;
  ticketNumber: string;
  serviceTitle: string;
  status?: string;
}

interface TVWaiting {
  number: string;
  serviceTitle: string;
}

/* ───────────────── Sber-style animated arrow ──────────────── */
function SberArrow() {
  return (
    <div className="tv-sber-arrow">
      <svg width="80" height="48" viewBox="0 0 80 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Three chevrons that animate sequentially like Sber terminals */}
        <path
          className="tv-chevron tv-chevron-1"
          d="M8 8L28 24L8 40"
          stroke="#003B73"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          className="tv-chevron tv-chevron-2"
          d="M28 8L48 24L28 40"
          stroke="#003B73"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          className="tv-chevron tv-chevron-3"
          d="M48 8L68 24L48 40"
          stroke="#003B73"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

/* ────────────── flash overlay for new call ──────────── */
function FlashOverlay({
  ticket,
  windowId,
  isRepeat,
  onClose,
}: {
  ticket: string;
  windowId: string | number;
  isRepeat?: boolean;
  onClose?: () => void;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onClose?.();
    }, 4500);
    return () => clearTimeout(t);
  }, [onClose]);
  if (!visible) return null;
  return (
    <div className="tv-flash-overlay">
      <div className="tv-flash-card">
        <div className="tv-flash-label">
          {isRepeat ? 'Повторный вызов талона!' : 'Талон вызван!'}
        </div>
        <div className="tv-flash-ticket">{ticket}</div>
        <SberArrow />
        <div className="tv-flash-window">Окно {windowId}</div>
      </div>
    </div>
  );
}

export interface TVBoardProps {
  branchId?: string;
}

/* ══════════════════════ MAIN TV BOARD ══════════════════════ */
export function TVBoard({ branchId: propBranchId }: TVBoardProps = {}) {
  /* ── state ── */
  const [now, setNow] = useState(() => new Date());
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>(() =>
    MOSCOW_BRANCHES.map(b => ({ id: b.id, name: b.name }))
  );

  const resolveRawBranchParam = (): string => {
    if (propBranchId) return propBranchId;
    if (typeof window !== 'undefined') {
      const match = window.location.pathname.match(/^\/tv\/([^/?#]+)/);
      if (match && match[1]) return decodeURIComponent(match[1]);
      const p = new URLSearchParams(window.location.search);
      if (p.get('branchId')) return p.get('branchId')!;
      const saved = localStorage.getItem('client_selected_branch_id') || localStorage.getItem('operator.branch');
      if (saved) return saved;
    }
    return '';
  };

  const [rawBranchParam, setRawBranchParam] = useState<string>(resolveRawBranchParam);

  /* ── sync prop changes ── */
  useEffect(() => {
    if (propBranchId && propBranchId !== rawBranchParam) {
      setRawBranchParam(propBranchId);
    }
  }, [propBranchId]);

  /* ── canonical UUID for API queries and subscriptions ── */
  const selectedBranchId = useMemo(() => {
    return resolveBranchIdFromSlug(rawBranchParam, branches);
  }, [rawBranchParam, branches]);

  const [flash, setFlash] = useState<{ ticket: string; windowId: string | number; isRepeat?: boolean } | null>(null);
  const flashKeyRef = useRef(0);
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isSoundEnabled();
  });

  const handleUnlockAudio = () => {
    setSoundEnabled(true);
    setAudioUnlocked(true);
    unlockSpeechSynthesis();
  };

  /* ── clock ── */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ── branches ── */
  useEffect(() => {
    fetch('/api/v1/branches')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const apiList = d?.items || [];
        const map = new Map<string, { id: string; name: string }>();
        for (const b of MOSCOW_BRANCHES) {
          map.set(b.id, { id: b.id, name: b.name });
        }
        for (const b of apiList) {
          map.set(b.id, { id: b.id, name: b.name });
        }
        const combined = Array.from(map.values());
        setBranches(combined);
        if (!rawBranchParam && combined.length > 0) {
          const firstSlug = getBranchSlug(combined[0].id, combined[0].name);
          setRawBranchParam(firstSlug);
          if (typeof window !== 'undefined' && window.location.pathname === '/tv') {
            window.history.replaceState({}, '', `/tv/${firstSlug}`);
          }
        }
      })
      .catch(() => {});
  }, [rawBranchParam]);

  /* ── live data for this specific branch ── */
  const { data: tvData, isLoading, error } = useTVQueue(selectedBranchId, 2500);

  /* ── sound announcements & cross-tab calls ── */
  const lastAnnouncedRef = useRef<Map<number, string>>(new Map());
  const lastAnnouncedTimestampRef = useRef<Map<string, number>>(new Map());
  const isInitialRef = useRef(true);

  const triggerCallAnnouncement = (ticketNumber: string, windowId: number | string, isRepeat = false) => {
    const key = `${ticketNumber}-${windowId}`;
    const nowTs = Date.now();
    const last = lastAnnouncedTimestampRef.current.get(key) || 0;
    // Allow repeat calls after 1.5 seconds, but prevent instant duplicates (e.g. from broadcast + polling)
    if (nowTs - last < 1500) {
      return;
    }
    lastAnnouncedTimestampRef.current.set(key, nowTs);

    enqueueAnnouncement(() => announceTicketCall(ticketNumber, windowId));
    flashKeyRef.current += 1;
    setFlash({ ticket: ticketNumber, windowId, isRepeat });
  };

  /* ── listen to operator cross-tab calls strictly for this branch ── */
  useEffect(() => {
    const unsubscribe = subscribeToTVCalls((ticketNumber, windowNumber, isRepeat, eventBranchId) => {
      // If event specified a branch, only process if it matches this TV board's branch!
      if (eventBranchId && selectedBranchId) {
        const resolvedEventBranchId = resolveBranchIdFromSlug(eventBranchId, branches);
        if (resolvedEventBranchId !== selectedBranchId) {
          return;
        }
      }
      triggerCallAnnouncement(ticketNumber, windowNumber, isRepeat);
    });
    return unsubscribe;
  }, [selectedBranchId, branches]);

  useEffect(() => {
    if (!tvData?.windows) return;
    const windows = tvData.windows as Array<{ number: number; currentTicketNumber?: string; currentTicketStatus?: string }>;

    if (isInitialRef.current) {
      windows.forEach(w => {
        if (w.currentTicketNumber && w.currentTicketStatus === 'CALLED') {
          lastAnnouncedRef.current.set(w.number, `${w.currentTicketNumber}:CALLED`);
        }
      });
      isInitialRef.current = false;
      return;
    }

    windows.forEach(w => {
      if (w.currentTicketNumber && w.currentTicketStatus === 'CALLED') {
        const prev = lastAnnouncedRef.current.get(w.number);
        const currentKey = `${w.currentTicketNumber}:CALLED`;
        if (prev !== currentKey) {
          lastAnnouncedRef.current.set(w.number, currentKey);
          triggerCallAnnouncement(w.currentTicketNumber, w.number);
        }
      } else {
        lastAnnouncedRef.current.delete(w.number);
      }
    });
  }, [tvData]);

  // A call is relevant only while the ticket is CALLED. Remove the transient
  // full-screen card as soon as polling reports that service has started.
  useEffect(() => {
    if (!flash || !tvData?.windows) return;
    const callWindow = (tvData.windows as Array<{
      number: number;
      currentTicketNumber?: string;
      currentTicketStatus?: string;
    }>).find(w => String(w.number) === String(flash.windowId));
    if (
      !callWindow ||
      callWindow.currentTicketNumber !== flash.ticket ||
      callWindow.currentTicketStatus !== 'CALLED'
    ) {
      setFlash(null);
    }
  }, [flash, tvData]);

  /* ── enable sound on first click / touch / keydown (autoplay policy) ── */
  useEffect(() => {
    const onGesture = () => {
      handleUnlockAudio();
      document.removeEventListener('click', onGesture);
      document.removeEventListener('touchstart', onGesture);
      document.removeEventListener('keydown', onGesture);
    };
    document.addEventListener('click', onGesture);
    document.addEventListener('touchstart', onGesture);
    document.addEventListener('keydown', onGesture);
    return () => {
      document.removeEventListener('click', onGesture);
      document.removeEventListener('touchstart', onGesture);
      document.removeEventListener('keydown', onGesture);
    };
  }, []);

  /* ── derived data ── */
  const calls: TVCall[] = useMemo(() => {
    if (!tvData?.windows) return [];
    const list = (tvData.windows as Array<{
      number: number;
      currentTicketNumber?: string;
      currentTicketStatus?: string;
      status: string;
    }>)
      .filter(w => w.status !== 'CLOSED' && w.currentTicketStatus === 'CALLED' && !!w.currentTicketNumber)
      .map(w => ({
        windowId: w.number,
        windowName: `Окно ${w.number}`,
        ticketNumber: w.currentTicketNumber!,
        serviceTitle: 'Обслуживание',
        status: w.status,
      }));
    return list;
  }, [tvData]);

  const waiting: TVWaiting[] = useMemo(() => {
    if (!tvData?.queue) return [];
    const list = (tvData.queue as Array<{ publicNumber: string; serviceName?: string; status?: string }>)
      .filter(q => q.status === 'WAITING')
      .map(q => ({ number: q.publicNumber, serviceTitle: q.serviceName || 'Услуга почты' }));
    return list;
  }, [tvData]);

  const branchName = useMemo(() => {
    return getBranchDisplayName(rawBranchParam || selectedBranchId, branches);
  }, [rawBranchParam, selectedBranchId, branches]);

  const hasData = !error && !isLoading && !!tvData;

  const timeString = now.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });

  const dateString = now.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  /* ═════════════════════ RENDER ═════════════════════ */
  return (
    <div className="tv-root">
      {/* ── FLASH OVERLAY ── */}
      {flash && (
        <FlashOverlay
          key={flashKeyRef.current}
          ticket={flash.ticket}
          windowId={flash.windowId}
          isRepeat={flash.isRepeat}
          onClose={() => setFlash(null)}
        />
      )}

      {/* ── TOP BAR ── */}
      <header className="tv-topbar">
        <div className="tv-topbar-left">
          <PochtaEmblem className="tv-emblem" bg="#003B73" fg="#FFFFFF" />
          <div className="tv-brand-block">
            <PochtaWordmark className="tv-wordmark" color="#003B73" />
            <span className="tv-branch-name">{branchName}</span>
          </div>
        </div>
        <div className="tv-topbar-right">
          {!audioUnlocked ? (
            <button
              type="button"
              className="tv-audio-btn"
              onClick={handleUnlockAudio}
              title="Разрешить голосовое оповещение в браузере"
            >
              Включить звук
            </button>
          ) : (
            <span className="tv-audio-badge" title="Голосовые оповещения активны">
              Звук включён
            </span>
          )}
          <div
            className="tv-clock-wrapper"
            title={hasData ? 'Связь с сервером активна (данные получены)' : error ? 'Нет связи с сервером очереди' : 'Подключение к системе очереди…'}
          >
            <span
              className={`tv-status-dot ${hasData ? 'tv-status-dot--online' : 'tv-status-dot--offline'}`}
              aria-label={hasData ? 'Онлайн' : 'Офлайн'}
              role="status"
            />
            <div className="tv-clock">{timeString}</div>
          </div>
        </div>
      </header>

      {/* ── CONTENT ── */}
      <div className="tv-content">
        {/* LEFT: Active calls */}
        <section className="tv-calls-section">
          <div className="tv-section-header">
            <span className="tv-section-dot tv-section-dot--green" />
            <span>Пройдите к окну</span>
          </div>

          <div className="tv-calls-grid">
            {calls.map((c) => {
              const isCardFlashing =
                flash &&
                flash.ticket === c.ticketNumber &&
                String(flash.windowId) === String(c.windowId);
              return (
                <div
                  key={`${c.windowId}-${c.ticketNumber}`}
                  className={`tv-call-card ${isCardFlashing ? 'tv-call-card--active' : ''}`}
                >
                  {/* Ticket */}
                  <div className="tv-call-ticket-col">
                    <div className="tv-call-label">ТАЛОН</div>
                    <div className="tv-call-ticket">{c.ticketNumber}</div>
                  </div>

                  {/* Sber-style Arrow */}
                  <SberArrow />

                  {/* Window */}
                  <div className="tv-call-window-col">
                    <div className="tv-call-label">ОКНО</div>
                    <div className="tv-call-window">{c.windowId}</div>
                  </div>
                </div>
              );
            })}

            {calls.length === 0 && (
              <div className="tv-empty">
                {isLoading ? 'Подключаем табло…' : error ? 'Нет связи с системой очереди' : 'Сейчас никто не вызывается'}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT: Waiting queue — flex-wrap grid, no scroll */}
        <section className="tv-waiting-section">
          <div className="tv-section-header">
            <span className="tv-section-dot tv-section-dot--amber" />
            <span>Ожидают</span>
            <span className="tv-waiting-count">{waiting.length}</span>
          </div>

          <div className="tv-waiting-grid">
            {waiting.map((w, i) => (
              <div key={`${w.number}-${i}`} className="tv-waiting-chip">
                <span className="tv-waiting-num">{w.number}</span>
              </div>
            ))}
            {waiting.length === 0 && (
              <div className="tv-empty-small">
                {isLoading ? 'Загрузка очереди…' : error ? 'Данные временно недоступны' : 'Ожидающих нет'}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── BOTTOM BAR ── */}
      <footer className="tv-bottombar">
        <div className="tv-bottombar-inner">
          <span>Электронная очередь • Почта России</span>
          <span>Пожалуйста, дождитесь вызова вашего талона</span>
        </div>
      </footer>

      {/* ── STYLES (scoped) ── */}
      <style>{tvStyles}</style>
    </div>
  );
}

/* ═════════════════════ CSS ═════════════════════ */
const tvStyles = `
/* ═══════════════════════ TV ROOT — LIGHT DESIGN ═══════════════════════ */
.tv-root {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  background: #F2F5F9;
  color: #1E293B;
  font-family: 'Golos Text', 'PT Sans', system-ui, sans-serif;
  overflow: hidden;
  user-select: none;
  cursor: default;
}

/* ═══════════════════════ TOP BAR ═══════════════════════ */
.tv-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.2vh 2.5vw;
  background: #FFFFFF;
  border-bottom: 4px solid #D92534;
  flex-shrink: 0;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.tv-topbar-left {
  display: flex;
  align-items: center;
  gap: 1.2vw;
}
.tv-emblem {
  width: 5.5vh;
  height: 5.5vh;
  border-radius: 14px;
  filter: drop-shadow(0 2px 6px rgba(0,59,115,0.15));
}
.tv-brand-block {
  display: flex;
  flex-direction: column;
  gap: 0.3vh;
}
.tv-wordmark {
  height: 3vh;
  width: auto;
}
.tv-branch-name {
  font-size: 1.5vh;
  color: #64748B;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.tv-topbar-right {
  display: flex;
  align-items: center;
  gap: 2vw;
}
.tv-audio-btn {
  font-family: inherit;
  font-size: 1.4vh;
  font-weight: 700;
  padding: 0.6vh 1.2vw;
  border-radius: 9999px;
  border: 1px solid #D97706;
  background: #FEF3C7;
  color: #92400E;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.tv-audio-btn:hover {
  background: #FDE68A;
  transform: scale(1.02);
}
.tv-audio-badge {
  font-size: 1.4vh;
  font-weight: 700;
  padding: 0.6vh 1.2vw;
  border-radius: 9999px;
  border: 1px solid #BBF7D0;
  background: #F0FDF4;
  color: #166534;
  white-space: nowrap;
}
.tv-clock-wrapper {
  display: flex;
  align-items: center;
  gap: 0.8vw;
}
.tv-status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background-color 0.3s ease, box-shadow 0.3s ease;
}
.tv-status-dot--online {
  background: #16A34A;
  box-shadow: 0 0 6px rgba(22, 163, 74, 0.45);
  animation: tv-dot-pulse 2s ease-in-out infinite;
}
.tv-status-dot--offline {
  background: #DC2626;
  box-shadow: 0 0 6px rgba(220, 38, 38, 0.45);
}
@keyframes tv-dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.85); }
}
.tv-clock {
  font-size: 4.5vh;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: #003B73;
}

/* ═══════════════════════ CONTENT ═══════════════════════ */
.tv-content {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 30vw);
  gap: 1.5vw;
  padding: 2vh 2vw;
  min-height: 0;
  min-width: 0;
  max-width: 100vw;
  box-sizing: border-box;
  overflow: hidden;
}

/* ─── SECTION HEADERS ─── */
.tv-section-header {
  display: flex;
  align-items: center;
  gap: 0.8vw;
  font-size: 2.4vh;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #334155;
  margin-bottom: 1.8vh;
  padding-bottom: 1vh;
  border-bottom: 2px solid #E2E8F0;
}
.tv-section-dot {
  width: 1.2vh;
  height: 1.2vh;
  border-radius: 50%;
}
.tv-section-dot--green {
  background: #22C55E;
  box-shadow: 0 0 10px rgba(34,197,94,0.4);
  animation: tv-pulse 2s ease-in-out infinite;
}
.tv-section-dot--amber {
  background: #F59E0B;
  box-shadow: 0 0 10px rgba(245,158,11,0.4);
  animation: tv-pulse 2s ease-in-out infinite 0.5s;
}

/* ═══════════════════════ CALL CARDS ═══════════════════════ */
.tv-calls-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
.tv-calls-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.8vh;
  flex: 1;
  align-content: start;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  padding: 4px;
  margin: -4px;
}
.tv-call-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5vh 2vw;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  container-type: inline-size;
  border-radius: 2.5vh;
  background: #FFFFFF;
  border: 2px solid #E2E8F0;
  box-shadow: 0 4px 16px rgba(0,0,0,0.04), 0 1px 4px rgba(0,0,0,0.03);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  animation: none;
}
.tv-call-card:hover {
  box-shadow: 0 8px 24px rgba(0,59,115,0.08);
}
.tv-call-card--active {
  border-color: #F59E0B !important;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.4), 0 4px 20px rgba(245, 158, 11, 0.25) !important;
  animation: tv-card-pulse 1.2s ease-in-out infinite;
}
@keyframes tv-card-pulse {
  0%, 100% {
    border-color: #F59E0B;
    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.35), 0 4px 16px rgba(245, 158, 11, 0.2);
  }
  50% {
    border-color: #D97706;
    box-shadow: 0 0 0 5px rgba(245, 158, 11, 0.6), 0 6px 24px rgba(245, 158, 11, 0.35);
  }
}
.tv-call-ticket-col,
.tv-call-window-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5vh;
  min-width: 0;
}
.tv-call-label {
  font-size: 1.4vh;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: #475569;
}
.tv-call-ticket {
  font-size: min(6.5vh, 6.5cqi);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-weight: 900;
  font-family: 'Golos Text', monospace;
  color: #003B73;
  line-height: 1;
  letter-spacing: 0.02em;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tv-call-window {
  font-size: min(6.5vh, 6.5cqi);
  white-space: nowrap;
  font-weight: 900;
  font-family: 'Golos Text', monospace;
  color: #FFFFFF;
  line-height: 1;
  background: #003B73;
  border-radius: 1.5vh;
  padding: 0.8vh 1.5vw;
  flex-shrink: 0;
}

/* ═══════════════════════ SBER-STYLE ANIMATED ARROW ═══════════════════════ */
.tv-sber-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.3vw;
  flex-shrink: 0;
}
.tv-sber-arrow svg {
  width: min(5vw, 64px);
  height: auto;
}

/* Sequential chevron animation — each chevron fades in/out with a stagger */
.tv-chevron {
  opacity: 0.15;
  animation: tv-sber-chevron 1.5s ease-in-out infinite;
}
.tv-chevron-1 {
  animation-delay: 0s;
}
.tv-chevron-2 {
  animation-delay: 0.2s;
}
.tv-chevron-3 {
  animation-delay: 0.4s;
}

@keyframes tv-sber-chevron {
  0% { opacity: 0.12; stroke-width: 3; }
  30% { opacity: 1; stroke-width: 5; }
  60% { opacity: 0.12; stroke-width: 3; }
  100% { opacity: 0.12; stroke-width: 3; }
}

/* ═══════════════════════ WAITING — CHIP GRID (no scroll) ═══════════════════════ */
.tv-waiting-section {
  display: flex;
  flex-direction: column;
  background: #FFFFFF;
  border-radius: 2.5vh;
  padding: 2vh 1.2vw;
  border: 2px solid #E2E8F0;
  box-shadow: 0 4px 16px rgba(0,0,0,0.04);
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
}
.tv-waiting-count {
  background: #FEF3C7;
  color: #B45309;
  border-radius: 1vh;
  padding: 0.3vh 1vw;
  font-variant-numeric: tabular-nums;
  font-size: 1.8vh;
  font-weight: 700;
  margin-left: auto;
}
.tv-waiting-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-content: start;
  gap: 1vh;
  overflow: hidden;
}
.tv-waiting-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1vh 0.5vw;
  min-width: 0;
  background: #F1F5F9;
  border: 2px solid #E2E8F0;
  border-radius: 1.5vh;
  animation: tv-chip-appear 0.4s ease-out backwards;
  transition: background 0.2s, border-color 0.2s;
}
.tv-waiting-chip:first-child {
  background: #EFF6FF;
  border-color: #93C5FD;
}
.tv-waiting-num {
  font-size: 2.6vh;
  font-weight: 900;
  font-family: 'Golos Text', monospace;
  color: #1E293B;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ═══════════════════════ BOTTOM BAR ═══════════════════════ */
.tv-bottombar {
  flex-shrink: 0;
  background: #FFFFFF;
  border-top: 2px solid #E2E8F0;
  padding: 1vh 2.5vw;
}
.tv-bottombar-inner {
  display: flex;
  justify-content: space-between;
  font-size: 1.4vh;
  color: #94A3B8;
  font-weight: 600;
  letter-spacing: 0.05em;
}

/* ═══════════════════════ EMPTY STATES ═══════════════════════ */
.tv-empty {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3vh;
  color: #94A3B8;
  font-weight: 600;
}
.tv-empty-small {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 4vh 0;
  font-size: 2vh;
  color: #94A3B8;
  font-weight: 600;
}

/* ═══════════════════════ FLASH OVERLAY ═══════════════════════ */
.tv-flash-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(24px);
  animation: tv-flash-in 0.4s ease-out, tv-flash-out 0.6s ease-in 3.9s forwards;
}
.tv-flash-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3vh;
  animation: tv-flash-scale 0.5s ease-out;
  max-width: 90vw;
  max-height: 90vh;
  box-sizing: border-box;
  overflow: hidden;
}
.tv-flash-label {
  font-size: min(4vh, 5vw);
  font-weight: 800;
  color: #16A34A;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  text-align: center;
  max-width: 100%;
}
.tv-flash-ticket {
  font-size: min(18vh, 12vw);
  font-weight: 900;
  font-family: 'Golos Text', monospace;
  color: #003B73;
  line-height: 1;
  white-space: nowrap;
  text-align: center;
  max-width: 100%;
}
.tv-flash-window {
  font-size: min(10vh, 8vw);
  font-weight: 900;
  color: #FFFFFF;
  background: #003B73;
  border-radius: 3vh;
  padding: 1vh 4vw;
  white-space: nowrap;
  text-align: center;
  max-width: 100%;
}

/* ═══════════════════════ ANIMATIONS ═══════════════════════ */
@keyframes tv-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

@keyframes tv-card-appear {
  from { opacity: 0; transform: translateY(2vh); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes tv-chip-appear {
  from { opacity: 0; transform: scale(0.85); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes tv-flash-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes tv-flash-out {
  from { opacity: 1; }
  to { opacity: 0; pointer-events: none; }
}
@keyframes tv-flash-scale {
  from { transform: scale(0.7); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* ═══════ RESPONSIVE: portrait/smaller screens fallback ═══════ */
@media (max-aspect-ratio: 4/3), (max-width: 960px) {
  .tv-content {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr auto;
  }
  .tv-calls-grid {
    grid-template-columns: 1fr;
  }
}
`;
