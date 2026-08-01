import { WS_URL } from './client';

type MessageHandler = (data: unknown) => void;

export interface WsRequestOptions {
  token?: string;
  clientMutationId?: string;
  queueIfOffline?: boolean;
}

interface QueueItem {
  id: string;
  type: string;
  payload?: unknown;
  clientMutationId: string;
  createdAt: number;
}

const QUEUE_KEY = 'ario_offline_queue';
const TOKEN_KEY = 'ario_token';
const USER_KEY = 'ario_user';

function loadQueue(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(q: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): { id: string; username: string; name: string; role: string } | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: { id: string; username: string; name: string; role: string }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private connected = false;
  private flushing = false;
  onStatusChange?: (online: boolean) => void;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.connected = true;
      this.onStatusChange?.(true);
      console.log('WS connected');
      this.emit('connected', { status: 'ok' });
      void this.flushQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.emit(data.type, data.payload);
        if (data.requestId) this.emit(`res:${data.requestId}`, data);
      } catch {
        console.warn('Invalid WS message');
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.onStatusChange?.(false);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  isOnline() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  queueLength() {
    return loadQueue().length;
  }

  async request<T = unknown>(
    type: string,
    payload?: unknown,
    options: WsRequestOptions = {}
  ): Promise<T> {
    const token = options.token ?? getStoredToken() ?? undefined;
    const clientMutationId = options.clientMutationId;
    const queueIfOffline = options.queueIfOffline ?? Boolean(clientMutationId);

    if (!this.isOnline()) {
      if (queueIfOffline && clientMutationId) {
        const q = loadQueue();
        q.push({
          id: `${Date.now()}-${Math.random()}`,
          type,
          payload,
          clientMutationId,
          createdAt: Date.now(),
        });
        saveQueue(q);
        return { queued: true, clientMutationId } as T;
      }
      throw new Error('اتصال برقرار نیست');
    }

    return new Promise((resolve, reject) => {
      const id = String(++this.requestId);
      const timeout = setTimeout(() => {
        this.off(`res:${id}`, handler);
        reject(new Error('Timeout'));
      }, 20000);

      const handler = (data: unknown) => {
        clearTimeout(timeout);
        const msg = data as { type: string; payload?: T; requestId?: string };
        if (msg.type === 'error') {
          const errPayload = msg.payload as { message?: string } | undefined;
          reject(new Error(errPayload?.message || 'خطا'));
          return;
        }
        resolve(msg.payload as T);
      };

      this.on(`res:${id}`, handler);
      this.ws!.send(
        JSON.stringify({
          type,
          payload,
          requestId: id,
          token,
          clientMutationId,
        })
      );
    });
  }

  async flushQueue() {
    if (this.flushing || !this.isOnline()) return;
    this.flushing = true;
    try {
      const q = loadQueue();
      const remaining: QueueItem[] = [];
      for (const item of q) {
        try {
          await this.request(item.type, item.payload, {
            clientMutationId: item.clientMutationId,
            queueIfOffline: false,
          });
        } catch {
          remaining.push(item);
        }
      }
      saveQueue(remaining);
    } finally {
      this.flushing = false;
    }
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: MessageHandler) {
    this.handlers.get(event)?.delete(handler);
  }

  /** subscribe و برگرداندن تابع لغو */
  onEvent(event: string, handler: MessageHandler) {
    this.on(event, handler);
    return () => this.off(event, handler);
  }

  private emit(event: string, data: unknown) {
    this.handlers.get(event)?.forEach((h) => h(data));
  }
}

export const wsClient = new WsClient();

export function newMutationId() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
