/**
 * browser.js — Playwright Browser Manager (v2 — với CAPTCHA detection)
 *
 * - Dùng playwright-extra + stealth plugin để bypass Cloudflare bot detection
 * - Load cookies cf_clearance từ Chrome thật
 * - Detect CAPTCHA / security page → solve bằng Ollama Gemma 4
 * - Retry navigate sau khi solve
 */

'use strict';

// Dùng playwright-extra + stealth để bypass bot detection tốt hơn
let chromium;
try {
  const { chromium: chromiumExtra } = require('playwright-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  chromiumExtra.use(StealthPlugin());
  chromium = chromiumExtra;
} catch {
  // Fallback nếu playwright-extra chưa cài
  ({ chromium } = require('playwright'));
  console.warn('  ⚠ playwright-extra không tìm thấy, dùng playwright thường (dễ bị detect hơn)');
}

const path = require('path');
const fs   = require('fs');

const USER_DATA_DIR         = path.join(__dirname, '.browser-profile');
const REAL_CHROME_PROFILE    = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
const COOKIES_FILE           = path.join(__dirname, 'newtoki-cookies.json');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// ─── CAPTCHA selectors ────────────────────────────────────────────────────────
const CAPTCHA_TEXT_INDICATORS = [
  'just a moment',
  'checking your browser',
  '잠시만 기다리십시오',
  '보안 확인',
  'please wait',
  'ddos-guard',
  'access denied',
  'ray id',
  'captcha',
  'verify you are human',
  'are you human',
  'security check',
];

const CAPTCHA_ELEMENT_SELECTORS = [
  // Cloudflare Turnstile
  'iframe[src*="challenges.cloudflare.com"]',
  '.cf-turnstile',
  '#cf-challenge-running',
  '#challenge-form',
  '#challenge-stage',
  // Generic image CAPTCHA
  'img[src*="captcha"]',
  'img[alt*="captcha" i]',
  'img[id*="captcha" i]',
  '#captchaImg',
  '.captcha-image',
  // hCaptcha
  'iframe[src*="hcaptcha.com"]',
  '.h-captcha',
  // reCAPTCHA
  'iframe[src*="recaptcha"]',
  '.g-recaptcha',
  // Text input CAPTCHA (image + input)
  'input[name*="captcha" i]',
  'input[id*="captcha" i]',
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Browser context
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Tạo browser context stealth — bypass bot detection
 * @param {boolean} headless
 * @param {object} opts
 * @returns {BrowserContext}
 */
async function createBrowserContext(headless = true, opts = {}) {
  // Chọn profile dir
  // opts.useRealProfile = true → dùng Chrome User Data thật (fingerprint match cf_clearance)
  // Chrôme phải đóng sẵn trước khi dùng real profile
  const profileDir = (opts.useRealProfile && fs.existsSync(REAL_CHROME_PROFILE))
    ? REAL_CHROME_PROFILE
    : USER_DATA_DIR;

  if (profileDir === REAL_CHROME_PROFILE) {
    console.log('  ℹ Dùng Chrome User Data thật — đam bảo Chrome đã đóng hoàn toàn!');
  } else {
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }
  }

  const launchOptions = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--allow-running-insecure-content',
      '--lang=ko-KR',
      '--window-size=1366,768',
      '--start-maximized',
      // Ẩn automation indicators
      '--exclude-switches=enable-automation',
      '--disable-extensions-except',
      // Giả lập Chrome thật
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
    ],
    userAgent: FAKE_UA,
    viewport: { width: 1366, height: 768 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    ...opts,
  };

  // Ưu tiên dùng Chrome thật (fingerprint match với cf_clearance)
  if (CHROME_PATH) {
    launchOptions.executablePath = CHROME_PATH;
    console.log(`  ✓ Dùng Chrome thật: ${CHROME_PATH}`);
  } else {
    console.log('  ⚠ Không tìm thấy Chrome, dùng Chromium (fingerprint có thể khác)');
  }

  const context = await chromium.launchPersistentContext(profileDir, launchOptions);

  // Stealth initScript — ẩn mọi dấu hiệu automation
  await context.addInitScript(() => {
    // navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Plugins — Chrome thật có nhiều plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }];
        arr.__proto__ = PluginArray.prototype;
        return arr;
      },
    });

    // Languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ko-KR', 'ko', 'en-US', 'en'],
    });

    // Hardware concurrency — giả lập CPU thật
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

    // Chrome runtime
    if (!window.chrome) {
      window.chrome = {
        runtime: {
          PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
          PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
          RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
          OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        },
        loadTimes: () => ({}),
        csi: () => ({}),
        app: {},
      };
    }

    // Permissions API
    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(params);
    }

    // WebGL fingerprint evasion
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });

  // Inject cookies từ Chrome thật (cf_clearance) nếu có
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      if (cookies.length > 0) {
        const cfCookie = cookies.find(c => c.name === 'cf_clearance' || c.name === '__cf_clearance');
        if (cfCookie) {
          const cookieDomainNum = (cfCookie.domain || '').match(/newtoki(\d+)/)?.[1];
          const targetDomainNum = (opts.targetDomain || '').match(/newtoki(\d+)/)?.[1];
          if (cookieDomainNum && targetDomainNum && cookieDomainNum !== targetDomainNum) {
            console.log(`  ⚠ Cookie domain mismatch: cookie là newtoki${cookieDomainNum} nhưng target là newtoki${targetDomainNum}`);
            console.log('  ⚠ Cookies cũ có thể không hợp lệ cho domain này — sẽ cần giải CAPTCHA lại.');
          } else {
            await context.addCookies(cookies);
            console.log(`  ✓ Loaded ${cookies.length} cookies (CF clearance: có ✓)`);
            console.log(`  ℹ cf_clearance domain: ${cfCookie.domain} | expires: ${new Date(cfCookie.expires * 1000).toLocaleString()}`);
          }
        } else {
          await context.addCookies(cookies);
          console.log(`  ✓ Loaded ${cookies.length} cookies (CF clearance: không có)`);
        }
      }
    } catch (err) {
      console.log('  ⚠ Không load được cookies:', err.message);
    }
  }

  return context;
}

