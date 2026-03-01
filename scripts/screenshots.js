const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'http://10.0.0.102:5175';
const OUT_DIR = '/home/bradley/pliny-marketing/public/screenshots';
const USERNAME = 'bradley';
const PASSWORD = 'screenshot123';

const WIDTH = 1440;
const HEIGHT = 900;

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  // Fill login form
  const usernameField = page.locator('input').first();
  await usernameField.fill(USERNAME);
  const passwordField = page.locator('input[type="password"]').first();
  await passwordField.fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);
}

async function setDarkMode(page) {
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(200);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log('Logging in...');
  await login(page);
  await setDarkMode(page);
  await page.waitForTimeout(800);

  const url = page.url();
  console.log('Current URL after login:', url);

  // ── hero.png — kanban board view ─────────────────────────────────────────
  console.log('Taking hero.png...');
  // Find "Product Launch Q1" board
  await page.waitForTimeout(1000);
  const boardLink = page.locator('text=Product Launch Q1').first();
  await boardLink.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT_DIR}/hero.png` });
  console.log('  ✓ hero.png');

  // ── calendar.png — calendar view ─────────────────────────────────────────
  console.log('Taking calendar.png...');
  const calBtn = page.locator('button[title*="Calendar"], button[aria-label*="Calendar"], button:has-text("Calendar")').first();
  try {
    await calBtn.click({ timeout: 5000 });
  } catch (e) {
    // Try clicking view mode icons
    const viewBtns = page.locator('button[class*="view"], [data-view]');
    const count = await viewBtns.count();
    if (count > 1) await viewBtns.nth(1).click();
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT_DIR}/calendar.png` });
  console.log('  ✓ calendar.png');

  // ── import.png — CSV import modal ────────────────────────────────────────
  console.log('Taking import.png...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await setDarkMode(page);
  await page.waitForTimeout(1000);
  // Look for import/CSV button
  const importBtn = page.locator('button:has-text("Import"), button[title*="Import"], button[aria-label*="Import"]').first();
  try {
    await importBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('  Import button not found, trying menu...');
    // Try dropdown/menu
    const menuBtn = page.locator('button[aria-label*="menu"], button[aria-label*="more"], button[title*="New"]').first();
    await menuBtn.click({ timeout: 3000 });
    await page.waitForTimeout(500);
    const csvOpt = page.locator('text=CSV, text=Import').first();
    await csvOpt.click({ timeout: 3000 });
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: `${OUT_DIR}/import.png` });
  console.log('  ✓ import.png');

  // ── permissions.png — admin sharing ──────────────────────────────────────
  console.log('Taking permissions.png...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await setDarkMode(page);
  await page.waitForTimeout(1000);
  // Navigate to admin
  const adminLink = page.locator('a:has-text("Admin"), button:has-text("Admin"), [href*="admin"]').first();
  try {
    await adminLink.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    // Click sharing tab
    const sharingTab = page.locator('button:has-text("Sharing"), button:has-text("Public Boards"), [data-tab*="shar"]').first();
    await sharingTab.click({ timeout: 3000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log('  Admin nav issue:', e.message);
  }
  await page.screenshot({ path: `${OUT_DIR}/permissions.png` });
  console.log('  ✓ permissions.png');

  // ── api.png — dev console ────────────────────────────────────────────────
  console.log('Taking api.png...');
  // Navigate to a board
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await setDarkMode(page);
  await page.waitForTimeout(800);
  const boardLink2 = page.locator('text=Product Launch Q1').first();
  await boardLink2.click();
  await page.waitForTimeout(2000);
  // Open dev console
  const devBtn = page.locator('button:has-text("API"), button[title*="Dev"], button[aria-label*="Dev"], button[title*="Console"]').first();
  try {
    await devBtn.click({ timeout: 4000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    // Keyboard shortcut
    await page.keyboard.press('Control+Shift+D');
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${OUT_DIR}/api.png` });
  console.log('  ✓ api.png');

  await browser.close();
  console.log('\n✅ All screenshots saved to', OUT_DIR);
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
