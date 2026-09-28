export interface TVCallEvent {
  ticketNumber: string;
  windowNumber: number | string;
  timestamp: number;
  isRepeat?: boolean;
  branchId?: string;
}

const TV_CHANNEL_NAME = 'pochta_tv_channel';
const TV_STORAGE_KEY = 'pochta_tv_call_event';

let persistentSenderChannel: BroadcastChannel | null = null;
function getSenderChannel(): BroadcastChannel | null {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    if (!persistentSenderChannel) {
      try {
        persistentSenderChannel = new BroadcastChannel(TV_CHANNEL_NAME);
      } catch {}
    }
    return persistentSenderChannel;
  }
  return null;
}

/**
 * Notifies all open /tv tabs (across browser tabs on the same origin)
 * about a ticket call or repeat call. The operator tab will NOT play sound.
 */
export function broadcastTicketCallToTV(
  ticketNumber: string,
  windowNumber: number | string,
  isRepeat = false,
  branchId?: string
): void {
  const event: TVCallEvent = {
    ticketNumber: ticketNumber.trim(),
    windowNumber,
    timestamp: Date.now(),
    isRepeat,
    branchId: branchId?.trim(),
  };

  // 1. BroadcastChannel (persistent, do NOT close synchronously to prevent aborting messages)
  try {
    const channel = getSenderChannel();
    if (channel) {
      channel.postMessage({ type: 'TICKET_CALL', ...event });
    }
  } catch {}

  // 2. LocalStorage for cross-tab fallback
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(TV_STORAGE_KEY, JSON.stringify(event));
    }
  } catch {}

  // 3. CustomEvent for same-window / iframe listeners
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pochta:tv_call', { detail: event }));
    }
  } catch {}
}

/**
 * Subscribes to ticket call events broadcasted by operators.
 * Used exclusively by the /tv board.
 */
export function subscribeToTVCalls(
  callback: (ticketNumber: string, windowNumber: number | string, isRepeat?: boolean, branchId?: string) => void
): () => void {
  let channel: BroadcastChannel | null = null;

  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel(TV_CHANNEL_NAME);
      channel.onmessage = (e) => {
        if (e.data?.type === 'TICKET_CALL' && e.data.ticketNumber && e.data.windowNumber !== undefined) {
          callback(e.data.ticketNumber, e.data.windowNumber, !!e.data.isRepeat, e.data.branchId);
        }
      };
    }
  } catch {}

  const onStorage = (e: StorageEvent) => {
    if (e.key === TV_STORAGE_KEY && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        if (data?.ticketNumber && data?.windowNumber !== undefined) {
          callback(data.ticketNumber, data.windowNumber, !!data.isRepeat, data.branchId);
        }
      } catch {}
    }
  };

  const onCustom = (e: Event) => {
    const ce = e as CustomEvent<TVCallEvent>;
    if (ce.detail?.ticketNumber && ce.detail?.windowNumber !== undefined) {
      callback(ce.detail.ticketNumber, ce.detail.windowNumber, !!ce.detail.isRepeat, ce.detail.branchId);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    window.addEventListener('pochta:tv_call', onCustom);
  }

  return () => {
    if (channel) {
      try {
        channel.close();
      } catch {}
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pochta:tv_call', onCustom);
    }
  };
}
