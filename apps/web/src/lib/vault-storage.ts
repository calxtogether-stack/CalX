/**
 * Browser-compatible Vault Credential & Key Storage.
 * - PINs are NEVER stored in plaintext; only PBKDF2-SHA256 hash + salt are persisted.
 * - Device private keys are encrypted with an AES-256-GCM key derived from the PIN
 *   (via PBKDF2) and stored in IndexedDB — never in plaintext localStorage.
 * - Supports optional WebAuthn platform passkey verification where available,
 *   without claiming native OS biometric guarantees.
 */

import {
  computeLockoutSeconds,
  derivePinHash,
  fromBase64,
  toBase64,
  utf8ToBytes,
  bytesToUtf8,
  verifyPinHash,
  type PinHashRecord,
} from '@calx/crypto';
import type { LocalDeviceCredentials } from '@calx/messaging';

const DB_NAME = 'calx_vault_store';
const STORE_NAME = 'kv';
const PIN_RECORD_KEY = 'pin_record';
const ENCRYPTED_CREDS_KEY = 'encrypted_device_creds';
const LOCKOUT_KEY = 'pin_lockout_state';
const WEBAUTHN_CRED_KEY = 'webauthn_cred_id';

interface LockoutState {
  failedAttempts: number;
  lockedUntilMs: number;
}

interface EncryptedCredsBlob {
  salt: string;
  iv: string;
  ciphertext: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deriveWrapKeyFromPin(pin: string, saltB64: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    utf8ToBytes(pin) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(saltB64) as BufferSource,
      iterations: 310_000,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function hasConfiguredPin(): Promise<boolean> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return false;
  const record = await idbGet<PinHashRecord>(PIN_RECORD_KEY);
  return record !== null;
}

export async function setupVaultPin(pin: string): Promise<void> {
  const record = await derivePinHash(pin);
  await idbSet(PIN_RECORD_KEY, record);
  await idbSet<LockoutState>(LOCKOUT_KEY, { failedAttempts: 0, lockedUntilMs: 0 });
}

export async function getPinLockoutRemainingSeconds(): Promise<number> {
  const state = await idbGet<LockoutState>(LOCKOUT_KEY);
  if (!state || state.lockedUntilMs <= Date.now()) return 0;
  return Math.ceil((state.lockedUntilMs - Date.now()) / 1000);
}

export async function verifyVaultPin(
  pin: string,
): Promise<{ ok: boolean; lockoutSeconds: number }> {
  const remaining = await getPinLockoutRemainingSeconds();
  if (remaining > 0) {
    return { ok: false, lockoutSeconds: remaining };
  }

  const record = await idbGet<PinHashRecord>(PIN_RECORD_KEY);
  if (!record) {
    return { ok: false, lockoutSeconds: 0 };
  }

  const valid = await verifyPinHash(pin, record);
  if (valid) {
    await idbSet<LockoutState>(LOCKOUT_KEY, { failedAttempts: 0, lockedUntilMs: 0 });
    return { ok: true, lockoutSeconds: 0 };
  }

  const prev = (await idbGet<LockoutState>(LOCKOUT_KEY)) ?? {
    failedAttempts: 0,
    lockedUntilMs: 0,
  };
  const failedAttempts = prev.failedAttempts + 1;
  const lockoutSec = computeLockoutSeconds(failedAttempts);
  await idbSet<LockoutState>(LOCKOUT_KEY, {
    failedAttempts,
    lockedUntilMs: lockoutSec > 0 ? Date.now() + lockoutSec * 1000 : 0,
  });

  return { ok: false, lockoutSeconds: lockoutSec };
}

export async function changeVaultPin(currentPin: string, newPin: string): Promise<boolean> {
  const check = await verifyVaultPin(currentPin);
  if (!check.ok) return false;

  const existingCreds = await loadEncryptedDeviceCredentials(currentPin);
  await setupVaultPin(newPin);
  if (existingCreds) {
    await saveEncryptedDeviceCredentials(existingCreds, newPin);
  }
  return true;
}

export async function saveEncryptedDeviceCredentials(
  creds: LocalDeviceCredentials,
  pin: string,
): Promise<void> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = toBase64(saltBytes);
  const key = await deriveWrapKeyFromPin(pin, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    utf8ToBytes(JSON.stringify(creds)) as BufferSource,
  );
  await idbSet<EncryptedCredsBlob>(ENCRYPTED_CREDS_KEY, {
    salt,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  });
}

export async function loadEncryptedDeviceCredentials(
  pin: string,
): Promise<LocalDeviceCredentials | null> {
  const blob = await idbGet<EncryptedCredsBlob>(ENCRYPTED_CREDS_KEY);
  if (!blob) return null;
  const key = await deriveWrapKeyFromPin(pin, blob.salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(blob.iv) as BufferSource },
    key,
    fromBase64(blob.ciphertext) as BufferSource,
  );
  return JSON.parse(bytesToUtf8(new Uint8Array(plainBuf))) as LocalDeviceCredentials;
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    window.isSecureContext
  );
}

export async function registerWebAuthnPasskey(username: string): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'CalX' },
      user: {
        id: userId,
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;

  if (!cred) return false;
  await idbSet(WEBAUTHN_CRED_KEY, toBase64(new Uint8Array(cred.rawId)));
  return true;
}

export async function verifyWebAuthnPasskey(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  const credIdB64 = await idbGet<string>(WEBAUTHN_CRED_KEY);
  if (!credIdB64) return false;

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: fromBase64(credIdB64) as BufferSource,
          type: 'public-key',
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return Boolean(assertion);
}
