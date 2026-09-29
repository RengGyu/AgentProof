# AgentProof mobile source

The React screen is bundled locally for Capacitor. Native HTTP calls the existing AgentProof server for GitHub sign-in and tenant-authorized repository/report reads. The mobile bearer stays in process memory only: restarting the app requires a new sign-in. The copied summary is user-triggered; report data is not saved for offline use.

Set `VITE_AGENTPROOF_API_URL` to the production HTTPS origin before `pnpm build`, then run `pnpm exec cap sync ios` and `pnpm exec cap sync android`. Native iOS and Android projects include the `agentproof://auth/callback` handler. iOS debug build for the connected device and Android debug APK build have passed locally; automatic GitHub return still needs device verification on each platform. The server needs a registered HTTPS GitHub App callback for `/api/mobile/auth/callback` and both mobile migrations applied. Native bridge logging is disabled because its debug output can include authentication responses.

Account deletion policy and its in-app flow remain pending. iOS binary build, release signing, device testing, store metadata, and store submission have not been verified here.
