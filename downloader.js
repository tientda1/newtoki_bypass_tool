/**
 * downloader.js — Image Downloader + ZIP Packer
 * Tải ảnh song song với concurrency limit, đóng gói thành ZIP
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const JSZip = require('jszip');

const DEFAULT_CONCURRENCY = 5;

// Headers giống script gốc NewtokiRipper-1.5
function buildImageHeaders(refererBase) {
  return {
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': '"Chromium";v="135", "Not-A.Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
    referer: refererBase || 'https://newtoki469.com/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  };
}

/**
 * Tải ảnh từ URL → Buffer
 */
function fetchImageBuffer(url, referer) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const options = {
      headers: buildImageHeaders(referer),
    };

    const req = lib.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchImageBuffer(res.headers.location, referer).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });
  });
}

/**
 * Chạy async tasks với concurrency limit
 */
async function limitedConcurrent(tasks, concurrency, onProgress) {
  const results = new Array(tasks.length);
  let index = 0;
  let done = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      try {
        results[i] = await tasks[i]();
      } catch (err) {
        results[i] = { error: err.message };
      }
      done++;
      if (onProgress) onProgress(done, tasks.length, i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * Tải tất cả ảnh và đóng gói thành ZIP
 * @param {string[]} imageUrls - Danh sách URL ảnh
 * @param {string} outputPath - Đường dẫn output ZIP
 * @param {object} options - { concurrency, referer, onProgress }
 */
async function downloadToZip(imageUrls, outputPath, options = {}) {
  const { concurrency = DEFAULT_CONCURRENCY, referer, onProgress } = options;

  const zip = new JSZip();
  let successCount = 0;
  let failCount = 0;

  const tasks = imageUrls.map((url, i) => async () => {
    const ext = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1] || 'jpg';
    const filename = String(i + 1).padStart(4, '0') + '.' + ext;

    try {
      const buffer = await fetchImageBuffer(url, referer);
      zip.file(filename, buffer);
      successCount++;
      return { filename, success: true };
    } catch (err) {
      failCount++;
      return { filename, success: false, error: err.message };
    }
  });

  await limitedConcurrent(tasks, concurrency, onProgress);

  // Tạo thư mục output nếu chưa có
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Tạo ZIP và lưu file
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 }, // Nhanh hơn, ảnh đã compressed
  });

  fs.writeFileSync(outputPath, zipBuffer);

  return { successCount, failCount, outputPath };
}

/**
 * Tải ảnh thẳng vào thư mục (không ZIP)
 */
async function downloadToFolder(imageUrls, outputDir, options = {}) {
  const { concurrency = DEFAULT_CONCURRENCY, referer, onProgress } = options;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let successCount = 0;
  let failCount = 0;

  const tasks = imageUrls.map((url, i) => async () => {
    const ext = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1] || 'jpg';
    const filename = String(i + 1).padStart(4, '0') + '.' + ext;
    const filePath = path.join(outputDir, filename);

    try {
      const buffer = await fetchImageBuffer(url, referer);
      fs.writeFileSync(filePath, buffer);
      successCount++;
      return { filename, success: true };
    } catch (err) {
      failCount++;
      return { filename, success: false, error: err.message };
    }
  });

  await limitedConcurrent(tasks, concurrency, onProgress);

  return { successCount, failCount, outputDir };
}

/**
 * Sanitize tên file (bỏ ký tự không hợp lệ trên Windows)
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/, '')
    .trim()
    .substring(0, 200);
}

module.exports = { downloadToZip, downloadToFolder, sanitizeFilename };
