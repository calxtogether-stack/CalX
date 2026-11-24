import type { MessageType } from '@calx/shared';

export interface QueuedOutboundMessage {
  clientMessageId: string;
  conversationId: string;
  plaintext: string;
  messageType: MessageType;
  replyToId: string | null;
  expiresAt: string | null;
  attempts: number;
  nextAttemptAt: number;
  createdAt: string;
}

export interface QueueStorageAdapter {
  load(): Promise<QueuedOutboundMessage[]>;
  save(items: QueuedOutboundMessage[]): Promise<void>;
}

export class InMemoryQueueStorage implements QueueStorageAdapter {
  private items: QueuedOutboundMessage[] = [];
  async load(): Promise<QueuedOutboundMessage[]> {
    return [...this.items];
  }
  async save(items: QueuedOutboundMessage[]): Promise<void> {
    this.items = [...items];
  }
}

export class OfflineMessageQueue {
  private queue: QueuedOutboundMessage[] = [];
  private loaded = false;

  constructor(private readonly storage: QueueStorageAdapter = new InMemoryQueueStorage()) {}

  async init(): Promise<void> {
    if (!this.loaded) {
      this.queue = await this.storage.load();
      this.loaded = true;
    }
  }

  async enqueue(
    item: Omit<QueuedOutboundMessage, 'attempts' | 'nextAttemptAt' | 'createdAt'>,
  ): Promise<QueuedOutboundMessage> {
    await this.init();
    const existing = this.queue.find((q) => q.clientMessageId === item.clientMessageId);
    if (existing) return existing;

    const entry: QueuedOutboundMessage = {
      ...item,
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: new Date().toISOString(),
    };
    this.queue.push(entry);
    await this.storage.save(this.queue);
    return entry;
  }

  async markSucceeded(clientMessageId: string): Promise<void> {
    await this.init();
    this.queue = this.queue.filter((q) => q.clientMessageId !== clientMessageId);
    await this.storage.save(this.queue);
  }

  async markFailed(clientMessageId: string): Promise<void> {
    await this.init();
    const item = this.queue.find((q) => q.clientMessageId === clientMessageId);
    if (!item) return;
    item.attempts += 1;
    const backoffMs = Math.min(1000 * Math.pow(2, item.attempts), 60_000);
    item.nextAttemptAt = Date.now() + backoffMs;
    await this.storage.save(this.queue);
  }

  async flush(
    sender: (item: QueuedOutboundMessage) => Promise<void>,
  ): Promise<{ sent: number; failed: number }> {
    await this.init();
    const now = Date.now();
    const due = this.queue.filter((q) => q.nextAttemptAt <= now);
    let sent = 0;
    let failed = 0;

    for (const item of due) {
      try {
        await sender(item);
        await this.markSucceeded(item.clientMessageId);
        sent += 1;
      } catch {
        await this.markFailed(item.clientMessageId);
        failed += 1;
      }
    }
    return { sent, failed };
  }

  async getPending(): Promise<QueuedOutboundMessage[]> {
    await this.init();
    return [...this.queue];
  }
}
