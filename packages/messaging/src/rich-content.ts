import {
  EDIT_WINDOW_SECONDS,
  type ChecklistPayload,
  type ContactCardPayload,
  type EventPayload,
  type LocationPayload,
  type Message,
  type MessageType,
} from '@calx/shared';

export type RichPayload =
  | LocationPayload
  | ContactCardPayload
  | EventPayload
  | ChecklistPayload;

export function parseRichContent(message: Message): RichPayload | null {
  if (!message.decrypted_text) return null;
  if (
    message.message_type !== 'location' &&
    message.message_type !== 'live_location' &&
    message.message_type !== 'contact_card' &&
    message.message_type !== 'event' &&
    message.message_type !== 'checklist'
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(message.decrypted_text) as Partial<RichPayload>;
    if (parsed && typeof parsed.kind === 'string') {
      return parsed as RichPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function canEditMessage(
  message: Message,
  currentUserId: string,
  nowMs = Date.now(),
  windowSeconds = EDIT_WINDOW_SECONDS,
): boolean {
  if (message.sender_id !== currentUserId) return false;
  if (message.deleted_at) return false;
  if (message.message_type !== 'text') return false;
  const createdMs = new Date(message.created_at).getTime();
  return nowMs - createdMs <= windowSeconds * 1000;
}

export interface LocalSearchFilters {
  senderId?: string;
  messageType?: MessageType;
}

export function searchLocalDecryptedMessages(
  messages: Message[],
  query: string,
  filters: LocalSearchFilters = {},
): Message[] {
  const q = query.trim().toLowerCase();
  return messages.filter((m) => {
    if (m.deleted_at) return false;
    if (filters.senderId && m.sender_id !== filters.senderId) return false;
    if (filters.messageType && m.message_type !== filters.messageType) return false;
    if (!q) return true;
    const text = (m.decrypted_text ?? '').toLowerCase();
    return text.includes(q);
  });
}

export function getRemainingSeconds(expiresAt: string | null | undefined, nowMs = Date.now()): number | null {
  if (!expiresAt) return null;
  const diff = Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000);
  return Math.max(0, diff);
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
