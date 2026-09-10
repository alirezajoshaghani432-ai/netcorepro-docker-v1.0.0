#!/usr/bin/env node
/* Master test runner: runs every test suite in sequence, prints a combined summary. */
import { execSync } from 'node:child_process';
const SUITES = [
  'test_admin_api', 'test_dashboard_to_site', 'test_pages', 'test_images',
  'test_ui_health', 'test_links', 'test_forms', 'test_order_flow', 'test_security', 'test_access_control',
  'test_dashboard_sync', 'test_edge_cases', 'test_xss', 'test_media_and_reports', 'test_special_flows',
  'test_settings_and_deletes', 'test_referential_integrity', 'test_newsletter_and_search',
  'test_html_sanitizer', 'test_settings_injection',
  // نگهبان کیفیت داده: عکس دسته‌ها (تکراری بودن را هشدار می‌دهد، رد نمی‌کند)
  'test_category_images'
];
// The auth endpoint is rate-limited to 10 logins/min/IP (a security feature).
// Several suites log in 2-4 times; running them back-to-back can exhaust the
// bucket and cause false 429 failures. A small inter-suite pause lets the
// 60s window drain so suite ORDER never produces a spurious failure.
const SUITE_GAP_MS = parseInt(process.env.SUITE_GAP_MS || '7000', 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let grandPass = 0, grandFail = 0; const failedSuites = [];
for (let i = 0; i < SUITES.length; i++) {
  const s = SUITES[i];
  if (i > 0 && SUITE_GAP_MS > 0) await sleep(SUITE_GAP_MS);
  try {
    const out = execSync(`node scripts/${s}.mjs`, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
    const m = out.match(/(\d+) passed, (\d+) failed/);
    const p = m ? +m[1] : 0, f = m ? +m[2] : 0;
    grandPass += p; grandFail += f;
    if (f) failedSuites.push(s);
    console.log(`  ${f ? '\x1b[31m✗' : '\x1b[32m✓'}\x1b[0m ${s.padEnd(24)} ${p} passed, ${f} failed`);
  } catch (e) {
    grandFail++; failedSuites.push(s);
    const out = (e.stdout||'')+(e.stderr||'');
    const m = out.match(/(\d+) passed, (\d+) failed/);
    if (m) { grandPass += +m[1]; grandFail += (+m[2])-1; }
    console.log(`  \x1b[31m✗\x1b[0m ${s.padEnd(24)} ${m?m[0]:'errored'}`);
  }
}
console.log('──────────────────────────────────────');
console.log(`\x1b[1mGRAND TOTAL: ${grandPass} passed, ${grandFail} failed\x1b[0m`);
if (failedSuites.length) { console.log('\x1b[31mFailed suites: '+failedSuites.join(', ')+'\x1b[0m'); process.exit(1); }
process.exit(0);
