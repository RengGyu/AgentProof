import { execFileSync } from 'node:child_process';
const endpoint = process.env.VITE_AGENTPROOF_API_URL;
if (!endpoint || !/^https:\/\/[^/]+\/?$/.test(endpoint)) {
  throw new Error('Set VITE_AGENTPROOF_API_URL to the production HTTPS origin before building.');
}
execFileSync('pnpm', ['exec', 'vite', 'build'], { stdio: 'inherit' });
