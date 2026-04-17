#!/usr/bin/env node
/**
 * bridge-cli.js — CLI dùng Chrome Extension Bridge
 *
 * Kiến trúc:
 *   Chrome thật (extension) → HTTP localhost:27420 ← Node.js CLI
 *
 * Không dùng CDP → không bị Cloudflare detect
 *
 * Usage:
 *   node bridge-cli.js browse [--domain newtoki469.com]
 *   node bridge-cli.js search <keyword>
 *   node bridge-cli.js chapters <manga-url>
 *   node bridge-cli.js download <chapter-url> [--output ./downloads]
 *   node bridge-cli.js download-all <manga-url> [--output ./downloads]
 */

'use strict';

const { Command } = require('commander');
const chalk  = require('chalk');
const ora    = require('ora');
const Table  = require('cli-table3');
const path   = require('path');
const fs     = require('fs');
const { exec } = require('child_process');

const { startServer, stopServer, waitForData, sendNavigate, sendScrape, PORT } = require('./server');
const { downloadToZip, downloadToFolder, sanitizeFilename } = require('./downloader');

// ── Helpers ────────────────────────────────────────────────

function printBanner() {
  console.log(chalk.red.bold(`
  ███╗   ██╗███████╗██╗    ██╗████████╗ ██████╗ ██╗  ██╗██╗
  ████╗  ██║██╔════╝██║    ██║╚══██╔══╝██╔═══██╗██║ ██╔╝██║
  ██╔██╗ ██║█████╗  ██║ █╗ ██║   ██║   ██║   ██║█████╔╝ ██║
  ██║╚██╗██║██╔══╝  ██║███╗██║   ██║   ██║   ██║██╔═██╗ ██║
  ██║ ╚████║███████╗╚███╔███╔╝   ██║   ╚██████╔╝██║  ██╗██║
  ╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝    ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝`));
  console.log(chalk.gray('  Newtoki Tool v2.0 — Extension Bridge Mode\n'));
}

function drawProgressBar(done, total, width = 30) {
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * width);
  const bar = chalk.red('█'.repeat(filled)) + chalk.gray('░'.repeat(width - filled));
  const pct2 = (pct * 100).toFixed(1).padStart(5);
  process.stdout.write(`\r  [${bar}] ${pct2}% ${done}/${total}  `);
}

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
    t.push([chalk.gray(i + 1), chalk.cyan(item.title || '?'), chalk.gray((item.url || '').substring(0, 53))]);
  });
  console.log(t.toString());
  console.log(chalk.gray(`\n  Tổng: ${items.length}\n`));
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
    t.push([chalk.gray(i + 1), chalk.cyan(ch.title || `Ch.${i + 1}`), chalk.gray(ch.date || ''), chalk.gray((ch.url || '').substring(0, 48))]);
  });
  console.log(t.toString());
  console.log(chalk.gray(`\n  Tổng: ${chapters.length} chapter\n`));
}

// Mở Chrome tại URL cụ thể
function openChrome(url) {
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const chromePath = chromePaths.find(p => p && fs.existsSync(p));
  if (chromePath) {
    exec(`"${chromePath}" "${url}"`);
  } else {
    exec(`start "" "${url}"`);
  }
}

async function setup() {
  await startServer();
  console.log(chalk.gray(`  Server: localhost:${PORT}\n`));
}

// ── Commands ───────────────────────────────────────────────

const program = new Command();

program
  .name('newtoki-bridge')
  .description('Newtoki tool dùng Extension Bridge (không bị Cloudflare detect)')
  .version('2.0.0')
  .option('--domain <domain>', 'Newtoki domain', 'newtoki469.com')
  .option('--output <dir>', 'Thư mục lưu file', './downloads')
  .option('--open', 'Tự động mở Chrome đến URL');

// ─── BROWSE ──────────────────────────────────────────────

program
  .command('browse')
  .description('Lấy danh sách truyện trang chủ từ Chrome đang mở')
  .option('--page <n>', 'Số trang', '1')
  .action(async (opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    await setup();

    const domain = globalOpts.domain;
    const pageNum = parseInt(opts.page) || 1;
    const url = `https://${domain}/webtoon${pageNum > 1 ? '?page=' + pageNum : ''}`;

    console.log(chalk.cyan(`  URL: ${url}\n`));

    const spinner = ora('Chờ Chrome Extension gửi data...').start();
    console.log(chalk.gray(`\n  💡 Hãy mở Chrome và vào: ${url}`));
    console.log(chalk.gray('  (Extension sẽ tự động gửi data sau khi trang load)\n'));

    if (globalOpts.open) openChrome(url);
    await sendNavigate(url);

    try {
      const data = await waitForData(60000);
      spinner.succeed(`Nhận được data (type: ${data.type}, ${(data.items || []).length} items)`);
      printMangaTable(data.items);
    } catch (err) {
      spinner.fail(err.message);
    } finally {
      await stopServer();
    }
  });

