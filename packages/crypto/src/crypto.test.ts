import { describe, expect, it } from 'vitest';
import {
  computeLockoutSeconds,
  derivePinHash,
  verifyPinHash,
  WebCryptoEncryptionProvider,
} from './index.js';

describe('PIN Derivation & Rate Limiting', () => {
  it('derives and verifies PBKDF2 PIN hash without plaintext storage', async () => {
    const record = await derivePinHash('2580');
    expect(record.hash).not.toContain('2580');
    expect(await verifyPinHash('2580', record)).toBe(true);
    expect(await verifyPinHash('0000', record)).toBe(false);
  });

  it('computes exponential lockout backoff after 5 failed attempts', () => {
    expect(computeLockoutSeconds(4)).toBe(0);
    expect(computeLockoutSeconds(5)).toBe(30);
    expect(computeLockoutSeconds(6)).toBe(60);
    expect(computeLockoutSeconds(7)).toBe(120);
  });
});

describe('WebCryptoEncryptionProvider (E2EE)', () => {
  const provider = new WebCryptoEncryptionProvider();

  it('encrypts and decrypts messages across sender and recipient devices', async () => {
    const alice = await provider.generateDeviceIdentity();
    const bob = await provider.generateDeviceIdentity();
    const eve = await provider.generateDeviceIdentity();

    const convId = '11111111-1111-1111-1111-111111111111';
    const msgId = '22222222-2222-2222-2222-222222222222';
    const aliceDevId = 'aaaa1111-1111-1111-1111-111111111111';
    const bobDevId = 'bbbb2222-2222-2222-2222-222222222222';
    const eveDevId = 'eeee3333-3333-3333-3333-333333333333';

    const payload = await provider.encryptMessage({
      plaintext: 'Meet at 18:00 — confidential',
      conversationId: convId,
      clientMessageId: msgId,
      senderDeviceId: aliceDevId,
      senderPrivateKey: alice.identityPrivateKey,
      recipientDevices: [
        { deviceId: aliceDevId, identityPublicKey: alice.identityPublicKey },
        { deviceId: bobDevId, identityPublicKey: bob.identityPublicKey },
      ],
    });

    expect(payload.ciphertext).not.toContain('Meet at 18:00');

    const bobPlain = await provider.decryptMessage({
      payload,
      conversationId: convId,
      clientMessageId: msgId,
      recipientDeviceId: bobDevId,
      recipientPrivateKey: bob.identityPrivateKey,
      senderPublicKey: alice.identityPublicKey,
    });
    expect(bobPlain).toBe('Meet at 18:00 — confidential');

    await expect(
      provider.decryptMessage({
        payload,
        conversationId: convId,
        clientMessageId: msgId,
        recipientDeviceId: eveDevId,
        recipientPrivateKey: eve.identityPrivateKey,
        senderPublicKey: alice.identityPublicKey,
      }),
    ).rejects.toThrow();
  });

  it('encrypts and decrypts binary attachments', async () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5, 99, 255]);
    const enc = await provider.encryptAttachment(raw);
    expect(enc.encryptedBytes).not.toEqual(raw);

    const dec = await provider.decryptAttachment(
      enc.encryptedBytes,
      enc.fileKeyBase64,
      enc.ivBase64,
    );
    expect(dec).toEqual(raw);
  });

  it('signs and verifies device identity data', async () => {
    const id = await provider.generateDeviceIdentity();
    const sig = await provider.signData(id.signingPrivateKey, 'prekey-payload');
    expect(await provider.verifySignature(id.signingPublicKey, 'prekey-payload', sig)).toBe(true);
    expect(await provider.verifySignature(id.signingPublicKey, 'tampered', sig)).toBe(false);
  });
});
