#!/usr/bin/env node
/**
 * newtoki-cli.js — Newtoki CLI (Playwright + Ollama + Gemma 4)
 *
 * Kiến trúc:
 *   - Playwright stealth → scrape trực tiếp (không cần Extension)
 *   - Ollama + Gemma 4 multimodal → tự động giải CAPTCHA
 *
 * Usage:
 *   node newtoki-cli.js browse [--domain newtoki469.com]
 *   node newtoki-cli.js search <keyword>
 *   node newtoki-cli.js chapters <manga-url>
 *   node newtoki-cli.js download <chapter-url> [--output ./downloads]
 *   node newtoki-cli.js download-all <manga-url> [--from 1] [--to 10]
 *
 * AI flags:
 *   --ai-captcha           Bật Gemma 4 tự động giải CAPTCHA
 *   --model <name>         Ollama model (mặc định: gemma4)
 *
 * Browser flags:
 *   --no-headless          Mở browser có giao diện
 *   --domain <domain>      Chỉ định domain Newtoki
 *   --output <dir>         Thư mục lưu file
 */

'use strict';

const { Command } = require('commander');
const chalk  = require('chalk');
const ora    = require('ora');
const Table  = require('cli-table3');
const path   = require('path');

const { createBrowserContext, createPage, debugDumpHtml } = require('./browser');
const {
  setBaseUrl,
  getBaseUrl,
  findActiveNewtoki,
  searchManga,
  browseManga,
  getChapterList,
  getImageUrls,
} = require('./scraper');
const { downloadToZip, downloadToFolder, sanitizeFilename } = require('./downloader');
const ollama      = require('./ollama');
const httpScraper = require('./http-scraper');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Banner
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function printBanner() {
  console.log(chalk.bold.hex('#FF6B6B')(`
  ███╗   ██╗███████╗██╗    ██╗████████╗ ██████╗ ██╗  ██╗██╗
  ████╗  ██║██╔════╝██║    ██║╚══██╔══╝██╔═══██╗██║ ██╔╝██║
  ██╔██╗ ██║█████╗  ██║ █╗ ██║   ██║   ██║   ██║█████╔╝ ██║
  ██║╚██╗██║██╔══╝  ██║███╗██║   ██║   ██║   ██║██╔═██╗ ██║
  ██║ ╚████║███████╗╚███╔███╔╝   ██║   ╚██████╔╝██║  ██╗██║
  ╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝    ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝`));
  console.log(chalk.hex('#888')('  Newtoki Tool v3.0 — Playwright + Ollama Gemma 4\n'));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Kiểm tra Ollama + model, hiển thị trạng thái
 * @param {string} modelName
 * @returns {boolean} true nếu sẵn sàng
 */
async function checkAI(modelName) {
  const spinner = ora(`Kiểm tra Ollama (${chalk.cyan(modelName)})...`).start();
  const { ok, hasModel, availableModels } = await ollama.checkOllama(modelName);

  if (!ok) {
    spinner.fail(chalk.red('Ollama không chạy tại localhost:11434'));
    console.log(chalk.yellow('  → Khởi động Ollama: ') + chalk.cyan('ollama serve'));
    return false;
  }

  if (!hasModel) {
    spinner.warn(chalk.yellow(`Model "${modelName}" chưa có`));
    ollama.printPullHint(modelName);
    if (availableModels.length > 0) {
      console.log(chalk.gray(`  Models hiện có: ${availableModels.join(', ')}`));
    }
    return false;
  }

  spinner.succeed(
    chalk.green(`Ollama ✓`) +
    chalk.gray(` | Model: `) +
    chalk.cyan(modelName) +
    chalk.gray(` | Multimodal CAPTCHA: `) +
    chalk.green('bật')
  );
  return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Browser setup
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Khởi tạo browser + set domain
 * @param {object} globalOpts - từ commander
 * @param {object} aiModule   - ollama module hoặc null
 * @returns {{ context, page, navOptions }}
 */
async function setupBrowser(globalOpts, aiModule = null) {
  const headless = globalOpts.headless !== false;
  const spinner = ora('Khởi động Playwright browser...').start();

  const context = await createBrowserContext(headless, {
    targetDomain: globalOpts.domain || '',
    useRealProfile: !!globalOpts.useRealProfile,
  });
  const page    = await createPage(context);

  spinner.succeed(
    'Browser sẵn sàng' +
    (headless ? '' : chalk.yellow(' (có giao diện)')) +
    chalk.gray(' | stealth mode')
  );

  // navOptions truyền vào scraper để handle CAPTCHA
  const navOptions = {
    ollamaModule: aiModule,
    aiModel: globalOpts.model || ollama.DEFAULT_MODEL,
    headless,   // false = có giao diện → navigateTo sẽ đợi user giải tay
  };

  // Set domain
  if (globalOpts.domain) {
    const domain = globalOpts.domain.startsWith('http')
      ? globalOpts.domain
      : `https://${globalOpts.domain}`;
    setBaseUrl(domain);
    console.log(chalk.cyan(`  Domain: ${domain}`));
  } else if (!globalOpts.skipDomainCheck) {
    const spinner2 = ora('Tìm domain Newtoki đang hoạt động...').start();
    try {
      const found = await findActiveNewtoki(page, 470, navOptions);
      spinner2.succeed(`Domain: ${chalk.cyan(found)}`);
    } catch (err) {
      spinner2.fail(err.message);
      await context.close();
      process.exit(1);
    }
  }

  return { context, page, navOptions };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Display helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function printMangaTable(items) {
  if (!items || !items.length) {
    console.log(chalk.yellow('  Không có kết quả.'));
    return;
  }
  const t = new Table({
    head: [chalk.white('#'), chalk.white('Tên truyện'), chalk.white('URL')],
    colWidths: [4, 48, 55],
    style: { border: ['gray'] },
    wordWrap: true,
  });
  items.forEach((item, i) => {
    t.push([
      chalk.gray(i + 1),
      chalk.hex('#4FC3F7')(item.title || '?'),
      chalk.gray((item.url || '').substring(0, 53)),
    ]);
  });
  console.log(t.toString());
  console.log(chalk.gray(`\n  Tổng: ${items.length} truyện\n`));
}

function printChapterTable(chapters) {
  if (!chapters || !chapters.length) {
    console.log(chalk.yellow('  Không có chapter.'));
    return;
  }
  const t = new Table({
    head: [chalk.white('#'), chalk.white('Chapter'), chalk.white('Ngày'), chalk.white('URL')],
    colWidths: [4, 50, 12, 50],
    style: { border: ['gray'] },
    wordWrap: true,
  });
  chapters.forEach((ch, i) => {
    t.push([
      chalk.gray(i + 1),
      chalk.hex('#4FC3F7')(ch.title || `Ch.${i + 1}`),
      chalk.gray(ch.date || ''),
      chalk.gray((ch.url || '').substring(0, 48)),
    ]);
  });
  console.log(t.toString());
  console.log(chalk.gray(`\n  Tổng: ${chapters.length} chapter\n`));
}

function drawProgressBar(done, total, width = 32) {
  const pct    = total > 0 ? done / total : 0;
  const filled = Math.round(pct * width);
  const bar    = chalk.hex('#FF6B6B')('█'.repeat(filled)) + chalk.gray('░'.repeat(width - filled));
  const pctStr = (pct * 100).toFixed(1).padStart(5);
  process.stdout.write(`\r  [${bar}] ${pctStr}% ${done}/${total}  `);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLI Program
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const program = new Command();

program
  .name('newtoki')
  .description('Newtoki Manga Downloader — HTTP + Playwright + Ollama Gemma 4')
  .version('3.1.0')
  .option('--domain <domain>',     'Chỉ định domain Newtoki (vd: newtoki469.com)')
  .option('--no-headless',         'Mở browser có giao diện (dùng khi debug CAPTCHA)')
  .option('--output <dir>',        'Thư mục lưu file', './downloads')
  .option('--ai-captcha',          'Bật Ollama Gemma 4 tự động giải CAPTCHA')
  .option('--model <name>',        'Ollama model name', 'gemma4')
  .option('--use-real-profile',    'Dùng Chrome User Data thật (đóng Chrome trước!) — bypass CF fingerprint')
  .option('--browser',             'Buộc dùng Playwright browser thay vì HTTP request');

// ─── BROWSE ──────────────────────────────────────────────────────────────────

program
  .command('browse')
  .description('Xem danh sách truyện trang chủ')
  .option('--page <n>', 'Số trang', '1')
  .option('--category <cat>', 'Danh mục (toon ID)')
  .action(async (opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    const domain = globalOpts.domain || 'newtoki469.com';
    const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    setBaseUrl(baseUrl);

    // ── HTTP mode (mặc định) ────────────────────────────────────────────────
    if (!globalOpts.browser) {
      const spinner = ora('Đang tải danh sách truyện (HTTP mode)...').start();
      try {
        const results = await httpScraper.browseOrSearch(baseUrl, {
          page:     parseInt(opts.page) || 1,
          category: opts.category || '',
        });
        spinner.succeed(`Trang ${opts.page}: ${chalk.cyan(results.length)} truyện`);
        printMangaTable(results);
        return;
      } catch (err) {
        spinner.fail(chalk.red('HTTP mode thất bại: ' + err.message.split('\n')[0]));
        console.log(chalk.yellow('  → Failback sang browser mode...'));
      }
    }

    // ── Browser fallback ───────────────────────────────────────────────────
    let aiModule = null;
    if (globalOpts.aiCaptcha) {
      const ok = await checkAI(globalOpts.model);
      if (ok) aiModule = ollama;
    }
    const { context, page, navOptions } = await setupBrowser(globalOpts, aiModule);
    try {
      const spinner = ora('Đang tải danh sách truyện (browser mode)...').start();
      const results = await browseManga(page, {
        category: opts.category || '',
        page:     parseInt(opts.page) || 1,
      }, navOptions);
      spinner.succeed(`Trang ${opts.page}: ${chalk.cyan(results.length)} truyện`);
      printMangaTable(results);
    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
    } finally {
      await context.close();
    }
  });

// ─── DEBUG-BROWSE ─────────────────────────────────────────────────────────────

program
  .command('debug-browse [url]')
  .description('Debug: mở trang webtoon và dump HTML để tìm selector đúng')
  .option('--page <n>', 'Số trang', '1')
  .action(async (url, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();

    const { context, page, navOptions } = await setupBrowser(globalOpts, null);

    try {
      const base = require('./scraper').getBaseUrl();
      const targetUrl  = url || `${base}/webtoon`;
      console.log(chalk.cyan(`  Đang navigate tới: ${targetUrl}`));

      const { navigateTo } = require('./browser');
      await navigateTo(page, targetUrl, { ...navOptions, headless: false });

      const dumpFile = path.join(process.cwd(), 'debug-dump.html');
      await debugDumpHtml(page, dumpFile);

      // Đếm thử các selector phổ biến
      const selectorCounts = await page.evaluate(() => {
        const selectors = [
          'a[href*="/webtoon/"]',
          'a[href*="/webtoon/view/"]',
          '.section-list li',
          '.webtoon-list li',
          '.list-item',
          '.item',
          'article',
          '#content',
          '.toon-list',
          '.lst-content',
          'ul.list li',
          '.row-list li',
        ];
        const result = {};
        for (const sel of selectors) {
          result[sel] = document.querySelectorAll(sel).length;
        }
        return result;
      });

      console.log(chalk.bold('\n  Selector counts:'));
      for (const [sel, count] of Object.entries(selectorCounts)) {
        const color = count > 0 ? chalk.green : chalk.gray;
        console.log(color(`    ${String(count).padStart(4)}  ${sel}`));
      }

      console.log(chalk.green(`\n  ✓ HTML đã lưu → ${dumpFile}`));
      console.log(chalk.gray('  Mở file đó để xem cấu trúc thực tế của trang.\n'));

    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
      console.error(chalk.gray(err.stack));
    } finally {
      await context.close();
    }
  });

program
  .command('search <keyword>')
  .description('Tìm kiếm truyện theo từ khóa')
  .action(async (keyword, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    const domain  = globalOpts.domain || 'newtoki469.com';
    const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    setBaseUrl(baseUrl);

    // ── HTTP mode (mặc định) ───────────────────────────────────────────────
    if (!globalOpts.browser) {
      const spinner = ora(`Tìm kiếm: "${chalk.cyan(keyword)}" (HTTP mode)...`).start();
      try {
        const results = await httpScraper.browseOrSearch(baseUrl, { keyword });
        spinner.succeed(`${chalk.cyan(results.length)} kết quả cho "${keyword}":`);
        printMangaTable(results);
        return;
      } catch (err) {
        spinner.fail(chalk.red('HTTP mode thất bại: ' + err.message.split('\n')[0]));
        console.log(chalk.yellow('  → Failback sang browser mode...'));
      }
    }

    // ── Browser fallback ───────────────────────────────────────────────────
    let aiModule = null;
    if (globalOpts.aiCaptcha) {
      const ok = await checkAI(globalOpts.model);
      if (ok) aiModule = ollama;
    }
    const { context, page, navOptions } = await setupBrowser(globalOpts, aiModule);
    try {
      const spinner = ora(`Tìm kiếm: "${chalk.cyan(keyword)}" (browser)...`).start();
      const results = await searchManga(page, keyword, navOptions);
      spinner.succeed(`${chalk.cyan(results.length)} kết quả cho "${keyword}":`);
      printMangaTable(results);
    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
    } finally {
      await context.close();
    }
  });

// ─── GET-COOKIES ─────────────────────────────────────────────────────────────

program
  .command('get-cookies')
  .description('Lấy cf_clearance từ Chrome thật (không có automation banner)')
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent.opts();
    const domain = globalOpts.domain || 'newtoki469.com';
    console.log(chalk.cyan(`\n  Mở Chrome thật để lấy cookies cho ${domain}...\n`));
    const { spawnSync } = require('child_process');
    spawnSync('node', ['get-real-cookies.js', domain], {
      cwd: __dirname,
      stdio: 'inherit',
    });
    process.exit(0);
  });

// ─── CHAPTERS ────────────────────────────────────────────────────────────────

program
  .command('chapters <manga-url>')
  .description('Xem danh sách chapter của một truyện')
  .action(async (mangaUrl, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();

    // Auto-detect domain từ URL
    if (mangaUrl.startsWith('http') && !globalOpts.domain) {
      const m = mangaUrl.match(/https?:\/\/(newtoki\d+\.com)/);
      if (m) { globalOpts.domain = m[1]; globalOpts.skipDomainCheck = true; }
    }

    let aiModule = null;
    if (globalOpts.aiCaptcha) {
      const ok = await checkAI(globalOpts.model);
      if (ok) aiModule = ollama;
    }

    const { context, page, navOptions } = await setupBrowser(globalOpts, aiModule);

    try {
      const spinner = ora('Đang lấy danh sách chapter...').start();
      const { title, chapters } = await getChapterList(page, mangaUrl, navOptions);
      spinner.succeed(`"${chalk.hex('#4FC3F7')(title)}" — ${chalk.cyan(chapters.length)} chapter:`);
      printChapterTable(chapters);
    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
      console.error(chalk.gray(err.stack));
    } finally {
      await context.close();
    }
  });

// ─── DOWNLOAD ────────────────────────────────────────────────────────────────

program
  .command('download <chapter-url>')
  .description('Tải một chapter thành ZIP')
  .option('--no-zip',            'Lưu ảnh vào thư mục thay vì ZIP')
  .option('--concurrency <n>',   'Số ảnh tải đồng thời', '5')
  .action(async (chapterUrl, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();

    if (chapterUrl.startsWith('http') && !globalOpts.domain) {
      const m = chapterUrl.match(/https?:\/\/(newtoki\d+\.com)/);
      if (m) { globalOpts.domain = m[1]; globalOpts.skipDomainCheck = true; }
    }

    let aiModule = null;
    if (globalOpts.aiCaptcha) {
      const ok = await checkAI(globalOpts.model);
      if (ok) aiModule = ollama;
    }

    const { context, page, navOptions } = await setupBrowser(globalOpts, aiModule);

    try {
      // Lấy URL ảnh
      let spinner = ora('Đang mở chapter và lấy URL ảnh...').start();
      const { title, imageUrls } = await getImageUrls(page, chapterUrl, navOptions);
      spinner.succeed(`Tìm thấy ${chalk.cyan(imageUrls.length)} ảnh: "${chalk.hex('#4FC3F7')(title)}"`);

      if (!imageUrls.length) {
        console.log(chalk.yellow('  Không tìm thấy ảnh. Thử --no-headless để xem trang thực tế.'));
        return;
      }

      // Tải ảnh
      const safeTitle    = sanitizeFilename(title);
      const outputDir    = globalOpts.output || './downloads';
      const useZip       = opts.zip !== false;
      const concurrency  = parseInt(opts.concurrency) || 5;
      const referer      = chapterUrl.match(/https?:\/\/[^/]+/)?.[0] + '/';

      console.log(chalk.gray(`\n  Chế độ: ${useZip ? 'ZIP' : 'Thư mục'}`));
      console.log(chalk.gray(`  Output: ${outputDir}\n`));

      const outputPath = useZip
        ? path.join(outputDir, `${safeTitle}.zip`)
        : path.join(outputDir, safeTitle);

      let result;
      if (useZip) {
        result = await downloadToZip(imageUrls, outputPath, {
          concurrency, referer,
          onProgress: drawProgressBar,
        });
      } else {
        result = await downloadToFolder(imageUrls, outputPath, {
          concurrency, referer,
          onProgress: drawProgressBar,
        });
      }

      console.log('');
      if (result.failCount > 0) {
        console.log(chalk.yellow(`  ⚠ ${result.failCount} ảnh thất bại`));
      }
      console.log(chalk.green(`\n  ✓ Đã lưu: ${result.outputPath || result.outputDir}`));
      console.log(chalk.gray(`  Thành công: ${result.successCount}/${imageUrls.length}\n`));

    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
      console.error(chalk.gray(err.stack));
    } finally {
      await context.close();
    }
  });

// ─── DOWNLOAD ALL ────────────────────────────────────────────────────────────

program
  .command('download-all <manga-url>')
  .description('Tải tất cả chapter của một truyện')
  .option('--from <n>',          'Bắt đầu từ chapter thứ n', '1')
  .option('--to <n>',            'Đến chapter thứ n')
  .option('--concurrency <n>',   'Số ảnh đồng thời mỗi chapter', '5')
  .option('--delay <ms>',        'Delay giữa các chapter (ms)', '2000')
  .option('--no-zip',            'Lưu ảnh vào thư mục thay vì ZIP')
  .action(async (mangaUrl, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();

    if (mangaUrl.startsWith('http') && !globalOpts.domain) {
      const m = mangaUrl.match(/https?:\/\/(newtoki\d+\.com)/);
      if (m) { globalOpts.domain = m[1]; globalOpts.skipDomainCheck = true; }
    }

    let aiModule = null;
    if (globalOpts.aiCaptcha) {
      const ok = await checkAI(globalOpts.model);
      if (ok) aiModule = ollama;
    }

    const { context, page, navOptions } = await setupBrowser(globalOpts, aiModule);

    try {
      // Bước 1: lấy chapter list
      let spinner = ora('Đang lấy danh sách chapter...').start();
      const { title: mangaTitle, chapters } = await getChapterList(page, mangaUrl, navOptions);
      spinner.succeed(`"${chalk.hex('#4FC3F7')(mangaTitle)}" — ${chalk.cyan(chapters.length)} chapter`);

      if (!chapters.length) {
        console.log(chalk.yellow('  Không có chapter nào.'));
        return;
      }

      // Chọn range
      const fromIdx = Math.max(0, parseInt(opts.from || '1') - 1);
      const toIdx   = opts.to
        ? Math.min(chapters.length - 1, parseInt(opts.to) - 1)
        : chapters.length - 1;
      const selected = chapters.slice(fromIdx, toIdx + 1);

      console.log(chalk.gray(`  Sẽ tải ${chalk.white(selected.length)} chapter (${fromIdx + 1} → ${toIdx + 1})\n`));

      const outputBase  = path.join(globalOpts.output || './downloads', sanitizeFilename(mangaTitle));
      const concurrency = parseInt(opts.concurrency) || 5;
      const delay       = parseInt(opts.delay) || 2000;
      const useZip      = opts.zip !== false;

      let ok = 0, fail = 0;

      for (let i = 0; i < selected.length; i++) {
        const ch         = selected[i];
        const chapterNum = String(fromIdx + i + 1).padStart(4, '0');
        const label      = `[${i + 1}/${selected.length}] ${ch.title || ch.url}`;

        console.log(chalk.white(`\n  ${label}`));

        try {
          spinner = ora('  Lấy URL ảnh...').start();
          const { title: chTitle, imageUrls } = await getImageUrls(page, ch.url, navOptions);
          spinner.succeed(`  ${chalk.cyan(imageUrls.length)} ảnh`);

          if (!imageUrls.length) {
            console.log(chalk.yellow('  → Không có ảnh, bỏ qua'));
            fail++; continue;
          }

          const safeChTitle = `${chapterNum}_${sanitizeFilename(chTitle || ch.title)}`;
          const referer     = ch.url.match(/https?:\/\/[^/]+/)?.[0] + '/';

          let result;
          if (useZip) {
            result = await downloadToZip(imageUrls, path.join(outputBase, `${safeChTitle}.zip`), {
              concurrency, referer, onProgress: drawProgressBar,
            });
          } else {
            result = await downloadToFolder(imageUrls, path.join(outputBase, safeChTitle), {
              concurrency, referer, onProgress: drawProgressBar,
            });
          }

          console.log('');
          if (result.failCount > 0) {
            console.log(chalk.yellow(`  ⚠ ${result.failCount} ảnh thất bại`));
          }
          console.log(chalk.green(`  ✓ OK (${result.successCount}/${imageUrls.length})`));
          ok++;

          if (i < selected.length - 1) {
            await page.waitForTimeout(delay);
          }

        } catch (err) {
          console.log(chalk.red(`  ✗ Lỗi: ${err.message}`));
          fail++;
        }
      }

      // Summary
      console.log(chalk.bold('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.green(`  ✓ Thành công: ${ok} chapter`));
      if (fail) console.log(chalk.red(`  ✗ Thất bại:  ${fail} chapter`));
      console.log(chalk.gray(`  Output: ${outputBase}\n`));

    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
      console.error(chalk.gray(err.stack));
    } finally {
      await context.close();
    }
  });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Run
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('Fatal: ' + err.message));
  process.exit(1);
});
