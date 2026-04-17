/**
 * scraper.js — Newtoki Scraper
 * Lấy danh sách truyện, chapters, và URL ảnh
 * Logic ảnh lấy từ NewtokiRipper-1.5 (data-* attribute trên <img>)
 */

'use strict';

const { navigateTo } = require('./browser');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Domain helper — newtoki thay đổi số liên tục
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _baseUrl = null;

function setBaseUrl(url) {
  _baseUrl = url.replace(/\/$/, '');
}

function getBaseUrl() {
  return _baseUrl;
}

/**
 * Tìm domain Newtoki đang hoạt động tự động
 * Thử từ số cao xuống thấp
 */
async function findActiveNewtoki(page, startNum = 470) {
  for (let n = startNum; n >= 400; n--) {
    const url = `https://newtoki${n}.com/webtoon`;
    try {
      console.log(`  Thử ${url}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      const status = await page.evaluate(() => ({
        title: document.title,
        hasContent: !!document.querySelector('.section-list, .webtoon-list, #content'),
      }));
      if (status.hasContent || (!status.title.includes('Error') && !status.title.includes('404'))) {
        console.log(`  ✓ Tìm thấy domain hoạt động: newtoki${n}.com`);
        setBaseUrl(`https://newtoki${n}.com`);
        return `https://newtoki${n}.com`;
      }
    } catch {
      // tiếp tục thử số tiếp theo
    }
  }
  throw new Error('Không tìm thấy domain Newtoki nào hoạt động. Hãy dùng --domain để chỉ định thủ công.');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tìm kiếm truyện
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Tìm kiếm truyện theo keyword
 * @returns {Array<{title, url, author, genre, status, thumbnail}>}
 */
async function searchManga(page, keyword) {
  const base = getBaseUrl();
  if (!base) throw new Error('Chưa set base URL. Hãy dùng --domain hoặc --find-domain trước.');

  const searchUrl = `${base}/webtoon?stx=${encodeURIComponent(keyword)}`;
  await navigateTo(page, searchUrl);

  const results = await page.evaluate(() => {
    const items = [];

    // Selector phổ biến của Newtoki cho danh sách truyện
    const selectors = [
      '.section-list .item',
      '.webtoon-list .item',
      '.list-item',
      'li.list-item',
      '.comic-list .item',
    ];

    let container = null;
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        container = found;
        break;
      }
    }

    // Fallback: tìm thẻ a có href chứa /webtoon/view/
    if (!container || container.length === 0) {
      const links = document.querySelectorAll('a[href*="/webtoon/view/"]');
      links.forEach((link) => {
        const img = link.querySelector('img');
        const titleEl = link.querySelector('.item-subject, .title, h3, h4, .subject');
        items.push({
          title: titleEl ? titleEl.textContent.trim() : link.textContent.trim(),
          url: link.href,
          thumbnail: img ? (img.dataset.src || img.src) : null,
          author: '',
          genre: '',
          status: '',
        });
      });
      return items;
    }

    container.forEach((el) => {
      const link = el.querySelector('a[href*="/webtoon/view/"]') || el.querySelector('a');
      if (!link) return;

      const img = el.querySelector('img');
      const titleEl = el.querySelector('.item-subject, .title, h3, h4, .subject, .toon-subject');
      const authorEl = el.querySelector('.author, .item-author');
      const genreEl = el.querySelector('.genre, .item-genre');
      const statusEl = el.querySelector('.status, .item-status');

      items.push({
        title: titleEl ? titleEl.textContent.trim() : link.textContent.trim(),
        url: link.href,
        thumbnail: img ? (img.dataset.src || img.src) : null,
        author: authorEl ? authorEl.textContent.trim() : '',
        genre: genreEl ? genreEl.textContent.trim() : '',
        status: statusEl ? statusEl.textContent.trim() : '',
      });
    });

    return items;
  });

  return results;
}

/**
 * Duyệt trang đầu hoặc danh mục
 * @param {string} category - 'all' | 'week' | 'finish' | tên thể loại
 */
async function browseManga(page, options = {}) {
  const base = getBaseUrl();
  if (!base) throw new Error('Chưa set base URL.');

  const { category = '', page: pageNum = 1 } = options;
  let url = `${base}/webtoon`;
  if (category) url += `?toon=${category}`;
  if (pageNum > 1) url += `${category ? '&' : '?'}page=${pageNum}`;

  await navigateTo(page, url);

  // Chờ Cloudflare pass: chờ cho đến khi xuất hiện link đến /webtoon/ hoặc timeout
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('a[href*="/webtoon/"]').length > 0,
      { timeout: 15000, polling: 1000 }
    );
  } catch {
    // Chấp nhận nếu timeout — sẽ trả rỗng
  }

  const results = await page.evaluate(() => {
    const items = [];

    // Thử nhiều selector theo cấu trúc Newtoki
    const links = document.querySelectorAll('a[href*="/webtoon/view/"]');
    const seen = new Set();

    links.forEach((link) => {
      if (seen.has(link.href)) return;
      seen.add(link.href);

      const container = link.closest('li, .item, article, .toon-item, div[class*="item"]') || link;
      const img = container.querySelector('img') || link.querySelector('img');
      const titleEl = container.querySelector(
        '.subject, .title, h3, h4, [class*="title"], [class*="subject"], [class*="toon"]'
      );
      const updateEl = container.querySelector('.update, .date, [class*="update"], time');
      const badgeEl = container.querySelector('.badge, .label, .new, [class*="badge"]');

      const rawTitle = titleEl
        ? titleEl.textContent.trim()
        : link.textContent.trim().substring(0, 60);

      // Bỏ qua nếu title quá ngắn (có thể là icon/nút)
      if (!rawTitle || rawTitle.length < 1) return;

      items.push({
        title: rawTitle,
        url: link.href,
        thumbnail: img ? (img.dataset.src || img.getAttribute('data-original') || img.src) : null,
        lastUpdate: updateEl ? updateEl.textContent.trim() : '',
        badge: badgeEl ? badgeEl.textContent.trim() : '',
      });
    });

    return items;
  });

  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Danh sách chapter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Lấy danh sách chapter từ trang manga
 * @returns {Array<{title, url, number, date}>}
 */
