# CalX — Calculator Vault Private Messaging Ecosystem

A minimalist, monochromatic precision calculator that conceals an end-to-end encrypted private messaging platform across **Android**, **iOS PWA**, and **Web**.

## Highlights

- **Natural Calculator Interface**: Full arithmetic, operator precedence, IEEE-754 precision handling, percentage, sign toggle, backspace, C/AC, and keyboard support.
- **Stealth Vault Access**: Entering your secret PIN + `=` unlocks the vault; mobile adds native fingerprint/face verification via `expo-local-authentication`.
- **End-to-End Encrypted Messaging**: Client-side ECDH P-256 + HKDF-SHA256 + AES-256-GCM encryption via `@calx/crypto`, with encrypted file & voice attachments.
- **Zero-Budget Architecture**: Built on Supabase Free, Vercel Hobby, and Expo free tooling.

## Quick Commands

```bash
corepack pnpm install     # Install all monorepo dependencies
corepack pnpm build       # Build all packages & web app
corepack pnpm typecheck   # Type-check all workspaces
corepack pnpm test        # Run Vitest unit & integration suites
corepack pnpm dev:web     # Start Next.js web & PWA on http://localhost:3000
corepack pnpm dev:mobile  # Start Expo mobile dev server
```

## Documentation

- [Architecture](docs/architecture.md)
- [Database Schema & RLS](docs/database.md)
- [Security & Cryptography](docs/security.md)
- [Local Setup](docs/setup.md)
- [Deployment & APK Build](docs/deployment.md)
