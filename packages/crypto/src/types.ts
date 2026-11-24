import type { EncryptedPayload } from '@calx/shared';

export interface DeviceIdentityBundle {
  /** Base64 SPKI ECDH P-256 public key */
  identityPublicKey: string;
  /** Base64 PKCS8 ECDH P-256 private key (store ONLY in SecureStore / wrapped local store) */
  identityPrivateKey: string;
  /** Base64 SPKI ECDSA P-256 public key */
  signingPublicKey: string;
  /** Base64 PKCS8 ECDSA P-256 private key (store ONLY in SecureStore / wrapped local store) */
  signingPrivateKey: string;
  algorithm: string;
}

export interface RecipientDeviceKey {
  deviceId: string;
  identityPublicKey: string;
}

export interface EncryptMessageInput {
  plaintext: string;
  conversationId: string;
  clientMessageId: string;
  senderDeviceId: string;
  senderPrivateKey: string;
  recipientDevices: RecipientDeviceKey[];
}

export interface DecryptMessageInput {
  payload: EncryptedPayload;
  conversationId: string;
  clientMessageId: string;
  recipientDeviceId: string;
  recipientPrivateKey: string;
  senderPublicKey: string;
}

export interface EncryptedAttachmentResult {
  encryptedBytes: Uint8Array;
  fileKeyBase64: string;
  ivBase64: string;
}

/**
 * Replaceable End-to-End Encryption Provider interface.
 * Allows swapping the underlying cryptographic protocol (e.g., WebCrypto ECDH+AES-GCM
 * vs. Signal Double Ratchet / MLS) without modifying messaging or UI layers.
 */
export interface EncryptionProvider {
  readonly algorithmName: string;
  generateDeviceIdentity(): Promise<DeviceIdentityBundle>;
  signData(signingPrivateKey: string, data: string): Promise<string>;
  verifySignature(signingPublicKey: string, data: string, signatureB64: string): Promise<boolean>;
  encryptMessage(input: EncryptMessageInput): Promise<EncryptedPayload>;
  decryptMessage(input: DecryptMessageInput): Promise<string>;
  encryptAttachment(plainBytes: Uint8Array): Promise<EncryptedAttachmentResult>;
  decryptAttachment(
    encryptedBytes: Uint8Array,
    fileKeyBase64: string,
    ivBase64: string,
  ): Promise<Uint8Array>;
}
