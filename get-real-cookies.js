/**
 * get-real-cookies.js — Lấy cf_clearance từ Chrome thật qua CDP
 *
 * Cách hoạt động:
 *   1. Mở Chrome với --remote-debugging-port (KHÔNG có automation flag)
 *   2. Chrome mở như bình thường, không có banner "đang bị điều khiển"
 *   3. Sau 10 giây, script poll cookies từ Chrome định kỳ
 *   4. Khi tìm thấy cf_clearance hợp lệ, tự động lưu và thoát
 *
 * Usage:
 *   node get-real-cookies.js [domain]
 *   domain mặc định: newtoki469.com
 */

'use strict';

const { execFile } = require('child_process');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');

const COOKIES_FILE = path.join(__dirname, 'newtoki-cookies.json');
const DEBUG_PORT   = 9222;
const DOMAIN       = process.argv[2] || 'newtoki469.com';
const TARGET_URL   = `https://${DOMAIN}`;

// Tìm Chrome
function findChrome() {
  const base = process.env.LOCALAPPDATA || '';
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find(p => fs.existsSync(p));
}

// HTTP request đơn giản
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    http.get({
      host:    parsed.hostname,
      port:    parsed.port || 80,
      path:    parsed.pathname + parsed.search,
      timeout: 3000,
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Not JSON: ' + data.substring(0, 80))); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

// Gửi CDP command qua WebSocket
function cdpCommand(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(wsUrl);
    const id = Math.floor(Math.random() * 100000);
    const timer = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 8000);

    ws.on('open', () => ws.send(JSON.stringify({ id, method, params })));
    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch {}
    });
    ws.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

async function getCookies() {
  const tabs = await httpGet(`http://127.0.0.1:${DEBUG_PORT}/json`);
  if (!tabs || tabs.length === 0) return null;

  // Ưu tiên tab đang ở domain target
  const tab = tabs.find(t => t.url && t.url.includes(DOMAIN)) || tabs[0];
  if (!tab.webSocketDebuggerUrl) return null;

  const result = await cdpCommand(tab.webSocketDebuggerUrl, 'Network.getAllCookies');
  return (result.cookies || []).filter(c =>
    (c.domain || '').includes(DOMAIN.replace(/^newtoki/, '').split('.')[0]) ||
    (c.domain || '').includes('newtoki')
  );
}

async function saveCookies(cookies) {
  const needed = cookies.filter(c =>
    (c.name === 'cf_clearance' || c.name === 'PHPSESSID' || c.name.startsWith('_cf')) &&
    c.value && c.value.trim() !== ''
  );

  const normalized = needed.map(c => ({
    name:     c.name,
    value:    c.value,
    domain:   c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
    path:     c.path || '/',
    expires:  c.expires > 0 ? Math.floor(c.expires) : -1,
    httpOnly: !!c.httpOnly,
    secure:   !!c.secure,
    sameSite: c.sameSite || 'None',
  }));

  fs.writeFileSync(COOKIES_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('✗ Không tìm thấy Chrome!');
    process.exit(1);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Get Real Cookies — Chrome thật, không có automation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n  Domain: ${DOMAIN}`);
  console.log(`  Chrome: ${chromePath}\n`);

  // Kiểm tra xem Chrome đã mở với debug port chưa
  let chromeAlreadyOpen = false;
  try {
    await httpGet(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    chromeAlreadyOpen = true;
    console.log(`  ✓ Chrome debug port ${DEBUG_PORT} đã mở sẵn`);
  } catch {
    console.log(`  1. Mở Chrome với remote debugging port ${DEBUG_PORT}...`);
  }

  let chrome = null;
  if (!chromeAlreadyOpen) {
    const tempProfilePath = path.join(__dirname, '.chrome-temp-profile');
    if (!fs.existsSync(tempProfilePath)) {
      fs.mkdirSync(tempProfilePath, { recursive: true });
    }

    const args = [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tempProfilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      `${TARGET_URL}/webtoon`,
    ];

    console.log(`  → Sử dụng profile riêng: ${tempProfilePath}`);

    chrome = execFile(chromePath, args, { detached: true });
    chrome.unref();

    // Đợi Chrome khởi động
    console.log('  Đang đợi Chrome khởi động...');
    let lastErr = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      process.stdout.write('.');
      try {
        await httpGet(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
        console.log('\n  ✓ Chrome đã sẵn sàng!\n');
        break;
      } catch (err) {
        lastErr = err.message;
      }
      if (i === 14) {
        console.log(`\n  ✗ Chrome không phản hồi sau 15s. Lỗi cuối: ${lastErr}`);
        process.exit(1);
      }
    }
  }

  console.log(`  2. Vào ${TARGET_URL}/webtoon trên Chrome`);
  console.log('     Giải CAPTCHA nếu được hỏi.');
  console.log('     Script sẽ tự động lấy cookies khi tìm thấy cf_clearance...\n');

  // Poll liên tục cho đến khi lấy được cf_clearance
  let found = false;
  const deadline = Date.now() + 5 * 60 * 1000; // 5 phút

  while (Date.now() < deadline) {
    try {
      const cookies = await getCookies();
      if (cookies) {
        const cfCookie = cookies.find(c => c.name === 'cf_clearance' && c.value);
        if (cfCookie) {
          const saved = await saveCookies(cookies);
          console.log(`\n  ✓ Tìm thấy cf_clearance! Đã lưu ${saved.length} cookies.`);
          saved.forEach(c => {
            const exp = c.expires > 0 ? new Date(c.expires * 1000).toLocaleDateString() : 'session';
            console.log(`    ${c.name.padEnd(15)} | ${c.domain.padEnd(25)} | ${exp}`);
          });
          console.log('\n  ✓ Xong! Bây giờ chạy:');
          console.log(`  node newtoki-cli.js --domain ${DOMAIN} browse\n`);
          found = true;
          break;
        } else {
          process.stdout.write(`\r  ⏳ Chờ cf_clearance... (${Math.round((deadline - Date.now()) / 1000)}s còn lại)  `);
        }
      }
    } catch (err) {
      process.stdout.write(`\r  ⏳ Chrome chưa sẵn sàng... (${err.message.substring(0, 30)})  `);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!found) {
    console.log('\n\n  ⚠ Không tìm thấy cf_clearance sau 5 phút.');
    console.log('  → Hãy vào Chrome và truy cập ' + TARGET_URL + '/webtoon');
    console.log('  → Giải CAPTCHA nếu cần, rồi chạy lại script này.');
  }

  process.exit(found ? 0 : 1);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
