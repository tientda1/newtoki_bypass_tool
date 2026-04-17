/**
 * server.js — Local HTTP Server
 * Extension gửi data về đây, CLI lấy data từ đây
 * Port: 27420
 *
 * Endpoints:
 *   GET  /ping         → kiểm tra server alive
 *   GET  /command      → Extension poll lấy lệnh
 *   POST /data         → Extension gửi data vào
 *   GET  /result       → CLI lấy kết quả cuối cùng
 *   POST /navigate     → CLI yêu cầu navigate đến URL
 */

'use strict';

const http = require('http');
const PORT = 27420;

let pendingCommand = null;   // Lệnh đang chờ Extension thực thi
let latestData = null;       // Data mới nhất từ Extension
let dataResolvers = [];      // Promise resolvers đang chờ data

function createServer() {
  const server = http.createServer((req, res) => {
    // CORS headers (Extension cần)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url.split('?')[0];

    // ── GET /ping ─────────────────────────────────────────
    if (req.method === 'GET' && url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, waiting: dataResolvers.length > 0 }));
      return;
    }

    // ── GET /command ──────────────────────────────────────
    // Extension poll lấy lệnh từ CLI
    if (req.method === 'GET' && url === '/command') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pendingCommand || {}));
      pendingCommand = null; // Consume sau khi đọc
      return;
    }

    // ── POST /data ────────────────────────────────────────
    // Extension gửi data scraped về
    if (req.method === 'POST' && url === '/data') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          latestData = JSON.parse(body);
          // Resolve tất cả promises đang chờ
          const resolvers = [...dataResolvers];
          dataResolvers = [];
          resolvers.forEach(r => r(latestData));
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // ── POST /navigate ────────────────────────────────────
    // CLI yêu cầu Extension navigate đến URL
    if (req.method === 'POST' && url === '/navigate') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { targetUrl } = JSON.parse(body);
          pendingCommand = { navigate: targetUrl };
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // ── POST /scrape ──────────────────────────────────────
    // CLI yêu cầu Extension scrape trang hiện tại
    if (req.method === 'POST' && url === '/scrape') {
      pendingCommand = { scrape: true };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return server;
}

/**
 * Chờ data từ Extension (với timeout)
 */
function waitForData(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      dataResolvers = dataResolvers.filter(r => r !== resolve);
      reject(new Error('Timeout chờ Extension gửi data. Hãy chắc chắn extension đã cài và đang chạy.'));
    }, timeoutMs);

    dataResolvers.push((data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

let _server = null;

async function startServer() {
  if (_server) return _server;
  _server = createServer();
  await new Promise((resolve, reject) => {
    _server.listen(PORT, '127.0.0.1', resolve).on('error', reject);
  });
  return _server;
}

async function stopServer() {
  if (_server) {
    await new Promise(r => _server.close(r));
    _server = null;
  }
}

/**
 * Gửi lệnh navigate đến Extension
 */
async function sendNavigate(targetUrl) {
  pendingCommand = { navigate: targetUrl };
}

/**
 * Gửi lệnh scrape trang hiện tại
 */
async function sendScrape() {
  pendingCommand = { scrape: true };
}

module.exports = { startServer, stopServer, waitForData, sendNavigate, sendScrape, PORT };
