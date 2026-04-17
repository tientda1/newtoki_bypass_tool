/**
 * export-cookies.js
 *
 * CÁCH DÙNG:
 * 1. Mở Chrome thật (của bạn, KHÔNG phải Chrome do tool mở)
 * 2. Vào https://newtoki468.com/webtoon và pass CAPTCHA bình thường
 * 3. Duyệt trang được → ĐÓNG CHROME lại
 * 4. Chạy: node export-cookies.js
 * 5. Sau đó dùng tool bình thường
 *
 * Đọc cookies từ SQLite của Chrome (không cần CDP, không bị detect)
 */
'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

function getChromeCookiePath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(base, 'Google', 'Chrome', 'User Data', 'Default', 'Cookies'),
    path.join(base, 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies'),
  ];
  return candidates.find(fs.existsSync) || null;
}

function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  NEWTOKI COOKIE EXPORTER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const cookiePath = getChromeCookiePath();
  if (!cookiePath) {
    console.error('❌ Không tìm thấy file Cookies của Chrome!');
    console.error('   Hãy chắc chắn đã cài Google Chrome.');
    process.exit(1);
  }

  console.log(`  Cookie file: ${cookiePath}`);

  // Chrome phải đóng trước khi đọc (file bị lock khi Chrome đang mở)
  const tmpCookies = path.join(__dirname, '_cookies_tmp.db');
  try {
    fs.copyFileSync(cookiePath, tmpCookies);
  } catch (err) {
    if (err.code === 'EBUSY' || err.message.includes('locked')) {
      console.error('\n  ❌ Chrome đang mở và lock file Cookies!');
      console.error('  → Hãy ĐẦU CHROME lại rồi chạy lệnh này.\n');
    } else {
      console.error('\n  ❌ Lỗi đọc file cookies:', err.message);
    }
    process.exit(1);
  }

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error('\n  Chạy: npm install better-sqlite3');
    process.exit(1);
  }

  const db = new Database(tmpCookies, { readonly: true });

  // Lấy cookies của tất cả domain newtoki
  const rows = db.prepare(
    `SELECT host_key, name, value, path, is_secure, is_httponly, expires_utc, samesite
     FROM cookies
     WHERE host_key LIKE '%newtoki%'`
  ).all();

  db.close();
  try { fs.unlinkSync(tmpCookies); } catch {}

  if (!rows.length) {
    console.log('\n  ⚠ Chưa có cookies newtoki trong Chrome!');
    console.log('  → Hãy làm theo thứ tự:');
    console.log('    1. Mở Chrome thật của bạn');
    console.log('    2. Vào https://newtoki468.com/webtoon');
    console.log('    3. Pass CAPTCHA (click checkbox)');
    console.log('    4. Chờ trang hiện danh sách truyện');
    console.log('    5. ĐÓNG CHROME');
    console.log('    6. Chạy lại: node export-cookies.js\n');
    process.exit(0);
  }

  // Convert sang Playwright cookie format
  const samesiteMap = { 0: 'None', 1: 'Lax', 2: 'Strict' };
  const playwrightCookies = rows.map(r => ({
    name:     r.name,
    value:    r.value,
    domain:   r.host_key.startsWith('.') ? r.host_key : r.host_key,
    path:     r.path || '/',
    secure:   !!r.is_secure,
    httpOnly: !!r.is_httponly,
    sameSite: samesiteMap[r.samesite] || 'None',
    expires:  r.expires_utc && r.expires_utc > 0
      ? Math.floor((Number(r.expires_utc) / 1000000) - 11644473600)
      : -1,
  }));

  const outFile = path.join(__dirname, 'newtoki-cookies.json');
  fs.writeFileSync(outFile, JSON.stringify(playwrightCookies, null, 2));

  console.log(`\n  ✅ Xuất ${playwrightCookies.length} cookies thành công!`);
  // Chrome lưu là cf_clearance (không có __ ở đầu)
  const cfCookie = playwrightCookies.find(c => c.name === 'cf_clearance' || c.name === '__cf_clearance');
  if (cfCookie) {
    console.log(`  ✅ CF clearance cookie có mặt ("${cfCookie.name}") → Cloudflare session OK!`);
  } else {
    console.log('  ⚠ Không thấy cf_clearance → Có thể chưa pass CAPTCHA đúng cách');
    console.log('     Hãy vào lại newtoki bằng Chrome thật và pass CAPTCHA lại.');
  }

  console.log('\n  → Các cookies đã lưu vào: newtoki-cookies.json');
  console.log('  → Bây giờ có thể dùng tool:\n');
  console.log('  node index.js --domain newtoki468.com browse');
  console.log('  node index.js --domain newtoki468.com search "tên truyện"');
  console.log('  node index.js chapters <manga-url>');
  console.log('  node index.js download <chapter-url>\n');
}

main();
