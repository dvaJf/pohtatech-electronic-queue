export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatSource {
  title: string;
  category: string;
}

export interface ChatCard {
  type: 'ticket_created' | 'ticket_status' | 'booking_confirmation_pending';
  data: any;
}

export interface ChatResponse {
  text: string;
  sources: ChatSource[];
  cards: ChatCard[];
}

export interface ChatContext {
  branch_id?: string;
  ticket_id?: string;
  user_phone?: string;
  pending_booking?: any;
  [key: string]: any;
}

export async function sendChatMessage(
  messages: ChatMessage[],
  context: ChatContext = {}
): Promise<ChatResponse> {
  const payload = {
    messages,
    context,
  };

  // Try direct agent route first, then fallback to backend proxied route
  const endpoints = ['/api/agent/chat', '/api/v1/agent/chat'];

  let lastError: any = null;
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return (await response.json()) as ChatResponse;
      }
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Не удалось связаться с цифровым ассистентом.');
}
