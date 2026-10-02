import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  X,
  Send,
  RotateCcw,
  Sparkles,
  Ticket as TicketIcon,
  Clock,
  BookOpen,
  ChevronDown,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { sendChatMessage, ChatMessage, ChatSource, ChatCard } from './chatApi';
import { getMe } from '../../api/authApi';
import { MOSCOW_BRANCHES } from '../client/map/branchLocations';
import { calculateHaversineDistanceMeters } from '../client/arrival';
import './chat.css';

interface MessageItem extends ChatMessage {
  id: string;
  sources?: ChatSource[];
  cards?: ChatCard[];
  timestamp: string;
}

const INITIAL_GREETING: MessageItem = {
  id: 'init-1',
  role: 'assistant',
  content: `Здравствуйте! Я **Цифровой помощник Почты России**.\n\nЯ отвечу на любые вопросы по услугам, тарифам, правилам отправки посылок и писем, а также помогу с вашей очередью или записью. Чем могу помочь?`,
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
};

export const AIAssistantWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([INITIAL_GREETING]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingBooking, setPendingBooking] = useState<any>(null);
  const pendingBookingRef = useRef<any>(null);
  pendingBookingRef.current = pendingBooking;

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Mobile visual viewport and virtual keyboard adaptation
  const [viewportStyle, setViewportStyle] = useState<React.CSSProperties>({});
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 768;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Keyboard navigation & Close on Escape
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen]);

  // Handle mobile visualViewport resize when virtual keyboard opens/closes
  // and lock background page scrolling so the footer/page never interferes
  useEffect(() => {
    if (!isOpen) {
      setViewportStyle({});
      return;
    }

    if (!isMobile) {
      setViewportStyle({});
      return;
    }

    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    const handleViewportChange = () => {
      if (window.visualViewport) {
        const vv = window.visualViewport;
        setViewportStyle({
          height: `${vv.height}px`,
          top: `${vv.offsetTop}px`,
          bottom: 'auto',
        });
      } else {
        setViewportStyle({
          height: '100dvh',
          top: '0px',
          bottom: 'auto',
        });
      }
    };

    handleViewportChange();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', handleViewportChange);
      vv.addEventListener('scroll', handleViewportChange);
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
      if (vv) {
        vv.removeEventListener('resize', handleViewportChange);
        vv.removeEventListener('scroll', handleViewportChange);
      }
    };
  }, [isOpen, isMobile]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      setUnreadCount(0);
      if (!isMobile) {
        inputRef.current?.focus();
      }
    }
  }, [isOpen, messages, isMobile, scrollToBottom]);

  const getClientContext = useCallback(async () => {
    let branchId = localStorage.getItem('client_selected_branch_id') || undefined;
    let user: any = null;
    let userName = '';
    let userPhone = '';
    let userEmail = '';

    try {
      user = await getMe().catch(() => null);
      if (user) {
        userEmail = user.email || '';
        userPhone = user.phone || '';
        userName =
          user.fio ||
          localStorage.getItem(`user_fio:${user.id || user.email}`) ||
          localStorage.getItem(`user_fio:${user.email}`) ||
          (user.email ? user.email.split('@')[0] : '');
      }
    } catch {}

    const scopes = Array.from(new Set([user?.id, 'anon'].filter(Boolean) as string[]));
    const activeTickets: Array<{
      id: string;
      number: string;
      serviceName: string;
      branchId?: string;
      status: string;
    }> = [];
    const seenIds = new Set<string>();

    for (const scope of scopes) {
      // 1. Cached tickets
      const cacheKey = `client_active_tickets_cache:${scope}`;
      const rawCache = sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey);
      if (rawCache) {
        try {
          const list = JSON.parse(rawCache);
          if (Array.isArray(list)) {
            for (const t of list) {
              if (t && t.id && !seenIds.has(t.id) && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(t.status)) {
                seenIds.add(t.id);
                activeTickets.push({
                  id: t.id,
                  number: t.publicNumber || t.number || '',
                  serviceName: t.serviceName || 'Почтовые услуги',
                  branchId: t.branchId,
                  status: t.status || 'WAITING',
                });
              }
            }
          }
        } catch {}
      }

      // 2. Saved IDs
      const idKey = `client_active_ticket_ids:${scope}`;
      const rawIds = sessionStorage.getItem(idKey) || localStorage.getItem(idKey);
      if (rawIds) {
        try {
          const idList = JSON.parse(rawIds);
          if (Array.isArray(idList)) {
            for (const id of idList) {
              if (typeof id === 'string' && !seenIds.has(id)) {
                seenIds.add(id);
                activeTickets.push({
                  id,
                  number: 'Талон',
                  serviceName: 'Почтовые услуги',
                  status: 'WAITING',
                });
              }
            }
          }
        } catch {}
      }

      // 3. Appointments
      const appKey = `client.appointments:${scope}`;
      const rawApps = sessionStorage.getItem(appKey) || localStorage.getItem(appKey);
      if (rawApps) {
        try {
          const apps = JSON.parse(rawApps);
          if (apps && typeof apps === 'object') {
            for (const [_, a] of Object.entries(apps)) {
              const t = (a as any)?.ticket;
              if (t && t.id && !seenIds.has(t.id) && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(t.status)) {
                seenIds.add(t.id);
                activeTickets.push({
                  id: t.id,
                  number: t.publicNumber || t.number || 'Запись',
                  serviceName: t.serviceName || 'Предварительная запись',
                  branchId: t.branchId,
                  status: t.status || 'SCHEDULED',
                });
              }
            }
          }
        } catch {}
      }
    }

    const latestTicketId = activeTickets[activeTickets.length - 1]?.id;

    // Geolocation coordinates
    let userLat = 55.76194;
    let userLng = 37.63869;
    const storedLat = localStorage.getItem('pochta_user_lat');
    const storedLng = localStorage.getItem('pochta_user_lng');
    if (storedLat && storedLng) {
      const parsedLat = parseFloat(storedLat);
      const parsedLng = parseFloat(storedLng);
      if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
        userLat = parsedLat;
        userLng = parsedLng;
      }
    }

    // Find nearest branch
    let nearestBranch: any = null;
    let minDistance = Infinity;
    for (const b of MOSCOW_BRANCHES) {
      const d = calculateHaversineDistanceMeters(userLat, userLng, b.lat, b.lng);
      if (d < minDistance) {
        minDistance = d;
        nearestBranch = {
          id: b.id,
          name: b.name,
          address: b.address,
          metro: b.metro,
          code: b.code,
          distance_meters: d,
          distance_text: d < 1000 ? `${d} м` : `${(d / 1000).toFixed(1)} км`,
        };
      }
    }

    if (!branchId && nearestBranch) {
      branchId = nearestBranch.id;
    }

    return {
      branch_id: branchId,
      ticket_id: latestTicketId,
      user: {
        id: user?.id,
        name: userName,
        fio: userName,
        email: userEmail,
        phone: userPhone,
        isAuthenticated: !!user,
      },
      location: {
        lat: userLat,
        lng: userLng,
        coordinates: { lat: userLat, lng: userLng },
        nearest_branch: nearestBranch,
      },
      active_tickets: activeTickets,
      pending_booking: pendingBookingRef.current,
    };
  }, []);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isLoading) return;

    const userMsg: MessageItem = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history: ChatMessage[] = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const context = await getClientContext();
      const response = await sendChatMessage(history, context);

      const assistantMsg: MessageItem = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.text,
        sources: response.sources,
        cards: response.cards,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Manage pending booking state
      const isCancelMsg = /^(нет|отмена|отмени|не надо|стоп)\b/i.test(text.trim());
      if (isCancelMsg) {
        setPendingBooking(null);
      }

      // If a new ticket or pending confirmation was returned
      if (response.cards && response.cards.length > 0) {
        for (const card of response.cards) {
          if (card.type === 'booking_confirmation_pending' && card.data) {
            setPendingBooking(card.data);
          } else if (card.type === 'ticket_created' && card.data?.id) {
            setPendingBooking(null);
            try {
              const ticket = card.data;
              const user = await getMe().catch(() => null);
              const scopes = Array.from(new Set([user?.id, 'anon'].filter(Boolean) as string[]));

              for (const scope of scopes) {
                // 1. Save ID to client_active_ticket_ids:<scope>
                const key = `client_active_ticket_ids:${scope}`;
                const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
                let currentIds: string[] = [];
                try { if (raw) currentIds = JSON.parse(raw); } catch {}
                if (!currentIds.includes(ticket.id)) {
                  currentIds.push(ticket.id);
                  sessionStorage.setItem(key, JSON.stringify(currentIds));
                  localStorage.setItem(key, JSON.stringify(currentIds));
                }

                // 2. Save ticket to client_active_tickets_cache:<scope>
                const cacheKey = `client_active_tickets_cache:${scope}`;
                const rawCache = sessionStorage.getItem(cacheKey) || localStorage.getItem(cacheKey);
                let currentTickets: any[] = [];
                try { if (rawCache) currentTickets = JSON.parse(rawCache); } catch {}
                if (!currentTickets.some((t: any) => t.id === ticket.id)) {
                  currentTickets.push(ticket);
                  sessionStorage.setItem(cacheKey, JSON.stringify(currentTickets));
                  localStorage.setItem(cacheKey, JSON.stringify(currentTickets));
                }

                // 3. Save managementToken if available
                if (ticket.managementToken) {
                  const tokenKey = `client_management_tokens:${scope}`;
                  const rawTokens = sessionStorage.getItem(tokenKey) || localStorage.getItem(tokenKey);
                  let currentTokens: Record<string, string> = {};
                  try { if (rawTokens) currentTokens = JSON.parse(rawTokens); } catch {}
                  currentTokens[ticket.id] = ticket.managementToken;
                  sessionStorage.setItem(tokenKey, JSON.stringify(currentTokens));
                  localStorage.setItem(tokenKey, JSON.stringify(currentTokens));
                }

                // 4. Save to client.appointments if appointment ticket
                if (ticket.source === 'APPOINTMENT' || ticket.scheduledAt) {
                  const appKey = `client.appointments:${scope}`;
                  const rawApps = sessionStorage.getItem(appKey) || localStorage.getItem(appKey);
                  let currentApps: Record<string, any> = {};
                  try { if (rawApps) currentApps = JSON.parse(rawApps); } catch {}
                  currentApps[ticket.id] = {
                    ticket: ticket,
                    scheduledAt: ticket.scheduledAt || ticket.queueEnteredAt,
                    managementToken: ticket.managementToken,
                  };
                  sessionStorage.setItem(appKey, JSON.stringify(currentApps));
                  localStorage.setItem(appKey, JSON.stringify(currentApps));
                }
              }

              // Also save to generic fallback client_active_ticket_ids
              const genericRaw = localStorage.getItem('client_active_ticket_ids');
              let genericIds: string[] = [];
              try { if (genericRaw) genericIds = JSON.parse(genericRaw); } catch {}
              if (!genericIds.includes(ticket.id)) {
                genericIds.push(ticket.id);
                localStorage.setItem('client_active_ticket_ids', JSON.stringify(genericIds));
                sessionStorage.setItem('client_active_ticket_ids', JSON.stringify(genericIds));
              }

              // Fire custom events so ClientWorkspace immediately sees the new ticket and starts polling
              window.dispatchEvent(new CustomEvent('pochta:ticket-created', { detail: ticket }));
              window.dispatchEvent(new CustomEvent('pochta:auth', { detail: {} }));
              window.dispatchEvent(new Event('storage'));
            } catch (e) {
              console.error('Failed to persist ticket to personal cabinet:', e);
            }
          }
        }
      }

      if (!isOpen) {
        setUnreadCount((c) => c + 1);
      }
    } catch (err: any) {
      const errorMsg: MessageItem = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Не удалось связаться с сервером ассистента: ${err?.message || 'Ошибка сети'}. Пожалуйста, попробуйте еще раз через несколько секунд.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearHistory = () => {
    setMessages([INITIAL_GREETING]);
  };

  const renderMarkdown = (text: string) => {
    // Quick safe formatter for bolding, bullet points, headers
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      let trimmed = line.trim();
      if (!trimmed) {
        return <div key={idx} className="h-2" />;
      }

      if (trimmed.startsWith('### ')) {
        return (
          <h3 key={idx} className="font-bold text-sm text-[#0055A5] mt-1 mb-1">
            {trimmed.replace('### ', '')}
          </h3>
        );
      }

      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const itemText = trimmed.slice(2);
        return (
          <div key={idx} className="flex items-start gap-1.5 ml-2 my-0.5">
            <span className="text-[#0055A5] font-bold">•</span>
            <span>{formatBold(itemText)}</span>
          </div>
        );
      }

      return (
        <p key={idx} className="my-1">
          {formatBold(trimmed)}
        </p>
      );
    });
  };

  const formatBold = (str: string) => {
    const parts = str.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  return (
    <div className={`ai-widget-container ${isOpen ? 'ai-widget-open' : ''}`}>
      {/* Floating Launcher Button */}
      {!isOpen && (
        <button
          type="button"
          className="ai-widget-trigger group"
          onClick={() => setIsOpen(true)}
          aria-label="Открыть цифровой ассистент"
          title="Цифровой ассистент Почты"
        >
          <div className="ai-widget-trigger-pulse" />
          <Sparkles className="w-6 h-6 transition-transform group-hover:rotate-12" />
          {unreadCount > 0 && <span className="ai-badge">{unreadCount}</span>}
        </button>
      )}

      {/* Floating Chat Modal (Desktop) / Fullscreen Modal (Mobile) */}
      {isOpen && (
        <div
          className="ai-chat-window"
          style={isMobile && viewportStyle.height ? viewportStyle : undefined}
        >
          {/* Header */}
          <div className="ai-chat-header">
            <div className="ai-chat-title-group">
              <div className="ai-avatar">
                <Sparkles className="w-5 h-5 text-white" />
                <div className="ai-status-dot" title="Ассистент онлайн" />
              </div>
              <div>
                <div className="font-bold text-sm leading-tight">
                  Почтовый ассистент
                </div>
              </div>
            </div>

            <div className="ai-chat-header-actions">
              <button
                type="button"
                className="ai-header-btn"
                onClick={handleClearHistory}
                title="Очистить переписку"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="ai-header-btn"
                onClick={() => setIsOpen(false)}
                title={isMobile ? 'Закрыть чат' : 'Свернуть'}
                aria-label={isMobile ? 'Закрыть чат' : 'Свернуть'}
              >
                {isMobile ? <X className="w-5 h-5" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="ai-messages-list">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`ai-message ${m.role === 'user' ? 'ai-message-user' : 'ai-message-assistant'}`}
              >
                <div className="ai-bubble">
                  <div className="ai-bubble-markdown">{renderMarkdown(m.content)}</div>


                  {/* Render Interactive Cards */}
                  {m.cards && m.cards.length > 0 && (
                    <div className="ai-cards-list">
                      {m.cards.map((card, cIdx) => {
                        if (card.type === 'ticket_created') {
                          const t = card.data;
                          return (
                            <div key={cIdx} className="ai-ticket-card">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="text-[11px] uppercase tracking-wider text-[#0055A5] font-bold flex items-center gap-1.5">
                                    <TicketIcon className="w-3.5 h-3.5 text-[#0055A5]" />
                                    <span>Ваш талон в очередь</span>
                                  </div>
                                  <div className="ai-ticket-number mt-1 font-extrabold text-[#003B73]">
                                    {t.publicNumber || t.number || 'A01'}
                                  </div>
                                </div>
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>Оформлен</span>
                                </span>
                              </div>
                              <div className="ai-ticket-meta mt-2 text-slate-700 space-y-1">
                                {t.serviceName && <div className="font-medium text-slate-800">Услуга: {t.serviceName}</div>}
                                {t.scheduledAt ? (
                                  <div className="flex items-center gap-1 text-[#0055A5] font-semibold">
                                    <Clock className="w-3.5 h-3.5 text-[#0055A5]" />
                                    <span>Запись на: {new Date(t.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                ) : (
                                  <div className="text-slate-600">
                                    Живая очередь • Ожидайте вызова на табло
                                  </div>
                                )}
                              </div>
                              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                                <span className="text-[11.5px] text-emerald-700 flex items-center gap-1 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  Сохранён в личном кабинете
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    window.dispatchEvent(new CustomEvent('pochta:show-tickets'));
                                  }}
                                  className="text-xs bg-[#0055A5] hover:bg-[#003B73] text-white font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm"
                                >
                                  <span>В «Мои талоны»</span>
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        }
                        if (card.type === 'ticket_status') {
                          const t = card.data?.ticket;
                          const pos = card.data?.position;
                          const eta = card.data?.eta;
                          return (
                            <div key={cIdx} className="ai-ticket-card">
                              <div className="flex justify-between items-center">
                                <span className="ai-ticket-number text-[#003B73]">{t?.publicNumber || 'Талон'}</span>
                                <span className="bg-sky-50 text-[#0055A5] border border-sky-200 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                                  {t?.status || 'В очереди'}
                                </span>
                              </div>
                              <div className="ai-ticket-meta mt-2 text-slate-700">
                                {pos?.position !== undefined && (
                                  <div>Перед вами: <strong className="text-slate-900">{pos.position} чел.</strong></div>
                                )}
                                {(eta?.estimatedWaitSeconds || eta?.predictedEtaSeconds) && (
                                  <div>Ориентировочно: <strong className="text-[#0055A5]">~{Math.round((eta.estimatedWaitSeconds || eta.predictedEtaSeconds) / 60)} мин.</strong></div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        if (card.type === 'booking_confirmation_pending') {
                          const data = card.data;
                          return (
                            <div key={cIdx} className="ai-ticket-card" style={{ borderLeftColor: '#0055a5' }}>
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="text-[11px] uppercase tracking-wider text-[#0055A5] font-bold flex items-center gap-1">
                                    <TicketIcon className="w-3.5 h-3.5 text-[#0055A5]" />
                                    <span>Подтверждение записи</span>
                                  </div>
                                  <div className="text-slate-900 font-bold text-sm mt-1">
                                    {data.branchName}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {data.branchAddress}
                                  </div>
                                </div>
                                <span className="bg-blue-50 text-[#0055A5] border border-blue-200 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                                  {data.bookingType === 'APPOINTMENT' ? 'Онлайн-запись' : 'В очередь'}
                                </span>
                              </div>
                              <div className="ai-ticket-meta mt-2 border-t border-slate-100 pt-2 space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-slate-800 font-medium">
                                  <Clock className="w-3.5 h-3.5 text-[#0055A5] shrink-0" />
                                  <span>{data.scheduledText || 'Живая очередь (сейчас)'}</span>
                                </div>
                                <div className="text-xs text-slate-600">
                                  Услуга: <span className="text-slate-900 font-semibold">{data.serviceName}</span>
                                </div>
                              </div>
                              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSendMessage('Да')}
                                  disabled={isLoading}
                                  className="flex-1 bg-[#0055A5] hover:bg-[#003670] active:bg-[#002855] text-white text-xs font-semibold py-2 px-3 rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-all"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Да, всё верно</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSendMessage('Отмена')}
                                  disabled={isLoading}
                                  className="bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 text-xs font-medium py-2 px-3 rounded-lg border border-slate-200 transition-all"
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 mt-1 px-1">{m.timestamp}</span>
              </div>
            ))}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="ai-message ai-message-assistant">
                <div className="ai-typing-indicator">
                  <div className="ai-typing-dot" />
                  <div className="ai-typing-dot" />
                  <div className="ai-typing-dot" />
                  <span className="text-xs text-slate-500 ml-1.5 font-medium">
                    Поиск в базе знаний...
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Footer */}
          <div className="ai-chat-input-area">
            <textarea
              ref={inputRef}
              className="ai-input"
              rows={1}
              placeholder="Задайте вопрос..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setTimeout(scrollToBottom, 280);
              }}
            />
            <button
              type="button"
              className="ai-send-btn"
              onClick={() => handleSendMessage()}
              disabled={isLoading || !input.trim()}
              title="Отправить (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
