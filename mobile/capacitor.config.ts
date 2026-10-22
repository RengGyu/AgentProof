import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = { appId: 'app.agentproof.mobile', appName: 'DiffEvidence', webDir: 'dist', loggingBehavior: 'none', plugins: { PushNotifications: { presentationOptions: [] } } };
export default config;
