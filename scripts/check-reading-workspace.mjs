import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, reason: error.message }); } }
check('reading stylesheet is present', () => assert.ok(existsSync(resolve(root, 'src/app/reading-workspace.css')), 'Expected the shared reading-workspace stylesheet'));
if (checks[0].passed) {
  const css = read('src/app/reading-workspace.css');
  const entry = read('src/components/PublicGitHubEntry.tsx');
  check('same visual tokens scope sign-in and dashboard', () => assert.match(css, /\.github-entry,\s*\.github-dashboard\s*\{/));
  check('layout loads reading styles after legacy styles', () => assert.match(read('src/app/layout.tsx'), /import "\.\/globals\.css";\s*import "\.\/reading-workspace\.css";/));
  check('login is a single sign-in panel, not a marketing section', () => { assert.match(entry, /Sign in to AgentProof/); assert.doesNotMatch(entry, /github-entry-aside|github-entry-hero|EVIDENCE-FIRST PULL REQUEST REVIEW/); });
  check('GitHub POST and pending guard are retained', () => { assert.match(entry, /"\/api\/auth\/github\/start"/); assert.match(entry, /method: "POST"/); assert.match(entry, /disabled=\{pending\}/); assert.match(entry, /aria-busy=\{pending\}/); });
  check('preview access remains server gated and public PR input secondary', () => { assert.match(entry, /previewDemoAvailable \?/); assert.match(entry, /href="\/analyze"/); assert.match(entry, /href="\/dashboard\?demo=1"/); assert.match(entry, /github-entry-secondary-link/); });
  check('privacy and product limitations remain visible', () => { assert.match(entry, /correctness, safety, requirement satisfaction, or merge readiness/); assert.doesNotMatch(css, /\.dashboard-boundary[^{}]*\{[^}]*display:\s*none/); });
  check('mobile summary and evidence use one column', () => { const mobile = css.slice(css.indexOf('@media (max-width: 700px)')); assert.match(mobile, /\.summary-status-grid[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/); assert.match(mobile, /\.detail-grid/); });
  check('controls retain 44px touch targets and keyboard focus', () => { assert.match(css, /min-height:\s*44px/); assert.match(css, /:focus-visible/); });
  check('reduced motion and locally scrollable code are supported', () => { assert.match(css, /prefers-reduced-motion:\s*reduce/); assert.match(css, /overflow-x:\s*auto/); });
  check('no sharing action or new network endpoint is introduced', () => { assert.doesNotMatch(entry + css, /\/api\/reports\/share|Copy Share Link|\/shared\//); });
}
for (const result of checks) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.reason ? ': ' + result.reason : ''}`);
console.log(`${checks.filter(c => c.passed).length}/${checks.length} reading-workspace checks passed`);
if (checks.some(c => !c.passed)) process.exitCode = 1;
