import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE_URL = 'http://10.0.0.102:5175';
const OUT_DIR = '/home/bradley/pliny-marketing/public/screenshots';
const USERNAME = 'bradley';
const PASSWORD = 'screenshot123';

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"], input[placeholder*="sername"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/(?!.*login)/, { timeout: 10000 });
  await page.waitForTimeout(1500);
}

async function setDarkMode(page) {
  // Ensure dark mode is active
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(300);
}

async function findBoard(page, name) {
  // Click on a board by name from board list
  const board = page.locator(`text="${name}"`).first();
  await board.click();
  await page.waitForTimeout(2000);
}

const WIDTH = 1440;
const HEIGHT = 900;

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
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // ── hero.png — main kanban board ──────────────────────────────────────────
  console.log('hero.png...');
  await findBoard(page, 'Product Launch Q1');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT_DIR}/hero.png`, fullPage: false });
  console.log('  ✓ hero.png');

  // ── calendar.png — calendar view ──────────────────────────────────────────
  console.log('calendar.png...');
  // Click calendar view tab
  const calBtn = page.locator('[aria-label*="alendar"], [title*="alendar"], button:has-text("Calendar")').first();
  await calBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT_DIR}/calendar.png`, fullPage: false });
  console.log('  ✓ calendar.png');

  // ── import.png — CSV import modal ─────────────────────────────────────────
  console.log('import.png...');
  // Go back to board list to find import button
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await setDarkMode(page);
  // Look for "Import" or "New board from CSV" button
  const importBtn = page.locator('button:has-text("Import"), button:has-text("CSV"), [title*="Import"]').first();
  await importBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT_DIR}/import.png`, fullPage: false });
  console.log('  ✓ import.png');

  // ── permissions.png — admin sharing tab ───────────────────────────────────
  console.log('permissions.png...');
  // Navigate to admin
  await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await setDarkMode(page);
  // Find admin link
  const adminLink = page.locator('a[href*="admin"], button:has-text("Admin"), [data-page="admin"]').first();
  await adminLink.click();
  await page.waitForTimeout(1500);
  // Click sharing tab
  const sharingTab = page.locator('button:has-text("Sharing"), button:has-text("Permissions"), [data-tab*="shar"]').first();
  await sharingTab.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT_DIR}/permissions.png`, fullPage: false });
  console.log('  ✓ permissions.png');

  // ── api.png — dev console / API view ──────────────────────────────────────
  console.log('api.png...');
  // Go back to a board and open dev console
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await setDarkMode(page);
  await findBoard(page, 'Product Launch Q1');
  await page.waitForTimeout(1000);
  // Open dev console (usually keyboard shortcut or button)
  const devBtn = page.locator('button:has-text("API"), button:has-text("Dev"), [aria-label*="API"], [title*="onsole"]').first();
  try {
    await devBtn.click({ timeout: 3000 });
    await page.waitForTimeout(1500);
  } catch {
    // Try keyboard shortcut
    await page.keyboard.press('Control+Shift+D');
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${OUT_DIR}/api.png`, fullPage: false });
  console.log('  ✓ api.png');

  await browser.close();
  console.log('\n✅ All screenshots saved to', OUT_DIR);
}

run().catch(err => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
