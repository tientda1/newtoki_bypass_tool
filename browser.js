/**
 * browser.js — Playwright Browser Manager
 * Load cookies từ Chrome thật (export bằng export-cookies.js)
 * Không dùng CDP attach → không bị Cloudflare detect
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const USER_DATA_DIR  = path.join(__dirname, '.browser-profile');
const COOKIES_FILE   = path.join(__dirname, 'newtoki-cookies.json');

function findChromePath() {
  const base = process.env.LOCALAPPDATA || '';
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

const CHROME_PATH = findChromePath();

const FAKE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

/**
 * Tạo browser context — inject cookies từ Chrome thật để bypass Cloudflare
 */
async function createBrowserContext(headless = true) {
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  const launchOptions = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=ko-KR',
      '--window-size=1366,768',
    ],
    userAgent: FAKE_UA,
    viewport: { width: 1366, height: 768 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  };

  if (CHROME_PATH) {
    launchOptions.executablePath = CHROME_PATH;
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);

  // Ẩn navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ko-KR', 'ko', 'en-US', 'en'],
    });
  });

  // Inject cookies từ Chrome thật nếu có
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      if (cookies.length > 0) {
        await context.addCookies(cookies);
        const cfCookie = cookies.find(c => c.name === 'cf_clearance' || c.name === '__cf_clearance');
        if (cfCookie) {
          console.log(`  ✓ Loaded ${cookies.length} cookies (CF clearance: có)`);
        } else {
          console.log(`  ✓ Loaded ${cookies.length} cookies (CF clearance: không có)`);
        }
      }
    } catch (err) {
      console.log('  ⚠ Không load được cookies:', err.message);
    }
  } else {
    console.log('  ⚠ Chưa có newtoki-cookies.json → Chạy export-cookies.js trước');
  }

  return context;
}

/**
 * Tạo trang mới, block tracking
 */
async function createPage(context) {
  const page = await context.newPage();

  await page.route('**', async (route) => {
    const url = route.request().url();
    const blockList = [
      'google-analytics.com',
      'googletagmanager.com',
      'googlesyndication.com',
      'doubleclick.net',
      'adservice.google',
    ];
    if (blockList.some(p => url.includes(p))) {
      await route.abort();
    } else {
      await route.continue();
    }
  });

  return page;
}

/**
 * Điều hướng đến URL, xử lý Cloudflare nếu còn bị
 */
async function navigateTo(page, url, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const timeout    = options.timeout    || 30000;

  const CF_INDICATORS = [
    'just a moment',
    'checking your browser',
    '잠시만 기다리십시오',
    '보안 확인',
    'please wait',
    'ddos-guard',
  ];
  const isCfPage = async () => {
    const t = (await page.title()).toLowerCase();
    return CF_INDICATORS.some(x => t.includes(x));
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

      if (await isCfPage()) {
        console.log(`\n  [CF] Cloudflare detected.`);
        if (!fs.existsSync(COOKIES_FILE)) {
          throw new Error(
            'Bị Cloudflare và chưa có cookies.\n' +
            '  → Hãy chạy export-cookies.js để lấy session từ Chrome thật.'
          );
        }
        // Thử đợi tự giải với cookies đã inject
        console.log('  → Đợi CF tự giải (có cookies)...');
        const start = Date.now();
        while (Date.now() - start < 20000) {
          await page.waitForTimeout(1000);
          if (!(await isCfPage())) {
            console.log('  → ✓ CF passed!');
            return;
          }
        }
        if (attempt === maxRetries) {
          throw new Error(
            'Cookies đã hết hạn. Chạy lại:\n' +
            '  1. Mở Chrome thật → vào newtoki → pass CAPTCHA\n' +
            '  2. Đóng Chrome\n' +
            '  3. node export-cookies.js\n' +
            '  4. Chạy lại lệnh này'
          );
        }
        continue;
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return;

    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.log(`\n  [retry ${attempt}] ${err.message.substring(0, 100)}`);
      await page.waitForTimeout(2000);
    }
  }
}

module.exports = { createBrowserContext, createPage, navigateTo, CHROME_PATH, COOKIES_FILE };
