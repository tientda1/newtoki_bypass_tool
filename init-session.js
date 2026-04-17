/**
 * init-session.js — Khởi tạo session lần đầu
 * Tự động detect khi Cloudflare pass xong (không cần nhấn ENTER thủ công)
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = path.join(__dirname, '.browser-profile');

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

const CHROME_PATH = findChromePath();
const domain = process.argv[2] || 'newtoki468.com';
const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
const targetUrl = `${baseUrl}/webtoon`;

const CF_INDICATORS = [
  'just a moment',
  'checking your browser',
  '잠시만 기다리십시오',
  '보안 확인',
  'please wait',
  'ddos-guard',
];

function isCfTitle(title) {
  return CF_INDICATORS.some((t) => title.toLowerCase().includes(t.toLowerCase()));
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  NEWTOKI SESSION SETUP');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  Domain : ${domain}`);
  console.log(`  Chrome : ${CHROME_PATH || '(Chromium bundled)'}`);
  console.log(`  Profile: ${USER_DATA_DIR}\n`);

  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    console.log('  ✓ Đã xóa profile cũ\n');
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    executablePath: CHROME_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=ko-KR',
      '--window-size=1366,768',
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  // Ẩn webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('  → Đang mở trang Newtoki...\n');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │  HƯỚNG DẪN:                                  │');
  console.log('  │  1. Nhìn vào cửa sổ Chrome vừa mở           │');
  console.log('  │  2. Nếu thấy CAPTCHA → hãy CLICK vào đó     │');
  console.log('  │  3. Chờ vài giây cho trang load              │');
  console.log('  │  4. Tool sẽ tự động lưu khi thành công ✓    │');
  console.log('  └─────────────────────────────────────────────┘\n');

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  // Monitor liên tục — tự động detect khi CF pass
  let lastTitle = '';
  let cfClearanceSaved = false;
  let waitTime = 0;
  const MAX_WAIT = 300; // 5 phút tối đa

  while (waitTime < MAX_WAIT) {
    await page.waitForTimeout(1000);
    waitTime++;

    let currentTitle = '';
    let currentUrl = '';
    try {
      currentTitle = await page.title();
      currentUrl = page.url();
    } catch {
      continue; // page đang navigate
    }

    // In trạng thái mỗi 5 giây
    if (waitTime % 5 === 0) {
      const status = isCfTitle(currentTitle) ? '🔄 Chờ CAPTCHA...' : '✅ Trang OK';
      process.stdout.write(`\r  [${waitTime}s] ${status} — "${currentTitle.substring(0, 40)}"`);
    }

    // Kiểm tra cookie __cf_clearance (dấu hiệu CF đã pass)
    try {
      const cookies = await context.cookies();
      const cfCookie = cookies.find((c) => c.name === '__cf_clearance');

      if (cfCookie && !cfClearanceSaved) {
        cfClearanceSaved = true;
        process.stdout.write('\n');
        console.log('\n  ✓ __cf_clearance cookie nhận được!');
      }
    } catch {}

    // Kiểm tra đã vào trang thật chưa (không còn CF)
    if (
      !isCfTitle(currentTitle) &&
      currentTitle.length > 0 &&
      (currentUrl.includes('/webtoon') || currentUrl.includes(domain))
    ) {
      process.stdout.write('\n');
      console.log(`\n  ✅ Cloudflare đã pass! Đang vào: "${currentTitle}"`);

      // Chờ thêm để đảm bảo cookies được ghi đầy đủ
      console.log('  → Chờ 3 giây để lưu session...');
      await page.waitForTimeout(3000);

      // Lưu cookies ra file backup
      try {
        const cookies = await context.cookies();
        const cookieFile = path.join(__dirname, 'session-backup.json');
        fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
        console.log(`  ✓ Đã lưu ${cookies.length} cookies vào session-backup.json`);
      } catch {}

      await context.close();

      console.log('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  Session đã được lưu! Bây giờ có thể dùng:');
      console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log(`  node index.js --domain ${domain} browse`);
      console.log(`  node index.js --domain ${domain} search "tên truyện"`);
      console.log(`  node index.js chapters <manga-url>`);
      console.log(`  node index.js download <chapter-url>\n`);
      return;
    }

    if (currentTitle !== lastTitle && currentTitle) {
      lastTitle = currentTitle;
    }
  }

  // Timeout sau 5 phút
  console.log('\n\n  ⚠ Timeout 5 phút. Hãy thử lại hoặc dùng VPN.');
  await context.close();
}

main().catch((err) => {
  console.error('\nLỗi:', err.message);
  process.exit(1);
});