async function getChapterList(page, mangaUrl) {
  await navigateTo(page, mangaUrl);

  const result = await page.evaluate(() => {
    const chapters = [];

    // Selector cho list chapter
    const selectors = [
      '.serial-list .item',
      '.chapter-list li',
      '.list-item-view',
      'ul.list li',
      '.view-lst li',
    ];

    let found = null;
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        found = els;
        break;
      }
    }

    // Fallback: link chứa /webtoon/view/ với số
    if (!found || found.length === 0) {
      const links = document.querySelectorAll('a[href*="/webtoon/view/"]');
      links.forEach((link, i) => {
        const numMatch = link.href.match(/\/(\d+)(?:\?|$)/);
        chapters.push({
          title: link.textContent.trim().substring(0, 80),
          url: link.href,
          number: numMatch ? parseInt(numMatch[1]) : i,
          date: '',
        });
      });
      return chapters.reverse(); // Thường list từ mới → cũ, đảo lại
    }

    found.forEach((el, i) => {
      const link = el.querySelector('a');
      if (!link) return;

      const titleEl = el.querySelector('.title, .subject, .toon-subject, span');
      const dateEl = el.querySelector('.date, .num-date, time');
      const numEl = el.querySelector('.num, [class*="num"], .episode');
      const numMatch = link.href.match(/\/(\d+)(?:\?|$)/);

      chapters.push({
        title: titleEl ? titleEl.textContent.trim() : link.textContent.trim().substring(0, 80),
        url: link.href,
        number: numEl ? parseInt(numEl.textContent) : (numMatch ? parseInt(numMatch[1]) : i),
        date: dateEl ? dateEl.textContent.trim() : '',
      });
    });

    return chapters.reverse();
  });

  // Lấy thêm thông tin manga (title)
  const mangaTitle = await page.evaluate(() => {
    const selectors = ['.view-title', 'h1', '.subject', '.toon-title', '.title-subject'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.textContent.trim();
    }
    return document.title.split('|')[0].trim();
  });

  return { title: mangaTitle, chapters: result };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lấy ảnh từ chapter (logic từ NewtokiRipper-1.5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Lấy URLs ảnh từ chapter
 * Port từ hàm getImages() trong NewtokiRipper-1.5:
 * - Tìm img có data-* attribute chứa URL bắt đầu bằng https://img và chứa "newtoki"
 */
async function getImageUrls(page, chapterUrl) {
  await navigateTo(page, chapterUrl);

  // Scroll xuống để lazy-load ảnh
  await autoScroll(page);

  const imageUrls = await page.evaluate(() => {
    const imgs = [...document.getElementsByTagName('img')];

    const urls = imgs.flatMap((img) => {
      // Tìm data-* attribute có giá trị là URL ảnh (logic từ script gốc)
      const attrs = [...img.attributes];
      const dataAttr = attrs.find((a) => /^data-[a-zA-Z0-9]{1,20}/.test(a.name));
      const src = dataAttr?.value;

      if (src?.startsWith('https://img') && src?.includes('newtoki')) {
        return [src];
      }

      // Fallback: kiểm tra src trực tiếp
      const directSrc = img.src || img.dataset.src || img.dataset.original;
      if (directSrc?.startsWith('https://img') && directSrc?.includes('newtoki')) {
        return [directSrc];
      }

      // Fallback 2: bất kỳ data-* nào dạng URL ảnh
      for (const attr of attrs) {
        if (/^data-/.test(attr.name) && attr.value?.startsWith('http') && /\.(jpg|jpeg|png|webp)/.test(attr.value)) {
          return [attr.value];
        }
      }

      return [];
    });

    // Loại bỏ trùng lặp và giữ thứ tự
    return [...new Set(urls)];
  });

  // Lấy thông tin chapter
  const chapterInfo = await page.evaluate(() => {
    const titleEl = document.querySelector('.view-title, h1, .toon-title, .subject');
    return {
      title: titleEl ? titleEl.textContent.trim() : document.title.split('|')[0].trim(),
      url: window.location.href,
    };
  });

  return { ...chapterInfo, imageUrls };
}

/**
 * Auto scroll trang để trigger lazy loading
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const scrollHeight = document.body.scrollHeight;
      let totalScrolled = 0;
      const step = window.innerHeight;

      const timer = setInterval(() => {
        window.scrollBy(0, step);
        totalScrolled += step;
        if (totalScrolled >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 150);
    });
  });

  // Chờ lazy images load
  await page.waitForTimeout(1000);
}

module.exports = {
  setBaseUrl,
  getBaseUrl,
  findActiveNewtoki,
  searchManga,
  browseManga,
  getChapterList,
  getImageUrls,
};