// ─── SEARCH ──────────────────────────────────────────────

program
  .command('search <keyword>')
  .description('Tìm kiếm truyện')
  .action(async (keyword, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    await setup();

    const domain = globalOpts.domain;
    const url = `https://${domain}/webtoon?stx=${encodeURIComponent(keyword)}`;

    console.log(chalk.cyan(`  Tìm: "${keyword}"\n`));
    const spinner = ora('Chờ Extension gửi data...').start();
    console.log(chalk.gray(`\n  💡 Mở Chrome và vào: ${url}\n`));

    if (globalOpts.open) openChrome(url);
    await sendNavigate(url);

    try {
      const data = await waitForData(60000);
      spinner.succeed(`${(data.items || []).length} kết quả`);
      printMangaTable(data.items);
    } catch (err) {
      spinner.fail(err.message);
    } finally {
      await stopServer();
    }
  });

// ─── CHAPTERS ────────────────────────────────────────────

program
  .command('chapters <manga-url>')
  .description('Lấy danh sách chapter')
  .action(async (mangaUrl, opts, cmd) => {
    printBanner();
    await setup();

    const spinner = ora('Chờ Extension gửi data...').start();
    console.log(chalk.gray(`\n  💡 Mở Chrome và vào: ${mangaUrl}\n`));

    if (cmd.parent.opts().open) openChrome(mangaUrl);
    await sendNavigate(mangaUrl);

    try {
      const data = await waitForData(60000);
      spinner.succeed(`"${data.title || '?'}" — ${(data.chapters || []).length} chapter`);
      if (data.debugHrefs && (!data.chapters || !data.chapters.length)) {
        console.log(chalk.yellow('\n  ⚠ 0 chapters. Sample hrefs trên trang:'));
        (data.debugHrefs || []).forEach(h => console.log(chalk.gray('    ' + h)));
      }
      printChapterTable(data.chapters);
    } catch (err) {
      spinner.fail(err.message);
    } finally {
      await stopServer();
    }
  });

// ─── DOWNLOAD ────────────────────────────────────────────

program
  .command('download <chapter-url>')
  .description('Tải một chapter')
  .option('--no-zip', 'Lưu ảnh vào thư mục thay vì ZIP')
  .option('--concurrency <n>', 'Số ảnh tải đồng thời', '5')
  .action(async (chapterUrl, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    await setup();

    const spinner = ora('Chờ Extension scrape ảnh...').start();
    console.log(chalk.gray(`\n  💡 Mở Chrome và vào: ${chapterUrl}\n`));

    if (globalOpts.open) openChrome(chapterUrl);
    await sendNavigate(chapterUrl);

    try {
      const data = await waitForData(60000);
      const imageUrls = data.imageUrls || [];
      spinner.succeed(`${imageUrls.length} ảnh tìm thấy: "${data.title}"`);

      if (!imageUrls.length) {
        console.log(chalk.yellow('  Không có ảnh. Chắc chắn đang ở trang chapter.'));
        return;
      }

      const safeTitle = sanitizeFilename(data.title || 'chapter');
      const outputDir = globalOpts.output || './downloads';
      const useZip = opts.zip !== false;
      const referer = chapterUrl.match(/https?:\/\/[^/]+/)?.[0] + '/';

      console.log(chalk.gray(`\n  Tải ${imageUrls.length} ảnh (${useZip ? 'ZIP' : 'folder'})...\n`));

      let result;
      if (useZip) {
        result = await downloadToZip(imageUrls, path.join(outputDir, `${safeTitle}.zip`), {
          concurrency: parseInt(opts.concurrency) || 5,
          referer,
          onProgress: drawProgressBar,
        });
      } else {
        result = await downloadToFolder(imageUrls, path.join(outputDir, safeTitle), {
          concurrency: parseInt(opts.concurrency) || 5,
          referer,
          onProgress: drawProgressBar,
        });
      }

      console.log('');
      console.log(chalk.green(`\n  ✓ ${result.successCount}/${imageUrls.length} ảnh — ${result.outputPath || result.outputDir}\n`));

    } catch (err) {
      spinner.fail(err.message);
    } finally {
      await stopServer();
    }
  });

