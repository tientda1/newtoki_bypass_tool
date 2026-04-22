/**
 * scraper.js — Newtoki Scraper (v2 — với CAPTCHA handling)
 *
 * Lấy danh sách truyện, chapters, và URL ảnh.
 * Logic ảnh từ NewtokiRipper-1.5 (data-* attribute trên <img>)
 * Tích hợp CAPTCHA detection + Ollama Gemma 4 fallback.
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
 * @param {Page} page
 * @param {number} startNum
 * @param {object} navOptions - options truyền vào navigateTo (ollamaModule, aiModel)
 */
async function findActiveNewtoki(page, startNum = 470, navOptions = {}) {
  for (let n = startNum; n >= 400; n--) {
    const url = `https://newtoki${n}.com/webtoon`;
    try {
      console.log(`  Thử ${url}...`);
      await navigateTo(page, url, { ...navOptions, timeout: 8000, maxRetries: 1 });
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
 * @param {Page} page
 * @param {string} keyword
 * @param {object} navOptions
 * @returns {Array<{title, url, author, genre, status, thumbnail}>}
 */
async function searchManga(page, keyword, navOptions = {}) {
  const base = getBaseUrl();
  if (!base) throw new Error('Chưa set base URL. Hãy dùng --domain hoặc --find-domain trước.');

  const searchUrl = `${base}/webtoon?stx=${encodeURIComponent(keyword)}`;
  await navigateTo(page, searchUrl, navOptions);

  const results = await page.evaluate(() => {
    const items = [];
    const seen = new Set();

    // Newtoki dùng /webtoon/12345 hoặc /webtoon/view/12345
    const links = [
      ...document.querySelectorAll('a[href*="/webtoon/view/"]'),
      ...document.querySelectorAll('a[href*="/webtoon/"]'),
    ];

    for (const link of links) {
      if (seen.has(link.href)) continue;
      // Phải có ít nhất 2 path segment (loại link nav /webtoon)
      const parts = new URL(link.href).pathname.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      seen.add(link.href);

      const container = link.closest('li, .item, article, div[class*="item"]') || link;
      const img = container.querySelector('img');
      const titleEl = container.querySelector('.subject, .title, h3, h4, [class*="subject"], [class*="title"]');
      const title = titleEl ? titleEl.textContent.trim() : link.textContent.trim().substring(0, 80);
      if (!title || title.length < 2) continue;

      items.push({
        title,
        url: link.href,
        thumbnail: img ? (img.dataset.src || img.dataset.original || img.getAttribute('data-src') || img.src) : null,
      });
    }
    return items;
  });

  return results;
}

/**
 * Duyệt trang đầu hoặc danh mục
 * @param {Page} page
 * @param {object} options
 * @param {object} navOptions
 */
async function browseManga(page, options = {}, navOptions = {}) {
  const base = getBaseUrl();
  if (!base) throw new Error('Chưa set base URL.');

  const { category = '', page: pageNum = 1 } = options;
  let url = `${base}/webtoon`;
  if (category) url += `?toon=${category}`;
  if (pageNum > 1) url += `${category ? '&' : '?'}page=${pageNum}`;

  await navigateTo(page, url, navOptions);

  // Chờ content load
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('a[href*="/webtoon/"]').length > 2,
      { timeout: 15000, polling: 1000 }
    );
  } catch { /* Chấp nhận nếu timeout */ }

  const results = await page.evaluate(() => {
    const items = [];
    const seen = new Set();

    // Newtoki dùng /webtoon/12345 hoặc /webtoon/view/12345
    const links = [
      ...document.querySelectorAll('a[href*="/webtoon/view/"]'),
      ...document.querySelectorAll('a[href*="/webtoon/"]'),
    ];

    for (const link of links) {
      if (seen.has(link.href)) continue;
      // Loại nav link chỉ có 1 segment (/webtoon)
      try {
        const parts = new URL(link.href).pathname.split('/').filter(Boolean);
        if (parts.length < 2) continue;
      } catch { continue; }
      seen.add(link.href);

      const container = link.closest('li, .item, article, .toon-item, div[class*="item"]') || link;
      const img = container.querySelector('img') || link.querySelector('img');
      const titleEl = container.querySelector(
        '.subject, .title, h3, h4, [class*="title"], [class*="subject"], [class*="toon"]'
      );
      const updateEl = container.querySelector('.update, .date, [class*="update"], time');

      const title = titleEl
        ? titleEl.textContent.trim()
        : link.textContent.trim().substring(0, 60);
      if (!title || title.length < 2) continue;

      items.push({
        title,
        url: link.href,
        thumbnail: img ? (img.dataset.src || img.getAttribute('data-original') || img.getAttribute('data-src') || img.src) : null,
        lastUpdate: updateEl ? updateEl.textContent.trim() : '',
      });
    }

    return items;
  });

  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Danh sách chapter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Lấy danh sách chapter từ trang manga
 * @param {Page} page
 * @param {string} mangaUrl
 * @param {object} navOptions
 * @returns {{ title: string, chapters: Array<{title, url, number, date}> }}
 */
async function getChapterList(page, mangaUrl, navOptions = {}) {
  await navigateTo(page, mangaUrl, navOptions);

  const result = await page.evaluate(() => {
    const chapters = [];
    const selectors = [
      '.serial-list .item',
      '.chapter-list li',
      '.list-item-view',
      '.list-item',
      'ul.list li',
      '.view-lst li',
    ];

    let found = null;
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) { found = els; break; }
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
      return chapters.reverse();
    }

    found.forEach((el, i) => {
      const link = el.querySelector('a');
      if (!link) return;
      const titleEl = el.querySelector('.title, .subject, .toon-subject, span');
      const dateEl  = el.querySelector('.date, .num-date, time');
      const numEl   = el.querySelector('.num, [class*="num"], .episode');
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
 * @param {Page} page
 * @param {string} chapterUrl
 * @param {object} navOptions
 * @returns {{ title: string, imageUrls: string[] }}
 */
async function getImageUrls(page, chapterUrl, navOptions = {}) {
  await navigateTo(page, chapterUrl, navOptions);

  // Scroll xuống để lazy-load ảnh
  await autoScroll(page);

  const imageUrls = await page.evaluate(() => {
    const imgs = [...document.getElementsByTagName('img')];

    const urls = imgs.flatMap((img) => {
      // data-* attribute có giá trị là URL ảnh (từ NewtokiRipper-1.5)
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
        if (/^data-/.test(attr.name) && attr.value?.startsWith('http') && /\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
          return [attr.value];
        }
      }

      return [];
    });

    return [...new Set(urls)];
  });

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
