import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  computeLockoutSeconds,
  derivePinHash,
  verifyPinHash,
  type PinHashRecord,
} from '@calx/crypto';
import type { LocalDeviceCredentials } from '@calx/messaging';

const PIN_KEY = 'calx_pin_record';
const CREDS_KEY = 'calx_device_creds';
const LOCKOUT_KEY = 'calx_pin_lockout';

interface LockoutState {
  failedAttempts: number;
  lockedUntilMs: number;
}

export async function hasMobilePin(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(PIN_KEY);
  return raw !== null;
}

export async function setupMobilePin(pin: string): Promise<void> {
  const record = await derivePinHash(pin);
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(record), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(
    LOCKOUT_KEY,
    JSON.stringify({ failedAttempts: 0, lockedUntilMs: 0 }),
  );
}

export async function verifyMobilePin(
  pin: string,
): Promise<{ ok: boolean; lockoutSeconds: number }> {
  const lockRaw = await SecureStore.getItemAsync(LOCKOUT_KEY);
  const lockState: LockoutState = lockRaw
    ? (JSON.parse(lockRaw) as LockoutState)
    : { failedAttempts: 0, lockedUntilMs: 0 };

  if (lockState.lockedUntilMs > Date.now()) {
    return {
      ok: false,
      lockoutSeconds: Math.ceil((lockState.lockedUntilMs - Date.now()) / 1000),
    };
  }

  const raw = await SecureStore.getItemAsync(PIN_KEY);
  if (!raw) return { ok: false, lockoutSeconds: 0 };

  const record = JSON.parse(raw) as PinHashRecord;
  const ok = await verifyPinHash(pin, record);
  if (ok) {
    await SecureStore.setItemAsync(
      LOCKOUT_KEY,
      JSON.stringify({ failedAttempts: 0, lockedUntilMs: 0 }),
    );
    return { ok: true, lockoutSeconds: 0 };
  }

  const failedAttempts = lockState.failedAttempts + 1;
  const lockoutSeconds = computeLockoutSeconds(failedAttempts);
  await SecureStore.setItemAsync(
    LOCKOUT_KEY,
    JSON.stringify({
      failedAttempts,
      lockedUntilMs: lockoutSeconds > 0 ? Date.now() + lockoutSeconds * 1000 : 0,
    }),
  );
  return { ok: false, lockoutSeconds };
}

export async function saveMobileDeviceCredentials(creds: LocalDeviceCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDS_KEY, JSON.stringify(creds), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadMobileDeviceCredentials(): Promise<LocalDeviceCredentials | null> {
  const raw = await SecureStore.getItemAsync(CREDS_KEY);
  return raw ? (JSON.parse(raw) as LocalDeviceCredentials) : null;
}

export async function authenticateWithBiometrics(): Promise<{
  available: boolean;
  authenticated: boolean;
}> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !isEnrolled) {
    return { available: false, authenticated: false };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock CalX Vault',
    fallbackLabel: 'Use PIN',
    disableDeviceFallback: false,
  });
  return { available: true, authenticated: result.success };
}
