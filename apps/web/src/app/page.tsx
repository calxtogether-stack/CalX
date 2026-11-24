'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { LocalDeviceCredentials } from '@calx/messaging';
import { CalculatorView } from '@/components/CalculatorView';
import { MessengerShell } from '@/components/MessengerShell';
import { VaultAuthModal } from '@/components/VaultAuthModal';
import { getWebSupabaseClient } from '@/lib/supabase';
import {
  hasConfiguredPin,
  loadEncryptedDeviceCredentials,
  verifyVaultPin,
} from '@/lib/vault-storage';

export default function HomePage() {
  const [hasPin, setHasPin] = useState(false);
  const [modalMode, setModalMode] = useState<'setup' | 'auth' | 'lockout' | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [verifiedPin, setVerifiedPin] = useState('');

  const [session, setSession] = useState<{
    userId: string;
    credentials: LocalDeviceCredentials;
  } | null>(null);

  useEffect(() => {
    void hasConfiguredPin().then(setHasPin);
  }, []);

  const handlePinAttempt = useCallback(async (digits: string): Promise<boolean> => {
    const result = await verifyVaultPin(digits);
    if (!result.ok) {
      if (result.lockoutSeconds > 0) {
        setLockoutSeconds(result.lockoutSeconds);
        setModalMode('lockout');
      }
      return false;
    }

    setVerifiedPin(digits);
    const supabase = getWebSupabaseClient();
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const storedCreds = await loadEncryptedDeviceCredentials(digits).catch(() => null);
      if (data.session?.user && storedCreds) {
        setSession({ userId: data.session.user.id, credentials: storedCreds });
        return true;
      }
    }

    setModalMode('auth');
    return true;
  }, []);

  const handleLockVault = useCallback(() => {
    setSession(null);
    setVerifiedPin('');
    setModalMode(null);
  }, []);

  if (session) {
    const supabase = getWebSupabaseClient();
    if (supabase) {
      return (
        <MessengerShell
          supabase={supabase}
          userId={session.userId}
          credentials={session.credentials}
          onLockVault={handleLockVault}
        />
      );
    }
  }

  return (
    <>
      <CalculatorView
        hasPinConfigured={hasPin}
        onPinAttempt={handlePinAttempt}
        onOpenSetup={() => setModalMode('setup')}
      />
      {modalMode && (
        <VaultAuthModal
          mode={modalMode}
          lockoutSeconds={lockoutSeconds}
          activePin={verifiedPin}
          onClose={() => setModalMode(null)}
          onAuthenticated={({ userId, credentials }) => {
            setHasPin(true);
            setModalMode(null);
            setSession({ userId, credentials });
          }}
        />
      )}
    </>
  );
}
