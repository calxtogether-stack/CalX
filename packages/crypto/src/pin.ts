import { MAX_FAILED_PIN_ATTEMPTS, PIN_LOCKOUT_BASE_SECONDS } from '@calx/shared';
import { fromBase64, toBase64, utf8ToBytes } from './encoding.js';

const PBKDF2_ITERATIONS = 310_000;

export interface PinHashRecord {
  salt: string;
  hash: string;
  iterations: number;
}

function getSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto SubtleCrypto is unavailable in this runtime');
  }
  return globalThis.crypto.subtle;
}

export async function derivePinHash(pin: string, existingSalt?: string): Promise<PinHashRecord> {
  const subtle = getSubtle();
  const saltBytes = existingSalt
    ? fromBase64(existingSalt)
    : globalThis.crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await subtle.importKey(
    'raw',
    utf8ToBytes(pin) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  return {
    salt: toBase64(saltBytes),
    hash: toBase64(new Uint8Array(bits)),
    iterations: PBKDF2_ITERATIONS,
  };
}

/**
 * Constant-time string comparison to avoid timing side-channels.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyPinHash(pin: string, record: PinHashRecord): Promise<boolean> {
  const derived = await derivePinHash(pin, record.salt);
  return constantTimeEqual(derived.hash, record.hash);
}

/**
 * Exponential backoff lockout in seconds after repeated failed PIN attempts.
 */
export function computeLockoutSeconds(failedAttempts: number): number {
  if (failedAttempts < MAX_FAILED_PIN_ATTEMPTS) return 0;
  const exponent = failedAttempts - MAX_FAILED_PIN_ATTEMPTS;
  return Math.min(PIN_LOCKOUT_BASE_SECONDS * Math.pow(2, exponent), 3600);
}