/**
 * Tạo trang mới với route blocking (analytics, ads)
 */
async function createPage(context) {
  const page = await context.newPage();

  const BLOCK_LIST = [
    'google-analytics.com',
    'googletagmanager.com',
    'googlesyndication.com',
    'doubleclick.net',
    'adservice.google',
    'facebook.net',
    'connect.facebook.net',
  ];

  await page.route('**', async (route) => {
    const url = route.request().url();
    if (BLOCK_LIST.some(p => url.includes(p))) {
      await route.abort();
    } else {
      await route.continue();
    }
  });

  return page;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CAPTCHA Detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Phát hiện CAPTCHA / block trên trang hiện tại
 * @param {Page} page
 * @returns {{ detected: boolean, type: string, selector: string|null }}
 */
async function detectCaptcha(page) {
  // 0) Kiểm tra URL — CF redirect trung gian vẫn là block
  const currentUrl = page.url();
  if (currentUrl.includes('__cf_chl')) {
    return { detected: true, type: 'cf-redirect', selector: null };
  }

  // 1) Kiểm tra title
  const title = (await page.title().catch(() => '')).toLowerCase();
  const titleMatch = CAPTCHA_TEXT_INDICATORS.find(x => title.includes(x));
  if (titleMatch) {
    return { detected: true, type: 'title', selector: null };
  }

  // 2) Kiểm tra page content
  const bodyText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || '').catch(() => '');
  const textMatch = CAPTCHA_TEXT_INDICATORS.find(x => bodyText.includes(x));
  if (textMatch) {
    return { detected: true, type: 'text', selector: null };
  }

  // 3) Kiểm tra DOM elements
  for (const sel of CAPTCHA_ELEMENT_SELECTORS) {
    const el = await page.$(sel).catch(() => null);
    if (el) {
      return { detected: true, type: 'element', selector: sel };
    }
  }

  return { detected: false, type: null, selector: null };
}

/**
 * Chụp ảnh CAPTCHA element (hoặc screenshot toàn trang nếu không tìm thấy element)
 * @param {Page} page
 * @param {string|null} selector  - CSS selector của CAPTCHA element
 * @returns {Buffer|null} PNG buffer
 */
async function screenshotCaptcha(page, selector = null) {
  try {
    // Ưu tiên chụp ảnh CAPTCHA image cụ thể
    const imgSelectors = [
      'img[src*="captcha"]',
      'img[alt*="captcha" i]',
      'img[id*="captcha" i]',
      '#captchaImg',
      '.captcha-image',
      selector,
    ].filter(Boolean);

    for (const sel of imgSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        const buf = await el.screenshot({ type: 'png' }).catch(() => null);
        if (buf) return buf;
      }
    }

    // Fallback: chụp toàn trang
    return await page.screenshot({ type: 'png', fullPage: false });
  } catch {
    return null;
  }
}

/**
 * Thử giải CAPTCHA bằng Ollama Gemma 4
 * @param {Page} page
 * @param {object} ollamaModule  - require('./ollama')
 * @param {string} model
 * @returns {boolean} true nếu thành công
 */
