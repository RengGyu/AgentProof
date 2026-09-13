import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

test('owned scalar survives a real Next development-server route bundle', { skip: process.env.AGENTPROOF_SCALAR_OWNED_FIXTURE_TESTS !== '1', timeout: 60_000 }, async () => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: `--import=${fileURLToPath(new URL('./owned-scalar-next-preload.mjs', import.meta.url))}`,
      AGENTPROOF_GENERAL_PR_OBSERVATION_MODE: 'advisory', AGENTPROOF_ORDINARY_SCALAR_EXECUTION: 'enabled', AGENTPROOF_SCALAR_IMAGE: process.env.AGENTPROOF_SCALAR_IMAGE }
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { if (output.length < 64 * 1024) output += chunk.toString('utf8'); });
  try {
    const deadline = Date.now() + 30_000;
    while (!output.includes('Ready in') && Date.now() < deadline && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(output.includes('Ready in'), 'Owned Next server did not become ready');
    const response = await fetch(`http://127.0.0.1:${port}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prUrl: 'https://github.com/owned/scalar/pull/12', taskText: 'Function `answer` in `src/owned.js` must return `42` when called with no arguments.' }), signal: AbortSignal.timeout(25_000) });
    const body = await response.json();
    assert.equal(response.status, 200, `Owned Next route status: ${response.status}; category: ${body.category ?? 'none'}`);
    assert.equal(body.report?.ordinaryRequirementOutcomes?.requirements[0]?.criterion?.state, 'satisfied');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); child.on('close', () => { clearTimeout(timer); resolve(); }); });
  }
});
