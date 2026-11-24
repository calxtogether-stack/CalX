import { describe, expect, it } from 'vitest';
import type { Message } from '@calx/shared';
import {
  canEditMessage,
  formatCountdown,
  getRemainingSeconds,
  parseRichContent,
  searchLocalDecryptedMessages,
} from './rich-content.js';

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: 'user-1',
    sender_device_id: 'dev-1',
    client_message_id: 'c-1',
    message_type: 'text',
    encrypted_payload: {
      ciphertext: 'abc',
      iv: 'iv',
      sender_device_id: 'dev-1',
      key_version: 1,
      algorithm: 'ECDH-P256-HKDF-AES256GCM',
    },
    reply_to_id: null,
    expires_at: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    decrypted_text: 'Hello world',
    ...overrides,
  };
}

describe('Rich Content & Message Management Helpers', () => {
  it('parses encrypted rich message types safely', () => {
    const locMsg = makeMsg({
      message_type: 'location',
      decrypted_text: JSON.stringify({ kind: 'location', lat: 37.77, lng: -122.41 }),
    });
    expect(parseRichContent(locMsg)).toEqual({ kind: 'location', lat: 37.77, lng: -122.41 });
    expect(parseRichContent(makeMsg())).toBeNull();
  });

  it('enforces edit ownership and 15-minute edit window', () => {
    const now = Date.now();
    const recent = makeMsg({ created_at: new Date(now - 60_000).toISOString() });
    const old = makeMsg({ created_at: new Date(now - 20 * 60_000).toISOString() });

    expect(canEditMessage(recent, 'user-1', now)).toBe(true);
    expect(canEditMessage(recent, 'user-2', now)).toBe(false);
    expect(canEditMessage(old, 'user-1', now)).toBe(false);
  });

  it('searches local decrypted messages with sender and type filters', () => {
    const msgs = [
      makeMsg({ id: '1', sender_id: 'u1', decrypted_text: 'Flight at 9am' }),
      makeMsg({ id: '2', sender_id: 'u2', decrypted_text: 'Flight confirmed' }),
      makeMsg({ id: '3', sender_id: 'u1', deleted_at: '2026-01-01T00:00:00Z', decrypted_text: 'Flight deleted' }),
    ];
    expect(searchLocalDecryptedMessages(msgs, 'flight')).toHaveLength(2);
    expect(searchLocalDecryptedMessages(msgs, 'flight', { senderId: 'u2' })).toHaveLength(1);
  });

  it('computes and formats expiration countdowns', () => {
    const now = 1_000_000;
    const future = new Date(now + 95_000).toISOString();
    expect(getRemainingSeconds(future, now)).toBe(95);
    expect(formatCountdown(95)).toBe('1m 35s');
    expect(formatCountdown(0)).toBe('Expired');
  });
});
