import { describe, expect, it } from 'vitest';
import { WebCryptoEncryptionProvider } from './index.js';

describe('E2EE Rich Payloads (Location, Contact, Event, Checklist, Scheduled)', () => {
  const provider = new WebCryptoEncryptionProvider();

  it('encrypts and decrypts structured rich payloads without plaintext leakage', async () => {
    const sender = await provider.generateDeviceIdentity();
    const recipient = await provider.generateDeviceIdentity();
    const convId = '11111111-1111-1111-1111-111111111111';
    const msgId = '22222222-2222-2222-2222-222222222222';

    const richPayloads = [
      JSON.stringify({ kind: 'location', lat: 37.7749, lng: -122.4194, isLive: true }),
      JSON.stringify({ kind: 'contact_card', name: 'Bob', phone: '+15550199', fieldsShared: ['name', 'phone'] }),
      JSON.stringify({ kind: 'event', title: 'Team Sync', startsAt: '2026-12-01T12:00:00Z' }),
      JSON.stringify({ status: 'going' }),
      'Buy milk and batteries',
    ];

    for (const plaintext of richPayloads) {
      const encrypted = await provider.encryptMessage({
        plaintext,
        conversationId: convId,
        clientMessageId: msgId,
        senderDeviceId: 'dev-a',
        senderPrivateKey: sender.identityPrivateKey,
        recipientDevices: [{ deviceId: 'dev-b', identityPublicKey: recipient.identityPublicKey }],
      });

      expect(encrypted.ciphertext).not.toContain('37.7749');
      expect(encrypted.ciphertext).not.toContain('Team Sync');

      const decrypted = await provider.decryptMessage({
        payload: encrypted,
        conversationId: convId,
        clientMessageId: msgId,
        recipientDeviceId: 'dev-b',
        recipientPrivateKey: recipient.identityPrivateKey,
        senderPublicKey: sender.identityPublicKey,
      });

      expect(decrypted).toBe(plaintext);
    }
  });
});