async function trySolveCaptcha(page, ollamaModule, model) {
  try {
    console.log('  🤖 Phát hiện CAPTCHA — gọi Gemma 4 để giải...');

    const { detected, selector } = await detectCaptcha(page);
    if (!detected) return true; // Không còn CAPTCHA

    // Chụp ảnh CAPTCHA
    const screenshotBuf = await screenshotCaptcha(page, selector);
    if (!screenshotBuf) {
      console.log('  ⚠ Không chụp được CAPTCHA image.');
      return false;
    }

    // Gửi Gemma 4 phân tích
    const solved = await ollamaModule.solveCaptcha(screenshotBuf, model);
    if (!solved) {
      console.log('  ⚠ Gemma 4 không đọc được CAPTCHA.');
      return false;
    }

    console.log(`  🔑 Gemma 4 đọc được: "${solved}"`);

    // Tìm input và điền đáp án
    const inputSel = 'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]';
    const inputEl = await page.$(inputSel).catch(() => null);
    if (inputEl) {
      await inputEl.clear().catch(() => {});
      await inputEl.type(solved, { delay: 80 });

      // Submit form
      const form = await inputEl.evaluateHandle(el => el.closest('form')).catch(() => null);
      if (form) {
        await page.evaluate(f => f && f.submit(), form).catch(() => {});
      } else {
        await page.keyboard.press('Enter');
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      return true;
    }

    // Nếu là Cloudflare Turnstile / iframe → không thể auto-solve
    console.log('  ⚠ CAPTCHA là dạng visual (Cloudflare Turnstile / reCAPTCHA) — AI không thể tự click.');
    console.log('  → Gợi ý: Chạy với --no-headless và giải tay, sau đó export cookies.');
    return false;

  } catch (err) {
    console.log(`  ⚠ CAPTCHA solve error: ${err.message}`);
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Navigation với CAPTCHA handling
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Điều hướng đến URL, tự động detect + solve CAPTCHA nếu có
 * @param {Page} page
 * @param {string} url
 * @param {object} options
 *   options.maxRetries    {number} - mặc định 3
 *   options.timeout       {number} - mặc định 30000
 *   options.ollamaModule  {object} - require('./ollama') để solve CAPTCHA
 *   options.aiModel       {string} - Ollama model name
 */
async function navigateTo(page, url, options = {}) {
  const maxRetries   = options.maxRetries   || 3;
  const timeout      = options.timeout      || 30000;
  const ollamaModule = options.ollamaModule || null;
  const aiModel      = options.aiModel      || 'gemma4';
  const isHeadless   = options.headless !== false;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

      // Đợi trang ổn định + JS chạy
      await page.waitForTimeout(2000);

      const captchaInfo = await detectCaptcha(page);

      if (captchaInfo.detected) {
        console.log(`\n  [CAPTCHA] Phát hiện block (type: ${captchaInfo.type})`);

        if (ollamaModule) {
          const solved = await trySolveCaptcha(page, ollamaModule, aiModel);
          if (solved) {
            await page.waitForTimeout(3000);
            const stillBlocked = await detectCaptcha(page);
            if (!stillBlocked.detected) {
              console.log('  ✓ CAPTCHA đã được giải bằng AI!');
              await page.waitForLoadState('domcontentloaded').catch(() => {});
              return;
            }
          }
        }

        if (!isHeadless) {
          // Để user giải CAPTCHA ngay tại URL đích — KHÔNG redirect về root
          // (Cloudflare bảo vệ riêng từng path, giải ở root không unlock /webtoon)
          console.log(`  → Browser đang mở tại: ${url}`);
          console.log('  → Hãy giải CAPTCHA trong cửa sổ browser (ngay trang này).');
          console.log('  → Tool sẽ tiếp tục tự động sau khi bạn pass CAPTCHA...\n');
          const maxWaitMs = 180000; // 3 phút
          const start     = Date.now();
          while (Date.now() - start < maxWaitMs) {
            await page.waitForTimeout(2000);
            const stillBlocked = await detectCaptcha(page);
            if (!stillBlocked.detected) {
              // Cloudflare có thể đang trong trạng thái redirect trung gian (__cf_chl_rt_tk)
              // Đợi cho đến khi URL ổn định và trang thật load xong
              const cfSettleStart = Date.now();
              while (Date.now() - cfSettleStart < 15000) {
                const currentUrl = page.url();
                const currentTitle = (await page.title().catch(() => '')).toLowerCase();
                const isCfRedirect = currentUrl.includes('__cf_chl') || currentTitle.includes('just a moment');
                if (!isCfRedirect) break;
                await page.waitForTimeout(1000);
              }

              process.stdout.write('\n');
              console.log('  ✓ CAPTCHA đã được giải thủ công!');
              // Tự động lưu cookies
              await autoSaveCookies(page.context());
              await page.waitForLoadState('domcontentloaded').catch(() => {});
              return;
            }
            const elapsed = Math.round((Date.now() - start) / 1000);
            process.stdout.write(`\r  ⏳ Đang chờ bạn giải CAPTCHA... ${elapsed}s / 180s  `);
          }
          process.stdout.write('\n');
          console.log('  ⚠ Hết thời gian chờ (3 phút).');
        }

        if (attempt < maxRetries) {
          console.log(`\n  [retry ${attempt}/${maxRetries}] Thử lại...`);
          await page.waitForTimeout(3000);
          continue;
        }

        throw new Error(
          'Bị block bởi Cloudflare Turnstile.\n' +
          '  → Giải pháp:\n' +
          '  1. Chạy --no-headless → giải CAPTCHA tay trong browser (tool đợi 3 phút)\n' +
          '  2. Sau khi pass: node export-cookies.js → lần sau chạy bình thường\n' +
          '  3. Hoặc dùng Extension mode: node bridge-cli.js browse'
        );
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return;

    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.log(`\n  [retry ${attempt}] ${err.message.substring(0, 120)}`);
      await page.waitForTimeout(2000 * attempt);
    }
  }
}

/**
 * Tự động lưu cookies sau khi giải CAPTCHA thành công
 * @param {BrowserContext} context
 */
async function autoSaveCookies(context) {
  try {
    const cookies = await context.cookies();
    const cfCookies = cookies.filter(c =>
      (c.name === 'cf_clearance' || c.name === '__cf_clearance' ||
       c.name === 'PHPSESSID' || c.name.startsWith('_cf')) &&
      c.value && c.value.trim() !== '' // chỉ lưu cookies có value
    );
    if (cfCookies.length > 0) {
      // Sanitize: xóa Chrome-specific fields không dùng được trong Playwright
      const sanitized = cfCookies.map(c => {
        const { partitionKey, _crHasCrossSiteAncestor, ...rest } = c;
        if (rest.expires && !Number.isInteger(rest.expires)) {
          rest.expires = Math.floor(rest.expires);
        }
        return rest;
      });

      // Merge với cookies cũ nếu có (chỉ giữ cookies có value)
      let existing = [];
      if (fs.existsSync(COOKIES_FILE)) {
        try {
          const raw = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
          existing = raw.filter(c => c.value && c.value.trim() !== '');
        } catch {}
      }
      // Đè lên cookies cũ cùng tên + domain
      const merged = [...existing];
      for (const c of sanitized) {
        const idx = merged.findIndex(x => x.name === c.name && x.domain === c.domain);
        if (idx >= 0) merged[idx] = c; else merged.push(c);
      }
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(merged, null, 2));
      console.log(`  ✓ Đã tự động lưu ${sanitized.length} CF cookies → ${COOKIES_FILE}`);
      console.log('  ℹ Lần sau chạy headless bình thường, không cần --no-headless nữa.');
    }
  } catch (err) {
    console.log('  ⚠ Không lưu được cookies tự động:', err.message);
  }
}


/**
 * Debug helper: dump HTML của page để tìm selector đúng
 * @param {Page} page
 * @param {string} [outputFile] - đường dẫn file để lưu (nếu có)
 */
async function debugDumpHtml(page, outputFile = null) {
  const html = await page.content().catch(() => '<error getting content>');
  const title = await page.title().catch(() => '?');
  const url   = page.url();
  console.log(`\n  [DEBUG] URL: ${url}`);
  console.log(`  [DEBUG] Title: ${title}`);
  console.log(`  [DEBUG] HTML length: ${html.length} chars`);

  // Log đoạn giữa content
  const preview = html.substring(0, 3000);
  console.log(`  [DEBUG] HTML preview (3000 chars):\n${preview}\n  ...`);

  if (outputFile) {
    fs.writeFileSync(outputFile, html, 'utf8');
    console.log(`  [DEBUG] Đã lưu HTML đầy đủ → ${outputFile}`);
  }
  return html;
}

module.exports = {
  createBrowserContext,
  createPage,
  navigateTo,
  detectCaptcha,
  screenshotCaptcha,
  trySolveCaptcha,
  debugDumpHtml,
  CHROME_PATH,
  COOKIES_FILE,
};
