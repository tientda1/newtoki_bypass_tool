/**
 * http-scraper.js — Scrape Newtoki dùng HTTP request thuần (không browser)
 *
 * Tại sao cần cái này:
 *   Playwright hiển thị banner "Chrome đang bị điều khiển bởi phần mềm tự động"
 *   → Cloudflare phát hiện và challenge liên tục.
 *   Thay vào đó, lấy cf_clearance từ lần đầu (--no-headless), lưu vào file,
 *   rồi dùng axios + cookie để fetch HTML trực tiếp — không bị detect.
 *
 * Yêu cầu: cf_clearance phải được lấy từ Chrome THẬT (không phải Playwright).
 *   → Dùng export-cookies.js hoặc Cookie-Editor extension trong Chrome thật.
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');

const COOKIES_FILE = path.join(__dirname, 'newtoki-cookies.json');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Đọc cookies từ file và tạo Cookie header string
 */
function buildCookieHeader(domain) {
  if (!fs.existsSync(COOKIES_FILE)) return '';
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const relevant = cookies.filter(c => {
      if (c.expires > 0 && c.expires < now) return false; // hết hạn
      const cookieDomain = c.domain.replace(/^\./, '');
      return domain.includes(cookieDomain) || cookieDomain.includes(domain.split('.').slice(-2).join('.'));
    });
    return relevant.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

/**
 * Tạo axios instance với headers giống Chrome thật
 */
function createHttpClient(baseUrl) {
  const urlObj = new URL(baseUrl);
  const domain = urlObj.hostname;
  const cookieHeader = buildCookieHeader(domain);

  if (!cookieHeader) {
    console.warn('  ⚠ Không tìm thấy cookies trong file — có thể bị challenge CF');
  } else {
    const hasCf = cookieHeader.includes('cf_clearance');
    console.log(`  ✓ HTTP mode: ${hasCf ? 'có cf_clearance ✓' : 'không có cf_clearance'}`);
  }

  return axios.create({
    baseURL: baseUrl,
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cookie': cookieHeader,
    },
    maxRedirects: 5,
    validateStatus: s => s < 500,
  });
}

/**
 * Kiểm tra HTML có phải trang CF challenge không
 */
