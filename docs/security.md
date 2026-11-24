# Security & Cryptography

## Threat Model & Guarantees

- **Zero Plaintext Storage**: `public.messages` has no plaintext column; only `encrypted_payload` JSONB is stored.
- **Per-Message E2EE**: Each message is encrypted with a fresh 256-bit AES-GCM key and 96-bit random IV, authenticated with AAD (`conversationId:senderDeviceId:clientMessageId`). The message key is wrapped per active recipient device using ECDH P-256 + HKDF-SHA256.
- **Replaceable Provider**: `EncryptionProvider` in `@calx/crypto` isolates the protocol so a future Double Ratchet (Signal) or MLS implementation can replace `WebCryptoEncryptionProvider` without changing UI or database code.
- **Current Protocol Scope**: Pairwise ECDH P-256 + per-message AES-256-GCM provides confidentiality, integrity, and device-level authenticity. It does not yet implement per-message symmetric ratcheting (forward secrecy across compromised long-term device keys); `key_bundles` is provisioned in the schema for that future upgrade.
- **PIN & Key Storage**:
  - PINs are never stored in plaintext (PBKDF2-SHA256, 310,000 iterations, 16-byte random salt).
  - Exponential lockout backoff activates after 5 failed attempts.
  - Mobile private keys are stored in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
  - Web private keys are encrypted with a PIN-derived AES-256-GCM key and stored in IndexedDB (never plaintext `localStorage`).
- **Privacy-Preserving Notifications**: `supabase/functions/push-notify` sends generic `"New activity available"` payloads with zero message text or sender identity.
