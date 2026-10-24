# 18. App Store & Google Play Compliance

Checked against official sources on **2026-10-23**. Re-check before every store submission — both stores change rules several times a year.
Confidence: **C** = confirmed on an official page, **P** = official docs, not re-verified, **U** = interpretation.

## What the code already does

| Requirement | Where it's handled |
|---|---|
| Play: target API 36 (Android 16) for new apps/updates since 31 Aug 2026 (**C**) | Expo SDK 57 defaults + `expo-build-properties` pins `compileSdkVersion`/`targetSdkVersion` 36 in `frontend/app.json` |
| Play: 16 KB memory page size for native libs (updates blocked from 1 Feb 2027) (**C**) | RN 0.86 / SDK 57 toolchain; `frontend/android-build.sh` runs `zipalign -c -P 16` on every build |
| Android 16: no orientation lock on ≥600dp screens, edge-to-edge, predictive back (**C**) | `orientation: "default"`, responsive layouts (sidebar ≥768dp), safe-area insets everywhere, `predictiveBackGestureEnabled: true` |
| Account deletion in-app **and** via the web (Play + App Store 5.1.1(v)) (**C**) | `POST /api/v1/auth/delete-account`; Settings → Account → Delete account; public page `/delete-account` |
| Privacy policy linked in app and store listing (**C/P**) | `/privacy` route (web + app), linked from sign-in, sign-up and Settings |
| Bluetooth permissions: `BLUETOOTH_SCAN` with `neverForLocation`, `BLUETOOTH_CONNECT`, no `BLUETOOTH_ADVERTISE` (**C**) | `react-native-ble-plx` config plugin (`neverForLocation: true`), `android.permissions`, `blockedPermissions` |
| Photo picker instead of `READ_MEDIA_IMAGES/VIDEO` (enforced since May 2025) (**C**) | `expo-image-picker` (system picker); READ_MEDIA_* and storage permissions in `blockedPermissions` |
| Camera without microphone | `expo-camera` plugin `recordAudioAndroid: false`, `microphonePermission: false` |
| iOS purpose strings (5.1.1(ii)) | `NSBluetoothAlwaysUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSLocalNetworkUsageDescription` |
| iOS privacy manifest + required-reason APIs (**C/P**) | `ios.privacyManifests` (UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1, DiskSpace E174.1; tracking false) + `privacyManifestAggregationEnabled` |
| Export compliance (HTTPS only) | `usesNonExemptEncryption: false` / `ITSAppUsesNonExemptEncryption: false` |
| ATS: HTTPS for internet servers, plain HTTP only on the shop LAN | `NSAllowsLocalNetworking: true` (no `NSAllowsArbitraryLoads`) |
| Sign in with Apple (4.8) | Not required — no third-party login is offered (**C**) |
| Bluetooth Classic on iOS | Not possible without MFi; iOS uses BLE printers or AirPrint (**P**) |

## Things only you can do (store consoles)

**Google Play** ($25 one-time, ID + card in your legal name)
- New *personal* developer accounts must run a **closed test with ≥12 testers for 14 continuous days** before production access (**C**). Organization accounts (D-U-N-S) are exempt.
- Upload the **AAB** (`dist/tallyko-<version>.aab`); Play App Signing is mandatory (**P**).
- Data safety form (**U**, our reading): Personal info — name, email, phone (owner, staff, shop customers); Photos (menu photos, processed on your own server, not shared); Purchase history (sales records). Purposes: app functionality, account management. Encrypted in transit: yes. Users can request deletion: yes (give the `/delete-account` URL).
- Financial features declaration: every app must answer it; Tallyko has no in-app payments (UPI QR is printed only), so "no financial features" (**U**).
- App access: give reviewers a demo owner login.

**Apple App Store** ($99/year)
- Build with **Xcode 26 / iOS 26 SDK** (required since 28 Apr 2026) (**C**). Expect the iOS 27 SDK + UIKit scene lifecycle requirement around April 2027 — SDK 57 can opt in with `expo-build-properties` → `ios.enableSceneSupport`.
- App Privacy label: Contact info (name, email, phone), User content (photos), Identifiers (user id), Purchases — linked to the user, not used for tracking (**U**).
- Answer the new age-rating questionnaire (required since 31 Jan 2026) (**C**).
- EU storefronts need a declared DSA trader status, or untick EU (**C**).
- Paid SaaS plans later: Apple may require In-App Purchase (3.1.1). Safest path: sell subscriptions on the web only, show no prices/upgrade buttons in the iOS app, present it as a business tool for existing accounts (**U** — expect review questions).

## Sharing with friends without the stores

- **Android:** `docker compose --profile android run --rm android-build` → `dist/tallyko-<version>.apk`. Friends enable "Install unknown apps" and open it.
  - Google's **developer verification** for sideloaded apps starts in Brazil/Indonesia/Singapore/Thailand from 30 Sep 2026 and reaches India **from 2027**; after that, register the package name + signing key in Play Console (or use a free Limited Distribution account, ≤20 devices) (**C**).
  - An APK signed with your own key cannot update a Play-installed copy (and vice versa). Use one channel per phone.
- **iPhone:** there is no free way to install a native app on someone else's iPhone long-term (free Xcode signing lasts 7 days on 3 devices). Options: TestFlight (needs the $99 account; up to 10,000 testers, builds expire after 90 days) — or simply use the **web app**: open the server URL in Safari → Share → *Add to Home Screen*. iOS 26 opens home-screen sites as web apps by default. Everything except Bluetooth printing works (use AirPrint / a network printer, or print from an Android device).

## Web / PWA

- Web Bluetooth works in Chrome/Edge (desktop + Android), BLE printers only, over HTTPS; not available in any iOS browser.
- The customer ordering pages (`/store/<business>`) are web-only; they link the privacy policy and only ask for name + phone needed to fulfil the order. India's DPDP Act applies to the shop as data fiduciary.
