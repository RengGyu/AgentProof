import { spawn } from 'node:child_process';

// Trusted controller. Source is data for the WASM bridge, never Node evaluation.
const MAX = 64 * 1024 + 4096;
const input = [];
let inputBytes = 0;
for await (const chunk of process.stdin) {
  inputBytes += chunk.length;
  if (inputBytes > MAX) process.exit(2);
  input.push(chunk);
}
const child = spawn(process.execPath, ['/opt/agentproof-scalar/target.mjs'], {
  uid: 10001, gid: 10001, shell: false,
  env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'ignore']
});
const output = [];
let bytes = 0;
let failed = false;
const timer = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, 5000);
child.stdout.on('data', (chunk) => {
  bytes += chunk.length;
  if (bytes > 4096) { failed = true; child.kill('SIGKILL'); }
  else output.push(chunk);
});
child.on('error', () => { failed = true; });
child.stdin.on('error', () => { failed = true; });
child.on('close', (code) => {
  clearTimeout(timer);
  if (failed || code !== 0) process.exit(2);
  try {
    const packet = JSON.parse(Buffer.concat(output).toString('utf8'));
    if (packet.kind !== 'returned' || packet.isolation.targetUid !== 10001 || packet.isolation.targetGid !== 10001 ||
      packet.isolation.capEff !== '0000000000000000' || packet.isolation.capPrm !== '0000000000000000' ||
      packet.isolation.noNewPrivs !== '1' || packet.isolation.parentChannelsBlocked !== true) process.exit(2);
    process.stdout.write(JSON.stringify({ ...packet, isolation: { observerUid: process.getuid(), ...packet.isolation } }));
  } catch { process.exit(2); }
});
child.stdin.end(Buffer.concat(input));
