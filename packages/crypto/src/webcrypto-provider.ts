import type { EncryptedPayload } from '@calx/shared';
import { bytesToUtf8, fromBase64, toBase64, utf8ToBytes } from './encoding.js';
import type {
  DecryptMessageInput,
  DeviceIdentityBundle,
  EncryptedAttachmentResult,
  EncryptionProvider,
  EncryptMessageInput,
} from './types.js';

const ALGORITHM_NAME = 'ECDH-P256-HKDF-AES256GCM';

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto API is not available in this environment');
  }
  return globalThis.crypto;
}

async function importEcdhPrivateKey(pkcs8B64: string): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    'pkcs8',
    fromBase64(pkcs8B64) as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

async function importEcdhPublicKey(spkiB64: string): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    'spki',
    fromBase64(spkiB64) as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

async function deriveSharedWrapKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  info: string,
): Promise<CryptoKey> {
  const subtle = getCrypto().subtle;
  const sharedBits = await subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  const hkdfBase = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32) as BufferSource,
      info: utf8ToBytes(info) as BufferSource,
    },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export class WebCryptoEncryptionProvider implements EncryptionProvider {
  readonly algorithmName = ALGORITHM_NAME;

  async generateDeviceIdentity(): Promise<DeviceIdentityBundle> {
    const subtle = getCrypto().subtle;

    const ecdhPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const ecdsaPair = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );

    const [idPub, idPriv, signPub, signPriv] = await Promise.all([
      subtle.exportKey('spki', ecdhPair.publicKey),
      subtle.exportKey('pkcs8', ecdhPair.privateKey),
      subtle.exportKey('spki', ecdsaPair.publicKey),
      subtle.exportKey('pkcs8', ecdsaPair.privateKey),
    ]);

    return {
      identityPublicKey: toBase64(new Uint8Array(idPub)),
      identityPrivateKey: toBase64(new Uint8Array(idPriv)),
      signingPublicKey: toBase64(new Uint8Array(signPub)),
      signingPrivateKey: toBase64(new Uint8Array(signPriv)),
      algorithm: ALGORITHM_NAME,
    };
  }

  async signData(signingPrivateKey: string, data: string): Promise<string> {
    const subtle = getCrypto().subtle;
    const key = await subtle.importKey(
      'pkcs8',
      fromBase64(signingPrivateKey) as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const sig = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      utf8ToBytes(data) as BufferSource,
    );
    return toBase64(new Uint8Array(sig));
  }

  async verifySignature(
    signingPublicKey: string,
    data: string,
    signatureB64: string,
  ): Promise<boolean> {
    const subtle = getCrypto().subtle;
    const key = await subtle.importKey(
      'spki',
      fromBase64(signingPublicKey) as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromBase64(signatureB64) as BufferSource,
      utf8ToBytes(data) as BufferSource,
    );
  }

  async encryptMessage(input: EncryptMessageInput): Promise<EncryptedPayload> {
    const cryptoObj = getCrypto();
    const subtle = cryptoObj.subtle;

    // 1. Generate per-message 256-bit AES-GCM key
    const msgKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const iv = cryptoObj.getRandomValues(new Uint8Array(12));
    const aad = utf8ToBytes(
      `${input.conversationId}:${input.senderDeviceId}:${input.clientMessageId}`,
    );

    const ciphertextBuf = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
      },
      msgKey,
      utf8ToBytes(input.plaintext) as BufferSource,
    );

    const rawMsgKey = new Uint8Array(await subtle.exportKey('raw', msgKey));
    const senderPriv = await importEcdhPrivateKey(input.senderPrivateKey);

    // 2. Wrap the message key individually for every recipient & sender device
    const wrappedKeys: Record<string, string> = {};
    const wrapInfo = `calx-msg-wrap:${input.conversationId}:${input.clientMessageId}`;

    for (const recipient of input.recipientDevices) {
      const recipientPub = await importEcdhPublicKey(recipient.identityPublicKey);
      const wrapKey = await deriveSharedWrapKey(senderPriv, recipientPub, wrapInfo);
      const wrapIv = cryptoObj.getRandomValues(new Uint8Array(12));
      const wrappedBuf = await subtle.encrypt(
        { name: 'AES-GCM', iv: wrapIv as BufferSource },
        wrapKey,
        rawMsgKey as BufferSource,
      );
      const combined = new Uint8Array(12 + wrappedBuf.byteLength);
      combined.set(wrapIv, 0);
      combined.set(new Uint8Array(wrappedBuf), 12);
      wrappedKeys[recipient.deviceId] = toBase64(combined);
    }

    return {
      ciphertext: toBase64(new Uint8Array(ciphertextBuf)),
      iv: toBase64(iv),
      sender_device_id: input.senderDeviceId,
      key_version: 1,
      algorithm: ALGORITHM_NAME,
      wrapped_keys: wrappedKeys,
    };
  }

  async decryptMessage(input: DecryptMessageInput): Promise<string> {
    const subtle = getCrypto().subtle;
    const wrappedB64 = input.payload.wrapped_keys?.[input.recipientDeviceId];
    if (!wrappedB64) {
      throw new Error('No wrapped key found for this device');
    }

    const combined = fromBase64(wrappedB64);
    const wrapIv = combined.subarray(0, 12);
    const wrappedCipher = combined.subarray(12);

    const recipientPriv = await importEcdhPrivateKey(input.recipientPrivateKey);
    const senderPub = await importEcdhPublicKey(input.senderPublicKey);
    const wrapInfo = `calx-msg-wrap:${input.conversationId}:${input.clientMessageId}`;
    const wrapKey = await deriveSharedWrapKey(recipientPriv, senderPub, wrapInfo);

    const rawMsgKey = await subtle.decrypt(
      { name: 'AES-GCM', iv: wrapIv as BufferSource },
      wrapKey,
      wrappedCipher as BufferSource,
    );

    const msgKey = await subtle.importKey(
      'raw',
      rawMsgKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );

    const aad = utf8ToBytes(
      `${input.conversationId}:${input.payload.sender_device_id}:${input.clientMessageId}`,
    );

    const plainBuf = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(input.payload.iv) as BufferSource,
        additionalData: aad as BufferSource,
      },
      msgKey,
      fromBase64(input.payload.ciphertext) as BufferSource,
    );

    return bytesToUtf8(new Uint8Array(plainBuf));
  }

  async encryptAttachment(plainBytes: Uint8Array): Promise<EncryptedAttachmentResult> {
    const cryptoObj = getCrypto();
    const subtle = cryptoObj.subtle;
    const fileKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const iv = cryptoObj.getRandomValues(new Uint8Array(12));
    const encryptedBuf = await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      fileKey,
      plainBytes as BufferSource,
    );
    const rawKey = new Uint8Array(await subtle.exportKey('raw', fileKey));
    return {
      encryptedBytes: new Uint8Array(encryptedBuf),
      fileKeyBase64: toBase64(rawKey),
      ivBase64: toBase64(iv),
    };
  }

  async decryptAttachment(
    encryptedBytes: Uint8Array,
    fileKeyBase64: string,
    ivBase64: string,
  ): Promise<Uint8Array> {
    const subtle = getCrypto().subtle;
    const key = await subtle.importKey(
      'raw',
      fromBase64(fileKeyBase64) as BufferSource,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivBase64) as BufferSource },
      key,
      encryptedBytes as BufferSource,
    );
    return new Uint8Array(plainBuf);
  }
}

export const defaultEncryptionProvider = new WebCryptoEncryptionProvider();
