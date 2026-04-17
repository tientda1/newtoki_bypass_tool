// content.js — Chạy trên mỗi trang newtoki
// Tự động scrape data và gửi về server qua background

const SERVER = 'http://localhost:27420';

function getImages() {
  return [...document.getElementsByTagName('img')].flatMap((img) => {
    const attrs = [...img.attributes];
    const dataAttr = attrs.find((a) => /^data-[a-zA-Z0-9]{1,20}/.test(a.name));
    const src = dataAttr?.value;
    if (src?.startsWith('https://img') && src?.includes('newtoki')) return [src];
    const direct = img.src || img.dataset?.src || img.dataset?.original;
    if (direct?.startsWith('https://img') && direct?.includes('newtoki')) return [direct];
    return [];
  });
}

function getMangaList() {
  const items = [];
  const seen = new Set();
  document.querySelectorAll('a[href*="/webtoon/view/"]').forEach((link) => {
    if (seen.has(link.href)) return;
    seen.add(link.href);
    const container = link.closest('li, .item, article, div[class*="item"]') || link;
    const img = container.querySelector('img');
    const titleEl = container.querySelector('.subject, .title, h3, h4, [class*="subject"], [class*="title"]');
    const title = titleEl ? titleEl.textContent.trim() : link.textContent.trim().substring(0, 80);
    if (!title) return;
    items.push({
      title,
      url: link.href,
      thumbnail: img ? (img.dataset.src || img.dataset.original || img.src) : null,
    });
  });
  return items;
}

function getChapters() {
  const chapters = [];
  const seen = new Set();
  document.querySelectorAll('a[href*="/webtoon/view/"]').forEach((link, i) => {
    if (seen.has(link.href)) return;
    seen.add(link.href);
    const container = link.closest('li, .item, tr') || link;
    const titleEl = container.querySelector('.title, .subject, span');
    const dateEl  = container.querySelector('.date, time, .num-date');
    chapters.push({
      title: titleEl ? titleEl.textContent.trim() : link.textContent.trim().substring(0, 80),
      url:   link.href,
      date:  dateEl ? dateEl.textContent.trim() : '',
      index: i,
    });
  });
  return chapters;
}

async function scrapeAndSend() {
  const url  = window.location.href;
  const path = window.location.pathname;

  let data = { type: 'unknown', url };

  if (path.includes('/webtoon/view/') && /\/\d+\/?$/.test(path.replace(/\?.*/, ''))) {
    // Chapter page — lấy ảnh
    // Scroll để lazy load
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 600) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 500));

    data = {
      type:      'chapter',
      url,
      title:     document.title.split('|')[0].trim(),
      imageUrls: [...new Set(getImages())],
    };
  } else if (path.includes('/webtoon/view/')) {
    // Manga detail page — lấy chapter list
    data = {
      type:     'manga',
      url,
      title:    document.querySelector('.view-title, h1, .subject')?.textContent.trim() || document.title.split('|')[0].trim(),
      chapters: getChapters(),
    };
  } else if (path.includes('/webtoon')) {
    // List page — lấy manga list
    data = {
      type:  'list',
      url,
      items: getMangaList(),
    };
  }

  // Gửi về server
  try {
    await fetch(`${SERVER}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    // Server chưa chạy — ignore
  }
}

// Poll server xem có lệnh navigate không
async function pollCommand() {
  try {
    const res = await fetch(`${SERVER}/command`, { signal: AbortSignal.timeout(3000) });
    const cmd = await res.json();
    if (cmd && cmd.navigate && cmd.navigate !== window.location.href) {
      window.location.href = cmd.navigate;
      return;
    }
    if (cmd && cmd.scrape) {
      await scrapeAndSend();
    }
  } catch {
    // Server chưa chạy
  }
}

// Chạy ngay khi trang load xong
(async () => {
  await new Promise(r => setTimeout(r, 1500)); // chờ lazy content
  await scrapeAndSend();

  // Poll mỗi 2 giây
  setInterval(pollCommand, 2000);
})();