function isCfChallenge(html, url) {
  if (!html) return true;
  if (url && url.includes('__cf_chl')) return true;
  const lower = html.toLowerCase();
  return lower.includes('just a moment') ||
         lower.includes('잠시만 기다리십시오') ||
         lower.includes('checking your browser') ||
         lower.includes('enable javascript and cookies') ||
         (lower.includes('cloudflare') && lower.includes('challenge'));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fetch với CF check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Fetch URL, kiểm tra CF, trả về cheerio object
 * @param {string} url - full URL
 * @param {AxiosInstance} client
 * @returns {{ $: CheerioAPI, html: string, url: string }}
 */
async function fetchPage(url, client) {
  const resp = await client.get(url);

  if (resp.status === 403 || resp.status === 503) {
    throw new Error(
      `HTTP ${resp.status} — Cloudflare chặn request.\n` +
      '  → Cần lấy cf_clearance mới từ Chrome thật:\n' +
      '  1. Mở Chrome thường (không phải tool), vào newtoki469.com\n' +
      '  2. Dùng Cookie-Editor extension → Export → dán vào newtoki-cookies.json\n' +
      '  3. Hoặc: node export-cookies.js (xem README)'
    );
  }

  const html = resp.data;
  const finalUrl = resp.request?.res?.responseUrl || url;

  if (isCfChallenge(html, finalUrl)) {
    throw new Error(
      'Cloudflare managed challenge — cf_clearance không hợp lệ hoặc đã hết hạn.\n' +
      '  → cf_clearance phải lấy từ Chrome THẬT (không phải Playwright).\n' +
      '  → Cách lấy: Mở Chrome thường → vào newtoki469.com → F12 → Application → Cookies\n' +
      '  → Copy giá trị cf_clearance → cập nhật newtoki-cookies.json'
    );
  }

  const $ = cheerio.load(html);
  return { $, html, url: finalUrl };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Scraper functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Lấy danh sách truyện từ trang webtoon
 * @param {string} baseUrl - vd: https://newtoki469.com
 * @param {object} options - { page, category, keyword }
 * @returns {Array<{title, url, thumbnail, lastUpdate}>}
 */
async function browseOrSearch(baseUrl, options = {}) {
  const client = createHttpClient(baseUrl);
  const { page: pageNum = 1, category = '', keyword = '' } = options;

  let url = `${baseUrl}/webtoon`;
  const params = [];
  if (keyword)  params.push(`stx=${encodeURIComponent(keyword)}`);
  if (category) params.push(`toon=${encodeURIComponent(category)}`);
  if (pageNum > 1) params.push(`page=${pageNum}`);
  if (params.length) url += '?' + params.join('&');

  console.log(`  → Fetch: ${url}`);
  const { $, html } = await fetchPage(url, client);

  // Debug: log HTML snippet để biết structure
  const bodyText = $('body').text().substring(0, 200).trim();
  console.log(`  [debug] Body snippet: ${bodyText.substring(0, 100).replace(/\s+/g, ' ')}`);

  const items = [];
  const seen  = new Set();

  // Thử nhiều selector pattern
  const linkSelectors = [
    'a[href*="/webtoon/"]',
    'a[href*="/comic/"]',
    'a[href*="/manhwa/"]',
  ];

  for (const sel of linkSelectors) {
    $(sel).each((_, el) => {
      const href = $(el).attr('href') || '';
      const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;

      try {
        const parts = new URL(fullHref).pathname.split('/').filter(Boolean);
        if (parts.length < 2) return;
      } catch { return; }

      if (seen.has(fullHref)) return;
      seen.add(fullHref);

      // Tìm container
      const container = $(el).closest('li, article, .item, .toon-item, div[class*="item"], .list-item').first();
      const ctx = container.length ? container : $(el);

      // Title
      const titleEl = ctx.find('.subject, .title, h3, h4, [class*="subject"], [class*="title"], [class*="toon"]').first();
      const title = titleEl.length ? titleEl.text().trim() : $(el).text().trim().substring(0, 80);
      if (!title || title.length < 2) return;

      // Thumbnail
      const img = ctx.find('img').first();
      const thumbnail = img.attr('data-src') || img.attr('data-original') || img.attr('src') || null;

      // Update date
      const updateEl = ctx.find('.update, .date, time, [class*="update"]').first();
      const lastUpdate = updateEl.length ? updateEl.text().trim() : '';

      items.push({ title, url: fullHref, thumbnail, lastUpdate });
    });

    if (items.length > 0) break;
  }

  return items;
}

/**
 * Lấy danh sách chapter của manga
 * @param {string} baseUrl
 * @param {string} mangaUrl
 * @returns {{ title: string, chapters: Array }}
 */
async function getChapterList(baseUrl, mangaUrl) {
  const client = createHttpClient(baseUrl);
  const { $ } = await fetchPage(mangaUrl, client);

  const mangaTitle =
    $('.view-title, h1, .subject, .toon-title, .title-subject').first().text().trim() ||
    $('title').text().split('|')[0].trim();

  const chapters = [];
  const selectors = [
    '.serial-list .item',
    '.chapter-list li',
    '.list-item-view',
    'ul.list li',
    '.view-lst li',
  ];

  let found = null;
  for (const sel of selectors) {
    if ($(sel).length > 0) { found = sel; break; }
  }

  if (!found) {
    // Fallback: link có /webtoon/view/
    $('a[href*="/webtoon/view/"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;
      const numMatch = fullHref.match(/\/(\d+)(?:\?|$)/);
      chapters.push({
        title: $(el).text().trim().substring(0, 80),
        url: fullHref,
        number: numMatch ? parseInt(numMatch[1]) : i,
        date: '',
      });
    });
  } else {
    $(found).each((i, el) => {
      const link = $(el).find('a').first();
      if (!link.length) return;
      const href  = link.attr('href') || '';
      const fullHref = href.startsWith('http') ? href : `${baseUrl}${href}`;
      const numMatch = fullHref.match(/\/(\d+)(?:\?|$)/);
      const title = $(el).find('.title, .subject, span').first().text().trim() || link.text().trim().substring(0, 80);
      const date  = $(el).find('.date, time, .num-date').first().text().trim();
      chapters.push({ title, url: fullHref, number: numMatch ? parseInt(numMatch[1]) : i, date });
    });
  }

  return { title: mangaTitle, chapters: chapters.reverse() };
}

module.exports = {
  browseOrSearch,
  getChapterList,
  buildCookieHeader,
  isCfChallenge,
};
