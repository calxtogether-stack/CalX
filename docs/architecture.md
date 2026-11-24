# CalX Architecture

CalX is a cross-platform private messaging ecosystem disguised behind a fully functional, minimalist calculator interface.

## Monorepo Layout

- `apps/web` — Next.js 15 + React 19 + Tailwind CSS web messenger & installable iOS PWA.
- `apps/mobile` — Expo + React Native + Expo Router Android application with native SecureStore & LocalAuthentication.
- `packages/shared` — Platform-agnostic domain types, constants, and the precision calculator engine.
- `packages/validation` — Zod validation schemas shared between client apps and service layers.
- `packages/design-system` — Monochromatic minimalist design tokens (light/dark palettes, typography, spacing).
- `packages/crypto` — Replaceable `EncryptionProvider` interface + `WebCryptoEncryptionProvider` (ECDH P-256 + HKDF-SHA256 + AES-256-GCM) + PBKDF2-SHA256 PIN derivation.
- `packages/messaging` — Supabase client factory, `MessagingService`, Realtime channel subscriptions, encrypted attachment transfer, and `OfflineMessageQueue`.
- `supabase/` — PostgreSQL migrations, RLS policies, private storage bucket rules, seed script, and `push-notify` Edge Function.

## Data Flow

1. **Default State**: App launches directly into `CalculatorView`.
2. **Vault Unlock**: Entering the configured PIN + `=` (and optional biometrics on mobile) unlocks the local device private keys and mounts `MessengerShell`.
3. **Message Send**: Plaintext is encrypted client-side with a fresh per-message AES-256-GCM key, wrapped per active recipient device via ECDH + HKDF, and inserted into `public.messages`.
4. **Realtime Delivery**: Supabase Realtime broadcasts the encrypted row to conversation members, who unwrap the key and decrypt locally.
