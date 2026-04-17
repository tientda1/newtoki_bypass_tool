#!/usr/bin/env node
/**
 * index.js — Newtoki Downloader CLI
 *
 * Usage:
 *   node index.js search <keyword>
 *   node index.js browse [--category <cat>] [--page <n>]
 *   node index.js chapters <manga-url>
 *   node index.js download <chapter-url> [--output <dir>] [--no-zip]
 *   node index.js download-all <manga-url> [--output <dir>] [--from <n>] [--to <n>]
 */

'use strict';

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const Table = require('cli-table3');
const path = require('path');

const { createBrowserContext, createPage } = require('./browser');
const {
  setBaseUrl,
  findActiveNewtoki,
  searchManga,
  browseManga,
  getChapterList,
  getImageUrls,
} = require('./scraper');
const { downloadToZip, downloadToFolder, sanitizeFilename } = require('./downloader');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Banner
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function printBanner() {
  console.log(chalk.red.bold(`
  ███╗   ██╗███████╗██╗    ██╗████████╗ ██████╗ ██╗  ██╗██╗
  ████╗  ██║██╔════╝██║    ██║╚══██╔══╝██╔═══██╗██║ ██╔╝██║
  ██╔██╗ ██║█████╗  ██║ █╗ ██║   ██║   ██║   ██║█████╔╝ ██║
  ██║╚██╗██║██╔══╝  ██║███╗██║   ██║   ██║   ██║██╔═██╗ ██║
  ██║ ╚████║███████╗╚███╔███╔╝   ██║   ╚██████╔╝██║  ██╗██║
  ╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝    ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝`));
  console.log(chalk.gray('  Newtoki Manga Downloader v1.0 — Playwright Edition\n'));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function setupBrowser(opts) {
  const headless = opts.headless !== false && !opts.noHeadless;
  const spinner = ora('Khởi động browser...').start();

  const context = await createBrowserContext(headless);
  const page = await createPage(context);
  spinner.succeed('Browser sẵn sàng' + (headless ? '' : chalk.yellow(' (có giao diện)')));

  // Set domain
  if (opts.domain) {
    const domain = opts.domain.startsWith('http') ? opts.domain : `https://${opts.domain}`;
    setBaseUrl(domain);
    console.log(chalk.cyan(`  Domain: ${domain}`));
  } else if (!opts.skipDomainCheck) {
    const spinner2 = ora('Tìm domain Newtoki đang hoạt động...').start();
    try {
      const found = await findActiveNewtoki(page);
      spinner2.succeed(`Domain: ${chalk.cyan(found)}`);
    } catch (err) {
      spinner2.fail(err.message);
      await context.close();
      process.exit(1);
    }
  }

  return { context, page };
}

function printMangaTable(items) {
  if (!items.length) {
    console.log(chalk.yellow('  Không tìm thấy kết quả nào.'));
    return;
  }

  const table = new Table({
    head: [chalk.white('#'), chalk.white('Tên truyện'), chalk.white('URL')],
    colWidths: [4, 45, 60],
    style: { border: ['gray'] },
    wordWrap: true,
  });

  items.forEach((item, i) => {
    table.push([
      chalk.gray(i + 1),
      chalk.cyan(item.title || '(không có tên)'),
      chalk.gray(item.url ? item.url.substring(0, 58) : ''),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.gray(`\n  Tổng: ${items.length} truyện\n`));
}

function printChapterTable(chapters) {
  if (!chapters.length) {
    console.log(chalk.yellow('  Không có chapter nào.'));
    return;
  }

  const table = new Table({
    head: [chalk.white('#'), chalk.white('Chapter'), chalk.white('Ngày'), chalk.white('URL')],
    colWidths: [5, 50, 12, 55],
    style: { border: ['gray'] },
    wordWrap: true,
  });

  chapters.forEach((ch, i) => {
    table.push([
      chalk.gray(i + 1),
      chalk.cyan(ch.title || `Chapter ${ch.number}`),
      chalk.gray(ch.date || ''),
      chalk.gray(ch.url ? ch.url.substring(0, 53) : ''),
    ]);
  });

  console.log(table.toString());
  console.log(chalk.gray(`\n  Tổng: ${chapters.length} chapter\n`));
}

function drawProgressBar(done, total, width = 30) {
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * width);
  const bar = chalk.red('█'.repeat(filled)) + chalk.gray('░'.repeat(width - filled));
  const percent = (pct * 100).toFixed(1).padStart(5);
  process.stdout.write(`\r  [${bar}] ${percent}% ${done}/${total}  `);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLI Commands
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const program = new Command();

program
  .name('newtoki')
  .description('Tìm kiếm và tải truyện từ Newtoki')
  .version('1.0.0')
  .option('--domain <url>', 'Chỉ định domain Newtoki (vd: newtoki469.com)')
  .option('--no-headless', 'Mở browser có giao diện (dùng khi bị block CAPTCHA)')
  .option('--output <dir>', 'Thư mục lưu file (mặc định: ./downloads)', './downloads');

// ─── SEARCH ──────────────────────────────────────────

program
  .command('search <keyword>')
  .description('Tìm kiếm truyện theo từ khóa')
  .action(async (keyword, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    const { context, page } = await setupBrowser(globalOpts);

    try {
      const spinner = ora(`Tìm kiếm: "${keyword}"`).start();
      const results = await searchManga(page, keyword);
      spinner.succeed(`Kết quả tìm kiếm cho "${chalk.cyan(keyword)}":`);
      printMangaTable(results);
    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
    } finally {
      await context.close();
    }
  });

// ─── BROWSE ──────────────────────────────────────────

program
  .command('browse')
  .description('Xem danh sách truyện trên trang chủ')
  .option('--category <cat>', 'Danh mục (vd: 0=tất cả, 1=완결, 2=주간...)')
  .option('--page <n>', 'Số trang', '1')
  .action(async (opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    const { context, page } = await setupBrowser(globalOpts);

    try {
      const spinner = ora('Đang tải danh sách truyện...').start();
      const results = await browseManga(page, {
        category: opts.category || '',
        page: parseInt(opts.page) || 1,
      });
      spinner.succeed(`Danh sách truyện (trang ${opts.page}):`);
      printMangaTable(results);
    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
    } finally {
      await context.close();
    }
  });

// ─── CHAPTERS ────────────────────────────────────────

program
  .command('chapters <manga-url>')
  .description('Xem danh sách chapter của một truyện')
  .action(async (mangaUrl, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    // Nếu có domain trong URL, tự động set
    if (mangaUrl.startsWith('http') && !globalOpts.domain) {
      const match = mangaUrl.match(/https?:\/\/(newtoki\d+\.com)/);
      if (match) {
        globalOpts.domain = match[1];
        globalOpts.skipDomainCheck = true;
      }
    }
    const { context, page } = await setupBrowser(globalOpts);

    try {
      const spinner = ora('Đang lấy danh sách chapter...').start();
      const { title, chapters } = await getChapterList(page, mangaUrl);
      spinner.succeed(`"${chalk.cyan(title)}" — ${chapters.length} chapter:`);
      printChapterTable(chapters);
    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
    } finally {
      await context.close();
    }
  });

// ─── DOWNLOAD ────────────────────────────────────────

program
  .command('download <chapter-url>')
  .description('Tải một chapter thành file ZIP')
  .option('--no-zip', 'Lưu ảnh trực tiếp vào thư mục (không ZIP)')
  .option('--concurrency <n>', 'Số ảnh tải đồng thời', '5')
  .action(async (chapterUrl, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    if (chapterUrl.startsWith('http') && !globalOpts.domain) {
      const match = chapterUrl.match(/https?:\/\/(newtoki\d+\.com)/);
      if (match) {
        globalOpts.domain = match[1];
        globalOpts.skipDomainCheck = true;
      }
    }
    const { context, page } = await setupBrowser(globalOpts);

    try {
      // Lấy URL ảnh
      let spinner = ora('Đang mở chapter và lấy URL ảnh...').start();
      const { title, imageUrls } = await getImageUrls(page, chapterUrl);
      spinner.succeed(`Tìm thấy ${chalk.cyan(imageUrls.length)} ảnh: "${title}"`);

      if (!imageUrls.length) {
        console.log(chalk.yellow('  Không tìm thấy ảnh. Hãy thử --no-headless để xem trang thực tế.'));
        return;
      }

      // Tải ảnh
      const safeTitle = sanitizeFilename(title);
      const outputDir = globalOpts.output || './downloads';
      const useZip = opts.zip !== false;
      const concurrency = parseInt(opts.concurrency) || 5;

      console.log(chalk.gray(`\n  Chế độ: ${useZip ? 'ZIP' : 'Thư mục'}`));
      console.log(chalk.gray(`  Output: ${outputDir}\n`));

      const outputPath = useZip
        ? path.join(outputDir, `${safeTitle}.zip`)
        : path.join(outputDir, safeTitle);

      // Lấy domain làm referer
      const refererMatch = chapterUrl.match(/https?:\/\/[^/]+/);
      const referer = refererMatch ? refererMatch[0] + '/' : undefined;

      let result;
      if (useZip) {
        result = await downloadToZip(imageUrls, outputPath, {
          concurrency,
          referer,
          onProgress: (done, total) => drawProgressBar(done, total),
        });
        console.log('');
        console.log(chalk.green(`\n  ✓ Đã lưu: ${result.outputPath}`));
      } else {
        result = await downloadToFolder(imageUrls, outputPath, {
          concurrency,
          referer,
          onProgress: (done, total) => drawProgressBar(done, total),
        });
        console.log('');
        console.log(chalk.green(`\n  ✓ Đã lưu: ${result.outputDir}/`));
      }

      if (result.failCount > 0) {
        console.log(chalk.yellow(`  ⚠ ${result.failCount} ảnh thất bại`));
      }
      console.log(chalk.gray(`  Thành công: ${result.successCount}/${imageUrls.length}\n`));

    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
      console.error(chalk.gray(err.stack));
    } finally {
      await context.close();
    }
  });

// ─── DOWNLOAD ALL ────────────────────────────────────

program
  .command('download-all <manga-url>')
  .description('Tải tất cả chapter của một truyện')
  .option('--from <n>', 'Bắt đầu từ chapter thứ n (1-indexed)', '1')
  .option('--to <n>', 'Đến chapter thứ n')
  .option('--concurrency <n>', 'Số ảnh tải đồng thời mỗi chapter', '5')
  .option('--delay <ms>', 'Delay giữa các chapter (ms)', '2000')
  .option('--no-zip', 'Lưu ảnh vào thư mục thay vì ZIP')
  .action(async (mangaUrl, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    if (mangaUrl.startsWith('http') && !globalOpts.domain) {
      const match = mangaUrl.match(/https?:\/\/(newtoki\d+\.com)/);
      if (match) {
        globalOpts.domain = match[1];
        globalOpts.skipDomainCheck = true;
      }
    }
    const { context, page } = await setupBrowser(globalOpts);

    try {
      // Lấy danh sách chapter
      let spinner = ora('Đang lấy danh sách chapter...').start();
      const { title: mangaTitle, chapters } = await getChapterList(page, mangaUrl);
      spinner.succeed(`"${chalk.cyan(mangaTitle)}" — ${chapters.length} chapter`);

      if (!chapters.length) {
        console.log(chalk.yellow('  Không có chapter nào.'));
        return;
      }

      // Chọn range chapter
      const fromIdx = Math.max(0, parseInt(opts.from || '1') - 1);
      const toIdx = opts.to ? Math.min(chapters.length - 1, parseInt(opts.to) - 1) : chapters.length - 1;
      const selected = chapters.slice(fromIdx, toIdx + 1);

      console.log(chalk.gray(`  Sẽ tải ${selected.length} chapter (${fromIdx + 1} → ${toIdx + 1})\n`));

      const outputDir = path.join(globalOpts.output || './downloads', sanitizeFilename(mangaTitle));
      const concurrency = parseInt(opts.concurrency) || 5;
      const delay = parseInt(opts.delay) || 2000;
      const useZip = opts.zip !== false;

      let successChapters = 0;
      let failChapters = 0;

      for (let i = 0; i < selected.length; i++) {
        const ch = selected[i];
        const chapterNum = String(fromIdx + i + 1).padStart(4, '0');
        const chapterLabel = `[${i + 1}/${selected.length}] ${ch.title || `Chapter ${ch.number}`}`;

        console.log(chalk.white(`\n  ${chapterLabel}`));

        try {
          // Lấy URLs ảnh
          spinner = ora('  Lấy URL ảnh...').start();
          const { title: chTitle, imageUrls } = await getImageUrls(page, ch.url);
          spinner.succeed(`  ${imageUrls.length} ảnh`);

          if (!imageUrls.length) {
            console.log(chalk.yellow('  → Không có ảnh, bỏ qua'));
            failChapters++;
            continue;
          }

          // Tải
          const safeChTitle = `${chapterNum}_${sanitizeFilename(chTitle || ch.title)}`;
          const refererMatch = ch.url.match(/https?:\/\/[^/]+/);
          const referer = refererMatch ? refererMatch[0] + '/' : undefined;

          let result;
          if (useZip) {
            const zipPath = path.join(outputDir, `${safeChTitle}.zip`);
            result = await downloadToZip(imageUrls, zipPath, {
              concurrency,
              referer,
              onProgress: (done, total) => drawProgressBar(done, total),
            });
          } else {
            const folderPath = path.join(outputDir, safeChTitle);
            result = await downloadToFolder(imageUrls, folderPath, {
              concurrency,
              referer,
              onProgress: (done, total) => drawProgressBar(done, total),
            });
          }

          console.log('');
          if (result.failCount > 0) {
            console.log(chalk.yellow(`  ⚠ ${result.failCount} ảnh thất bại`));
          }
          console.log(chalk.green(`  ✓ OK (${result.successCount}/${imageUrls.length})`));
          successChapters++;

          // Delay giữa chapters
          if (i < selected.length - 1) {
            await page.waitForTimeout(delay);
          }

        } catch (err) {
          console.log(chalk.red(`  ✗ Lỗi: ${err.message}`));
          failChapters++;
        }
      }

      // Summary
      console.log(chalk.bold('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.green(`  ✓ Thành công: ${successChapters} chapter`));
      if (failChapters > 0) console.log(chalk.red(`  ✗ Thất bại: ${failChapters} chapter`));
      console.log(chalk.gray(`  Output: ${outputDir}\n`));

    } catch (err) {
      console.error(chalk.red('\n  Lỗi: ' + err.message));
      console.error(chalk.gray(err.stack));
    } finally {
      await context.close();
    }
  });

// ─── INTERACTIVE MODE ────────────────────────────────

program
  .command('interactive')
  .alias('i')
  .description('Chế độ tương tác (menu)')
  .action(async (opts, cmd) => {
    const { prompt, Select, Input } = require('enquirer');
    printBanner();
    const globalOpts = cmd.parent.opts();
    const { context, page } = await setupBrowser(globalOpts);

    try {
      while (true) {
        const action = await new Select({
          name: 'action',
          message: 'Chọn hành động:',
          choices: [
            { name: 'search', message: '🔍 Tìm kiếm truyện' },
            { name: 'browse', message: '📚 Xem danh sách truyện' },
            { name: 'chapters', message: '📋 Xem chapter của truyện (nhập URL)' },
            { name: 'download', message: '⬇  Tải một chapter (nhập URL)' },
            { name: 'exit', message: '❌ Thoát' },
          ],
        }).run();

        if (action === 'exit') break;

        if (action === 'search') {
          const keyword = await new Input({ name: 'keyword', message: 'Từ khóa:' }).run();
          const spinner = ora(`Tìm kiếm: "${keyword}"`).start();
          const results = await searchManga(page, keyword);
          spinner.succeed(`${results.length} kết quả:`);
          printMangaTable(results);

        } else if (action === 'browse') {
          const spinner = ora('Đang tải...').start();
          const results = await browseManga(page);
          spinner.succeed(`${results.length} truyện:`);
          printMangaTable(results);

        } else if (action === 'chapters') {
          const url = await new Input({ name: 'url', message: 'URL trang truyện:' }).run();
          const spinner = ora('Đang tải...').start();
          const { title, chapters } = await getChapterList(page, url);
          spinner.succeed(`"${title}"`);
          printChapterTable(chapters);

        } else if (action === 'download') {
          const url = await new Input({ name: 'url', message: 'URL chapter:' }).run();
          const spinner = ora('Lấy URL ảnh...').start();
          const { title, imageUrls } = await getImageUrls(page, url);
          spinner.succeed(`${imageUrls.length} ảnh tìm thấy`);

          if (imageUrls.length) {
            const safeTitle = sanitizeFilename(title);
            const outputPath = path.join(globalOpts.output || './downloads', `${safeTitle}.zip`);
            const referer = url.match(/https?:\/\/[^/]+/)?.[0] + '/';
            await downloadToZip(imageUrls, outputPath, {
              referer,
              onProgress: (done, total) => drawProgressBar(done, total),
            });
            console.log('');
            console.log(chalk.green(`\n  ✓ Đã lưu: ${outputPath}\n`));
          }
        }
      }
    } catch (err) {
      if (err.message !== '') console.error(chalk.red('\n  Lỗi: ' + err.message));
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
