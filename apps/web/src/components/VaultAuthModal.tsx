'use client';

import React, { useState } from 'react';
import { loginSchema, pinSetupSchema, registerSchema } from '@calx/validation';
import { MessagingService, type LocalDeviceCredentials } from '@calx/messaging';
import { getSupabaseConfigStatus, getWebSupabaseClient } from '@/lib/supabase';
import {
  isWebAuthnSupported,
  loadEncryptedDeviceCredentials,
  registerWebAuthnPasskey,
  saveEncryptedDeviceCredentials,
  setupVaultPin,
  verifyWebAuthnPasskey,
} from '@/lib/vault-storage';
import { Lock, ShieldCheck, X } from 'lucide-react';

interface VaultAuthModalProps {
  mode: 'setup' | 'auth' | 'lockout';
  lockoutSeconds?: number;
  activePin?: string;
  onClose: () => void;
  onAuthenticated: (params: {
    userId: string;
    pin: string;
    credentials: LocalDeviceCredentials;
  }) => void;
}

export function VaultAuthModal({
  mode,
  lockoutSeconds = 0,
  activePin,
  onClose,
  onAuthenticated,
}: VaultAuthModalProps) {
  const [step, setStep] = useState<'pin' | 'account'>(mode === 'setup' ? 'pin' : 'account');
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [verifiedPin, setVerifiedPin] = useState(activePin ?? '');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [enablePasskey, setEnablePasskey] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { configured } = getSupabaseConfigStatus();
  const webAuthnAvailable = isWebAuthnSupported();

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = pinSetupSchema.safeParse({ pin, confirmPin });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Invalid PIN');
      return;
    }
    setLoading(true);
    try {
      await setupVaultPin(parsed.data.pin);
      setVerifiedPin(parsed.data.pin);
      setStep('account');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const supabase = getWebSupabaseClient();
    if (!supabase) {
      setError(
        'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.',
      );
      return;
    }

    setLoading(true);
    try {
      let userId = '';

      if (authTab === 'register') {
        const parsed = registerSchema.safeParse({ email, password, username, displayName });
        if (!parsed.success) {
          setError(parsed.error.errors[0]?.message ?? 'Invalid registration details');
          setLoading(false);
          return;
        }
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            data: {
              username: parsed.data.username,
              display_name: parsed.data.displayName,
            },
          },
        });
        if (signUpErr) throw signUpErr;
        if (!data.user) {
          throw new Error('Registration failed. Please try again.');
        }
        if (!data.session) {
          throw new Error(
            'Account created! Please check your email to confirm your address (or disable "Confirm email" in Supabase Auth), then sign in.',
          );
        }
        userId = data.user.id;

        const { error: profErr } = await supabase.from('profiles').upsert({
          id: userId,
          username: parsed.data.username,
          display_name: parsed.data.displayName,
        });
        if (profErr) throw profErr;

        const { error: settErr } = await supabase
          .from('user_settings')
          .upsert({ user_id: userId });
        if (settErr) throw settErr;
      } else {
        const parsed = loginSchema.safeParse({ email, password });
        if (!parsed.success) {
          setError(parsed.error.errors[0]?.message ?? 'Invalid credentials');
          setLoading(false);
          return;
        }
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (signInErr) throw signInErr;
        userId = data.user.id;

        // Ensure profile exists if user registered before confirming email
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', userId)
          .maybeSingle();
        if (!existingProfile) {
          const meta = (data.user.user_metadata ?? {}) as Record<string, string>;
          const fallbackUsername = (meta.username || email.split('@')[0] || 'user')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .slice(0, 24);
          const { error: profErr } = await supabase.from('profiles').upsert({
            id: userId,
            username: `${fallbackUsername}_${userId.slice(0, 4)}`,
            display_name: meta.display_name || fallbackUsername,
          });
          if (profErr) throw profErr;
          await supabase.from('user_settings').upsert({ user_id: userId });
        }
      }

      const pinToUse = verifiedPin || activePin || '';
      const existingCreds = pinToUse
        ? await loadEncryptedDeviceCredentials(pinToUse).catch(() => null)
        : null;

      let creds: LocalDeviceCredentials;
      if (existingCreds) {
        const { data: existingDev } = await supabase
          .from('devices')
          .select('id, is_active')
          .eq('id', existingCreds.deviceId)
          .eq('user_id', userId)
          .maybeSingle();
        if (existingDev?.is_active) {
          creds = existingCreds;
        } else {
          const svc = new MessagingService(supabase);
          const { device, bundle } = await svc.registerDevice(
            userId,
            `Web (${navigator.platform || 'Browser'})`,
            'web',
          );
          creds = {
            deviceId: device.id,
            identityPrivateKey: bundle.identityPrivateKey,
            signingPrivateKey: bundle.signingPrivateKey,
          };
          if (pinToUse) await saveEncryptedDeviceCredentials(creds, pinToUse);
        }
      } else {
        const svc = new MessagingService(supabase);
        const { device, bundle } = await svc.registerDevice(
          userId,
          `Web (${navigator.platform || 'Browser'})`,
          'web',
        );
        creds = {
          deviceId: device.id,
          identityPrivateKey: bundle.identityPrivateKey,
          signingPrivateKey: bundle.signingPrivateKey,
        };
        if (pinToUse) await saveEncryptedDeviceCredentials(creds, pinToUse);
      }

      if (enablePasskey && webAuthnAvailable) {
        await registerWebAuthnPasskey(email);
      }

      onAuthenticated({ userId, pin: pinToUse, credentials: creds });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Authentication failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'lockout') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="h-4 w-4" />
              <span>Temporarily Locked</span>
            </div>
            <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            Too many failed attempts. Please wait {lockoutSeconds} seconds before trying again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 shadow-lg">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--text-primary)]" />
            <h2 className="text-base font-semibold tracking-tight">
              {step === 'pin' ? 'Configure Vault PIN' : 'Sign In to CalX'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!configured && (
          <div className="mb-4 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
            Supabase environment variables are not configured yet. Configure{' '}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable cloud sync.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {step === 'pin' ? (
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
              Choose a 4–8 digit PIN. Typing this PIN into the calculator and pressing{' '}
              <span className="font-mono font-medium">=</span> opens your private vault. Your PIN is
              hashed locally with PBKDF2-SHA256 and never stored in plaintext.
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Secret PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="4–8 digits"
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3.5 py-2.5 font-mono text-sm tracking-widest outline-none focus:border-[var(--border-strong)]"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Confirm PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Re-enter PIN"
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3.5 py-2.5 font-mono text-sm tracking-widest outline-none focus:border-[var(--border-strong)]"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[var(--accent)] py-2.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Securing...' : 'Continue'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--bg-secondary)] p-1">
              <button
                type="button"
                onClick={() => setAuthTab('login')}
                className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  authTab === 'login'
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setAuthTab('register')}
                className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  authTab === 'register'
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                Create Account
              </button>
            </div>

            <form onSubmit={handleAccountSubmit} className="space-y-3">
              {authTab === 'register' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="alex_99"
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--border-strong)]"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Alex"
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--border-strong)]"
                      required
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--border-strong)]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Account Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 10 characters"
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-[var(--border-strong)]"
                  required
                />
              </div>

              {webAuthnAvailable && (
                <label className="flex items-center gap-2 pt-1 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={enablePasskey}
                    onChange={(e) => setEnablePasskey(e.target.checked)}
                    className="rounded border-[var(--border-strong)]"
                  />
                  <span>Enroll browser passkey (WebAuthn) for quick unlock</span>
                </label>
              )}

              <button
                type="submit"
                disabled={loading || !configured}
                className="mt-2 w-full rounded-xl bg-[var(--accent)] py-2.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {loading
                  ? 'Authenticating...'
                  : authTab === 'register'
                    ? 'Register & Generate Device Keys'
                    : 'Sign In & Sync Keys'}
              </button>

              {webAuthnAvailable && (
                <button
                  type="button"
                  onClick={() => void verifyWebAuthnPasskey()}
                  className="w-full rounded-xl border border-[var(--border-subtle)] py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                  Verify Existing Browser Passkey
                </button>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
