# DiffEvidence mobile source

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


## Native report/push package (2026-10-18, local only)

The local bundle reuses the current report renderer, logo/palette, saved-report locale and repository settings. Native PR generation uses `/api/mobile/dashboard-analyze` and the shared retained-analysis boundary; public URL analysis retains its existing `/api/mobile/analyze` route. Native foreground signals refresh reads without remounting the workspace or repeating an analysis. Bearers and provider registration tokens are not written to JS storage. Only a random installation ID is stored locally.

Remote notifications use official `@capacitor/push-notifications` 7.0.7: APNs on iOS and FCM HTTP v1 on Android. The device control explicitly requests OS permission only after a tap. Foreground notifications use the existing Inbox (no duplicate local notification); background messages contain only a generic DiffEvidence message and opaque report/event identifiers. Tapping opens the normal authenticated report GET; a cold launch still requires sign-in under the existing memory-only session contract. Terminal queue failures open the workspace's existing activity. There is no remote-content URL execution.

Before use (NOT performed by this package):

1. Review/apply `supabase/migrations/202610180001_mobile_push.sql` with the existing migration authority. It creates service-only encrypted device bindings and event/device delivery claims. It does not rewrite existing reports or change consent. The migration and 18 guards were executed against an in-memory PostgreSQL (PGlite) fixture schema; production Supabase and multi-connection contention were not tested. No production SQL was run.
2. Provision native push for the unchanged `app.agentproof.mobile` identifier. iOS needs the Push Notifications capability/provisioning and an APNs signing key. Debug entitlements use `development` and require APNs `sandbox`; Release uses `production`. Supply server-only `AGENTPROOF_APNS_PRIVATE_KEY` (multiline PEM), `AGENTPROOF_APNS_KEY_ID`, `AGENTPROOF_APNS_TEAM_ID`, `AGENTPROOF_APNS_ENVIRONMENT` (`sandbox` or `production`). No iOS Firebase configuration is required.
3. Android needs the owning Firebase project's `google-services.json` in `android/app/` for this same application ID (git-ignored). Enable FCM HTTP v1 in that project, with authorized server credentials in `AGENTPROOF_FCM_PROJECT_ID`, `AGENTPROOF_FCM_CLIENT_EMAIL`, `AGENTPROOF_FCM_PRIVATE_KEY` (multiline PEM). Never put a service-account key in the app. Existing control-plane DB configuration and `AGENTPROOF_PUBLIC_AUTH_SECRET` encrypt bindings server-side; do not rotate them just for setup.
4. Deploy the reviewed server/API code separately, rebuild/sync the app, then perform an explicitly authorized real-device check of permission, background/closed delivery, report tap and logout on both platforms. This package did not deploy, install or submit an app, change account permissions, or send a real notification.

Only an authenticated opted-in device with a current mobile session and active tenant/member/grant is eligible. Logout/session revocation removes server bindings by DB trigger; account/session deletion cascades. OFF removes the binding and unregisters the OS token. Invalid tokens are removed without deleting a rotated replacement. Devices are limited to 20 per member with transaction locks. Claims deduplicate the same saved report/device; only explicit 5xx without Retry-After gets at most one further send. 429 or Retry-After stops immediate retry; unknown transport delivery is never retried. A process crash after claim can lose a notification; this is not an exactly-once delivery promise. Delivery bookkeeping is cleaned opportunistically after seven days; no guaranteed TTL scheduler is claimed. Expired sessions are ineligible and device rows are pruned on later dispatch; the existing mobile session lifetime is unchanged.

Payload TTL is immediate-only to reduce stale delivery after logout; offline devices may miss a push but can read the saved report/Inbox on return. OS force-stop, disabled notifications, private-space restrictions, provider availability and provisioning can block delivery. A provider HTTP ACK is not proof of OS display. No background JS execution or closed-app analysis continuation is promised.

Official references: [Capacitor v7 push](https://capacitorjs.com/docs/v7/apis/push-notifications), [FCM HTTP v1/auth](https://firebase.google.com/docs/cloud-messaging/send/v1-api), [Android background messages](https://firebase.google.com/docs/cloud-messaging/android/receive-messages), [APNs responses](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns). Registry metadata confirmed latest-7 = 7.0.7 with peer core >=7; no Capacitor major upgrade was made.

An offline logout clears the local session immediately, but server revocation or OS unregistration can fail until connectivity returns/session expiry. Already accepted OS notifications cannot be recalled reliably. No private prose is in those notifications; opening always requires current account authorization. Do not claim an offline logout has been confirmed server-side. Native notification controls/generic alerts remain English; saved report content/labels and repository language selection reuse the existing en/ko contract.