// ─── DOWNLOAD ALL ────────────────────────────────────────

program
  .command('download-all <manga-url>')
  .description('Tải tất cả chapter (cần Extension mở từng chapter)')
  .option('--from <n>', 'Từ chapter thứ n', '1')
  .option('--to <n>', 'Đến chapter thứ n')
  .option('--concurrency <n>', 'Số ảnh đồng thời', '5')
  .option('--delay <ms>', 'Delay giữa chapter (ms)', '3000')
  .option('--no-zip', 'Lưu vào folder')
  .action(async (mangaUrl, opts, cmd) => {
    printBanner();
    const globalOpts = cmd.parent.opts();
    await setup();

    // Bước 1: lấy chapter list
    let spinner = ora('Bước 1: Lấy danh sách chapter...').start();
    console.log(chalk.gray(`  → Vào: ${mangaUrl}\n`));
    if (globalOpts.open) openChrome(mangaUrl);
    await sendNavigate(mangaUrl);

    let chapters;
    let mangaTitle;
    try {
      const data = await waitForData(60000);
      chapters = data.chapters || [];
      mangaTitle = data.title || 'manga';
      spinner.succeed(`"${mangaTitle}" — ${chapters.length} chapter`);
    } catch (err) {
      spinner.fail(err.message);
      await stopServer();
      return;
    }

    if (!chapters.length) {
      console.log(chalk.yellow('  Không có chapter.'));
      await stopServer();
      return;
    }

    // Chọn range
    const fromIdx = Math.max(0, parseInt(opts.from || '1') - 1);
    const toIdx = opts.to ? Math.min(chapters.length - 1, parseInt(opts.to) - 1) : chapters.length - 1;
    const selected = chapters.slice(fromIdx, toIdx + 1);
    console.log(chalk.gray(`  Sẽ tải ${selected.length} chapter (${fromIdx + 1}→${toIdx + 1})\n`));

    const outputBase = path.join(globalOpts.output || './downloads', sanitizeFilename(mangaTitle));
    const delay = parseInt(opts.delay) || 3000;
    const concurrency = parseInt(opts.concurrency) || 5;
    const useZip = opts.zip !== false;

    let ok = 0, fail = 0;

    for (let i = 0; i < selected.length; i++) {
      const ch = selected[i];
      console.log(chalk.white(`\n  [${i + 1}/${selected.length}] ${ch.title || ch.url}`));

      // Gửi lệnh navigate đến chapter
      await sendNavigate(ch.url);
      spinner = ora('  Chờ Extension scrape...').start();
      console.log(chalk.gray(`  → Hãy đảm bảo Chrome đang mở tab newtoki\n`));

      try {
        const data = await waitForData(60000);
        const imageUrls = data.imageUrls || [];
        spinner.succeed(`  ${imageUrls.length} ảnh`);

        if (!imageUrls.length) { fail++; continue; }

        const chTitle = sanitizeFilename(`${String(fromIdx + i + 1).padStart(4, '0')}_${data.title || ch.title}`);
        const referer = ch.url.match(/https?:\/\/[^/]+/)?.[0] + '/';

        let result;
        if (useZip) {
          result = await downloadToZip(path.join(outputBase, `${chTitle}.zip`), imageUrls, { concurrency, referer, onProgress: drawProgressBar });
        } else {
          result = await downloadToFolder(path.join(outputBase, chTitle), imageUrls, { concurrency, referer, onProgress: drawProgressBar });
        }
        console.log('');
        console.log(chalk.green(`  ✓ ${result.successCount}/${imageUrls.length}`));
        ok++;

      } catch (err) {
        spinner.fail(`  Error: ${err.message}`);
        fail++;
      }

      if (i < selected.length - 1) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.log(chalk.bold('\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.green(`  ✓ Thành công: ${ok} chapter`));
    if (fail) console.log(chalk.red(`  ✗ Thất bại: ${fail} chapter`));
    console.log(chalk.gray(`  Output: ${outputBase}\n`));

    await stopServer();
  });

program.parseAsync(process.argv).catch(err => {
  console.error(chalk.red('Fatal:', err.message));
  process.exit(1);
});
