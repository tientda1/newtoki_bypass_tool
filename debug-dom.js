/**
 * debug-dom.js — Xem DOM thực tế của Newtoki để tìm đúng selector
 */
'use strict';

const { createBrowserContext, createPage } = require('./browser');

async function main() {
  const context = await createBrowserContext(false); // headless: false để thấy trang
  const page = await createPage(context);

  console.log('Đang mở newtoki468.com...');
  await page.goto('https://newtoki468.com/webtoon', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  console.log('Title:', await page.title());
  console.log('Đang chờ Cloudflare Turnstile pass... (tối đa 60 giây)');
  console.log('Nếu thấy CAPTCHA trong browser, hãy tự click vào checkbox!');

  try {
    // Chờ cho đến khi trang chứa link thực (không còn CF challenge)
    await page.waitForFunction(
      () => {
        const title = document.title;
        const hasCF = ['Just a moment', '잠시만 기다리십시오', 'Please Wait', 'Verifying']
          .some(t => title.toLowerCase().includes(t.toLowerCase()));
        const hasContent = document.querySelectorAll('a[href*="/webtoon/"]').length > 0;
        return !hasCF && hasContent;
      },
      { timeout: 60000, polling: 1000 }
    );
    console.log('Cloudflare passed! Lấy DOM...');
  } catch {
    console.log('Timeout, thử lấy DOM dù sao...');
  }

  await page.waitForTimeout(2000);

  // Lấy toàn bộ HTML để phân tích
  const debug = await page.evaluate(() => {
    // Lấy tất cả các link dạng /webtoon/view/
    const links = [...document.querySelectorAll('a')].filter(a => a.href.includes('/webtoon/view/'));
    
    // Lấy tất cả class names xuất hiện trong page để tìm selector đúng
    const allClasses = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      el.className.split(' ').forEach(c => c && allClasses.add(c));
    });

    // Sample HTML của phần danh sách
    const listSection = document.querySelector('main, #content, .content, .container, body');
    const sampleHtml = listSection ? listSection.innerHTML.substring(0, 5000) : 'NOT FOUND';

    return {
      title: document.title,
      url: window.location.href,
      linkCount: links.length,
      sampleLinks: links.slice(0, 5).map(a => ({
        href: a.href,
        text: a.textContent.trim().substring(0, 50),
        parentClass: a.parentElement?.className,
        parentTag: a.parentElement?.tagName,
      })),
      classes: [...allClasses].slice(0, 100),
      sampleHtml: sampleHtml.substring(0, 3000),
    };
  });

  console.log('\n=== PAGE INFO ===');
  console.log('Title:', debug.title);
  console.log('URL:', debug.url);
  console.log('Links found:', debug.linkCount);
  console.log('\n=== SAMPLE LINKS ===');
  debug.sampleLinks.forEach((l, i) => {
    console.log(`[${i+1}] ${l.text}`);
    console.log(`     href: ${l.href}`);
    console.log(`     parent: <${l.parentTag} class="${l.parentClass}">`);
  });
  console.log('\n=== CLASSES (first 50) ===');
  console.log(debug.classes.slice(0, 50).join(', '));
  console.log('\n=== SAMPLE HTML (first 3000 chars) ===');
  console.log(debug.sampleHtml);

  await context.close();
}

main().catch(console.error);
