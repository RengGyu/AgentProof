# AgentProof mobile source

The React screen is bundled locally for Capacitor. Native HTTP calls the existing AgentProof server for GitHub sign-in and tenant-authorized repository/report reads. The mobile bearer stays in process memory only: restarting the app requires a new sign-in. The copied summary is user-triggered; report data is not saved for offline use.

Set `VITE_AGENTPROOF_API_URL` to the production HTTPS origin before `pnpm build`, then run `pnpm exec cap sync ios` and `pnpm exec cap sync android`. Native iOS and Android projects include the `agentproof://auth/callback` handler. iOS debug build for the connected device and Android debug APK build have passed locally; automatic GitHub return still needs device verification on each platform. The server needs a registered HTTPS GitHub App callback for `/api/mobile/auth/callback` and both mobile migrations applied. Native bridge logging is disabled because its debug output can include authentication responses.

## Submission status (2026-09-30)

Not ready for store submission. Successful local builds do not establish account deletion, review access, or store approval. iPhone sign-in was reported working by the user; Android device verification remains pending.

Android targets and compiles against API 36, using Android Gradle Plugin 8.9.1 with the existing Gradle 8.11.1 wrapper. This meets the current [Google Play target API requirement](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-gb) and the [minimum supported Android build tools](https://developer.android.com/build/releases/about-agp). Recheck requirements when submitting.

### Blocking product and public information

- Account deletion is not implemented end to end. Preserve the agreed direction: delete a personal workspace; transfer ownership before leaving a shared workspace. `src/lib/tenant-deletion-execution.ts` still requires account/member and billing review, and `src/lib/tenant-retention-policy.ts` is a draft with unresolved billing and backup handling. Member suspension or purging reports is not account deletion. Decide the retained categories, operational completion/confirmation process, and shared-workspace account handling before exposing a deletion action.
- [Apple allows deletion processing to take time](https://developer.apple.com/support/offering-account-deletion-in-your-app/), but the app must provide an actual initiation path and communicate the processing time and completion. A support-email-only flow is insufficient for this app. [Google also requires an external deletion-request web resource](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). Neither a completed deletion flow nor this public URL has been verified.
- User-approved public support/deletion contact: `wjdrb3434@gmail.com`. This is contact information, not proof that a request is durably accepted or fulfilled. Do not label sending an email as completed account deletion.
- Supply an approved, published privacy policy URL and add access to it within the app. Its collection, third-party processing, retention, and deletion statements must match the actual service. Do not generate unapproved legal claims or fabricate a URL.
- Review access is unresolved: this mobile app has GitHub login only, with no complete demo mode. An arbitrary reviewer GitHub account may have no connected repositories or reports. Supply an authorized reusable review account with safe sample data and workable authentication instructions, or separately authorize a complete demo mode. Do not assume permission to share personal GitHub credentials or bypass authorization.

### Remaining release verification

Rebuild the web bundle with the real HTTPS API origin, then sync both native projects before any distribution build. A bundle compiled with a validation-only origin is not a release artifact.

- Verify Android sign-in/return, network failures, report reads, and logout on a real device; recheck iPhone on the final synced build.
- Produce the iOS distribution-signed archive and the Android upload-signed AAB using the user's store accounts and signing setup. An unsigned native build does not verify provisioning, upload signing, or store acceptance.
- Confirm current Apple SDK requirements, privacy manifests/labels and Google Data safety answers against the final binary and backend. Complete actual screenshots, icon/branding review, age/content declarations, support and deletion URLs, review access, and any required Play closed testing.
- Resolve the Apple third-party-login exception or equivalent-login requirement for GitHub-dependent functionality before submission. No exception or approval is assumed.

No store submission, deployment signing, or Android device verification is claimed by this document.

### Local verification on 2026-09-30

- Mobile auth-flow tests: 5 passed; mobile TypeScript check passed.
- Vite bundle compilation passed using `https://example.invalid` as a validation-only API origin. The generated `dist/` is not for syncing or distribution; rebuild with the actual origin first.
- Android `:app:bundleRelease` passed with API 36 / AGP 8.9.1; the generated AAB is unsigned.
- Xcode Release build for generic iOS passed with `CODE_SIGNING_ALLOWED=NO`. Existing packaged web assets were used for the native compilation checks; no new web bundle was synced.
- Existing Vite plugin deprecation, Gradle flat-directory, and Xcode dependency warnings remain. They were not expanded into dependency refactoring.
