# Deployment & Free-Tier Limits

## Web & iOS PWA (Vercel Hobby — Free)

1. Import the repository into Vercel with Root Directory set to `apps/web`.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel Project Environment Variables.
3. Deploy.
4. **iOS PWA Installation**:
   - Open the deployed URL in **Safari** on iOS.
   - Tap **Share** -> **Add to Home Screen**.
   - **Browser Limitations**: iOS PWAs use WebCrypto + IndexedDB + optional WebAuthn passkeys, which do not provide the same hardware-backed isolation as native iOS Keychain/Secure Enclave.

## Android APK (Direct Install — Zero Cost)

- **Via EAS Free Tier**:
  ```bash
  cd apps/mobile
  npx eas login
  npx eas build -p android --profile preview
  ```
  Download the `.apk` and install directly on Android (enable *Install unknown apps* if prompted).
- **Local Android Build** (requires Android SDK & JDK 17):
  ```bash
  cd apps/mobile
  npx expo prebuild --platform android
  cd android && ./gradlew assembleRelease
  ```
- **Android Permissions**: `USE_BIOMETRIC`, `USE_FINGERPRINT`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`.

## Supabase Free-Tier Limits

- 500 MB PostgreSQL database
- 1 GB File Storage (25 MB per-file cap enforced in CalX)
- 200 concurrent Realtime connections
- 50,000 monthly active users
