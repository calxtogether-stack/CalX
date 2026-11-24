import { describe, expect, it } from 'vitest';
import { OfflineMessageQueue } from './offline-queue.js';

describe('OfflineMessageQueue', () => {
  it('queues, deduplicates, retries, and flushes messages', async () => {
    const queue = new OfflineMessageQueue();

    await queue.enqueue({
      clientMessageId: 'msg-1',
      conversationId: 'conv-1',
      plaintext: 'Hello offline',
      messageType: 'text',
      replyToId: null,
      expiresAt: null,
    });

    // Duplicate clientMessageId should not create a second entry
    await queue.enqueue({
      clientMessageId: 'msg-1',
      conversationId: 'conv-1',
      plaintext: 'Hello offline',
      messageType: 'text',
      replyToId: null,
      expiresAt: null,
    });

    expect(await queue.getPending()).toHaveLength(1);

    const sentIds: string[] = [];
    const result = await queue.flush(async (item) => {
      sentIds.push(item.clientMessageId);
    });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sentIds).toEqual(['msg-1']);
    expect(await queue.getPending()).toHaveLength(0);
  });
});
