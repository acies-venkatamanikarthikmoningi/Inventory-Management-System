import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:5174';
const results = {};
const consoleErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push('console.error: ' + msg.text()); });

async function login(nodeCity) {
  await page.goto(BASE + '/');
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/');
  await page.getByText('Continue to Login').first().click();
  await page.waitForURL('**/select-node');
  await page.locator('button', { hasText: `${nodeCity} DC` }).first().click();
  await page.locator('button', { hasText: `Proceed with ${nodeCity} DC` }).first().click();
  await page.waitForURL('**/login');
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill('admin123');
  await page.locator('button', { hasText: 'Sign In' }).click();
  await page.waitForURL('**/app/**');
}

function cardTexts() {
  return page.evaluate(() => Array.from(document.querySelectorAll('div[class*="driftCard"]')).map(card => card.textContent));
}

await login('Chennai');

await page.goto(BASE + '/app/replenishment?tab=robustness');
await page.waitForTimeout(1000);

results.filterButtonCounts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => /^(Waiting for Approval|No Change|Auto-Approved) \(/.test(t))
);

// Waiting for Approval (default tab) - expect 7 demo cards
await page.waitForTimeout(300);
const waitingCards = await cardTexts();
results.waitingCardCount = waitingCards.length;
results.waitingSkus = await page.evaluate(() => Array.from(document.querySelectorAll('div[class*="driftCard"] code')).map(c => c.textContent));
results.waitingAllPendingBadge = waitingCards.every(t => t.includes('Suggested - pending your approval'));
await page.screenshot({ path: 'shot_demo_1_waiting.png', fullPage: true });

// Expand first card's cost breakdown + capture score/policy-type diversity
await page.locator('button', { hasText: /Cost breakdown/i }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'shot_demo_2_waiting_expanded.png', fullPage: true });

results.waitingPolicyTypesShown = await page.evaluate(() =>
  Array.from(document.querySelectorAll('div[class*="driftCard"] strong[class*="policyTypeChanged"]')).map(el => el.textContent)
);

// Auto-Approved tab - expect 6 demo cards
await page.locator('button').filter({ hasText: /^Auto-Approved/ }).first().click();
await page.waitForTimeout(400);
const autoCards = await cardTexts();
results.autoCardCount = autoCards.length;
results.autoSkus = await page.evaluate(() => Array.from(document.querySelectorAll('div[class*="driftCard"] code')).map(c => c.textContent));
results.autoRealApproveButtons = await page.evaluate(() =>
  Array.from(document.querySelectorAll('div[class*="driftCard"] button')).filter(b => b.textContent.trim() === 'Approve').length
);
await page.screenshot({ path: 'shot_demo_3_auto.png', fullPage: true });

// Click through to an audit log entry on the first Auto-Approved card
await page.locator('button', { hasText: /View audit log entry/i }).first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'shot_demo_4_auto_audit.png', fullPage: true });
results.auditLogVisible = await page.evaluate(() => document.body.textContent.includes('by system_auto_governance'));

// No Change tab sanity (real + should NOT include any of the 13 demo SKUs)
await page.locator('button').filter({ hasText: /^No Change \(/ }).first().click();
await page.waitForTimeout(400);
results.noChangeSkusOverlapWithDemo = await page.evaluate((demoSkus) => {
  const shown = Array.from(document.querySelectorAll('div[class*="driftCard"] code')).map(c => c.textContent);
  return shown.filter(s => demoSkus.includes(s));
}, [...results.waitingSkus, ...results.autoSkus]);

results.consoleErrors = consoleErrors;
fs.writeFileSync('verify_demo_results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

await browser.close();
