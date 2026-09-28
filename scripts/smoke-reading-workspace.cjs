/* Browser regression for the actual Next app, using its existing preview fixtures.
 * Run after `pnpm build`, with VERCEL_ENV=preview and playwright in NODE_PATH.
 * No real GitHub sign-in, repository mutation, model call or deployment occurs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'reading-workspace');
fs.mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:3210';
const results = [];
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '3210'], {
  cwd: root, env: { ...process.env, VERCEL_ENV: 'preview', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
});
const log = fs.createWriteStream(path.join(out, 'server.log'));
server.stdout.pipe(log); server.stderr.pipe(log);
let browser;
async function ready() {
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error('Next server exited before readiness');
    try { const r = await fetch(base); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Next server readiness timeout');
}
async function record(name, fn) {
  await fn(); results.push({ name, passed: true }); console.log('PASS', name);
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true, animations: 'disabled' });
}
async function noHorizontalOverflow(page) {
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.content <= size.viewport + 1, `Horizontal overflow: ${JSON.stringify(size)}`);
}
(async () => {
  await ready(); browser = await chromium.launch({ headless: true });
  for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['small-mobile', 360, 800]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await record(`${label}: server-rendered sign-in, no horizontal overflow`, async () => {
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Sign in to AgentProof' }).waitFor();
      const button = page.getByRole('button', { name: 'Continue with GitHub' });
      assert.ok((await button.boundingBox()).height >= 48);
      assert.equal(await page.locator('.github-entry-copy').count(), 1);
      await noHorizontalOverflow(page); await screenshot(page, `entry-${label}`);
    });
    await record(`${label}: GitHub failure remains readable and retryable`, async () => {
      await page.route('**/api/auth/github/start', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
      await page.getByRole('button', { name: 'Continue with GitHub' }).click();
      await page.getByRole('status').filter({ hasText: 'temporarily unavailable' }).waitFor();
      assert.ok(await page.getByRole('button', { name: 'Continue with GitHub' }).isEnabled());
      await noHorizontalOverflow(page); await screenshot(page, `entry-error-${label}`);
    });
    await record(`${label}: existing report and evidence render without overflow`, async () => {
      await page.goto(base + '/dashboard?demo=1', { waitUntil: 'networkidle' });
      await page.locator('.quick-summary').waitFor();
      await noHorizontalOverflow(page); await screenshot(page, `dashboard-${label}`);
      const expand = page.getByRole('button', { name: 'View detailed evidence', exact: true });
      if (await expand.isVisible()) await expand.click();
      await page.getByRole('button', { name: 'Copy JSON', exact: true }).waitFor();
      await noHorizontalOverflow(page); await screenshot(page, `evidence-${label}`);
    });
    await record(`${label}: JSON export is still actionable`, async () => {
      await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
      await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.ok(copied.length > 20); assert.equal(typeof JSON.parse(copied), 'object');
    });
    await record(`${label}: repository selection and settings remain accessible`, async () => {
      await page.locator('.dashboard-repository-strip > summary').click();
      await page.getByRole('heading', { name: 'Connected repositories' }).waitFor();
      await noHorizontalOverflow(page); await screenshot(page, `repositories-${label}`);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Repository settings' }).waitFor();
      const comments = page.locator('.dashboard-toggle-row').filter({ hasText: 'Summary comments' }).locator('input');
      assert.equal(await comments.isChecked(), false);
      assert.ok((await comments.boundingBox()).height >= 44);
      await noHorizontalOverflow(page); await screenshot(page, `settings-${label}`);
    });
    await record(`${label}: no uncaught browser exceptions`, async () => assert.deepEqual(errors, []));
    await context.close();
  }
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await noJs.newPage();
  await record('JavaScript disabled: sign-in is not blank', async () => {
    await page.goto(base); await page.getByRole('heading', { name: 'Sign in to AgentProof' }).waitFor();
    await screenshot(page, 'entry-no-javascript'); await noHorizontalOverflow(page);
  });
  await noJs.close();
})().catch(error => {
  results.push({ name: 'browser regression', passed: false, reason: error.message });
  console.error(error); process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ fixture: 'existing preview demo; not live GitHub data', results }, null, 2));
  if (browser) await browser.close();
  server.kill('SIGTERM'); log.end();
});
