/**
 * ollama.js — Tích hợp Ollama + Gemma 4 (multimodal)
 *
 * Dùng Gemma 4 để:
 *  - Giải CAPTCHA bằng ảnh (multimodal)
 *  - Phân tích nội dung trang nếu cần
 *
 * Requires: Ollama running at localhost:11434
 *   ollama pull gemma4:e2b   ← nhẹ, đủ giải text CAPTCHA
 *   ollama pull gemma4       ← mặc định
 */

'use strict';

const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT || '11434');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'gemma4';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Low-level HTTP helper (không dùng axios để tránh thêm dep)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST JSON đến Ollama API
 * @param {string} endpoint  - vd: '/api/generate'
 * @param {object} body
 * @param {number} timeoutMs
 * @returns {Promise<object>} parsed JSON response
 */
function ollamaPost(endpoint, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          // Ollama trả về newline-delimited JSON (stream=false → single object)
          const lines = raw.trim().split('\n').filter(Boolean);
          const last = JSON.parse(lines[lines.length - 1]);
          if (last.error) reject(new Error(`Ollama error: ${last.error}`));
          else resolve(last);
        } catch (e) {
          reject(new Error(`Ollama parse error: ${e.message}\nRaw: ${raw.substring(0, 300)}`));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Ollama timeout sau ${timeoutMs / 1000}s`));
    });

    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        reject(new Error(`Không kết nối được Ollama tại ${OLLAMA_HOST}:${OLLAMA_PORT}.\n  → Hãy chạy: ollama serve`));
      } else {
        reject(e);
      }
    });

    req.write(payload);
    req.end();
  });
}

/**
 * GET đến Ollama API
 */
function ollamaGet(endpoint, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: endpoint,
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`Ollama GET parse error: ${e.message}`)); }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Ollama GET timeout'));
    });

    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        reject(new Error(`Không kết nối được Ollama tại ${OLLAMA_HOST}:${OLLAMA_PORT}.\n  → Hãy chạy: ollama serve`));
      } else {
        reject(e);
      }
    });

    req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Health check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Kiểm tra Ollama đang chạy và model tồn tại
 * @param {string} modelName
 * @returns {{ ok: boolean, hasModel: boolean, availableModels: string[] }}
 */
async function checkOllama(modelName = DEFAULT_MODEL) {
  let tags;
  try {
    tags = await ollamaGet('/api/tags');
  } catch (err) {
    return { ok: false, hasModel: false, availableModels: [], error: err.message };
  }

  const models = (tags.models || []).map(m => m.name);
  // Gemma4 có thể có tag như "gemma4:latest", "gemma4:e2b", v.v.
  const hasModel = models.some(m =>
    m === modelName ||
    m.startsWith(modelName + ':') ||
    m.startsWith(modelName.split(':')[0] + ':')
  );

  return { ok: true, hasModel, availableModels: models };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Core AI functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Gọi Gemma 4 với text prompt
 * @param {string} prompt
 * @param {string} modelName
 * @returns {string} phản hồi text
 */
async function generate(prompt, modelName = DEFAULT_MODEL) {
  const res = await ollamaPost('/api/generate', {
    model: modelName,
    prompt,
    stream: false,
    options: {
      temperature: 0.1,
      top_p: 0.9,
      num_predict: 200,
    },
  });
  return (res.response || '').trim();
}

/**
 * Gọi Gemma 4 multimodal — phân tích ảnh + prompt
 * @param {Buffer|string} imageInput  - Buffer hoặc base64 string
 * @param {string} prompt
 * @param {string} modelName
 * @returns {string} phản hồi text
 */
async function analyzeImage(imageInput, prompt, modelName = DEFAULT_MODEL) {
  // Chuyển Buffer → base64 nếu cần
  const base64 = Buffer.isBuffer(imageInput)
    ? imageInput.toString('base64')
    : imageInput;

  const res = await ollamaPost('/api/generate', {
    model: modelName,
    prompt,
    images: [base64],
    stream: false,
    options: {
      temperature: 0.05,   // Rất thấp → deterministic cho CAPTCHA
      top_p: 0.9,
      num_predict: 100,
    },
  }, 90000);

  return (res.response || '').trim();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CAPTCHA Solver
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Giải text CAPTCHA từ ảnh chụp màn hình
 * @param {Buffer} screenshotBuffer  - PNG buffer của CAPTCHA element
 * @param {string} modelName
 * @returns {string} text CAPTCHA đọc được
 */
async function solveCaptcha(screenshotBuffer, modelName = DEFAULT_MODEL) {
  const prompt = [
    'This is a CAPTCHA image. Please read the text or characters shown in the image.',
    'Return ONLY the exact text/characters you see, nothing else.',
    'If there are numbers, return just the numbers.',
    'If there is distorted text, return your best guess.',
    'Do not explain, do not add punctuation. Just the answer.',
  ].join(' ');

  const answer = await analyzeImage(screenshotBuffer, prompt, modelName);

  // Làm sạch: chỉ giữ alphanumeric + khoảng trắng
  return answer.replace(/[^a-zA-Z0-9\s]/g, '').trim();
}

/**
 * Phân tích trang web có bị block hay không (dùng text từ page)
 * @param {string} pageText - nội dung text của trang
 * @param {string} modelName
 * @returns {{ blocked: boolean, reason: string }}
 */
async function analyzePageBlock(pageText, modelName = DEFAULT_MODEL) {
  const truncated = pageText.substring(0, 1000);
  const prompt = `This is the text content of a web page. Is this page showing a CAPTCHA, security check, or access block? Answer with JSON: {"blocked": true/false, "reason": "brief reason"}. Page text: "${truncated}"`;

  try {
    const answer = await generate(prompt, modelName);
    // Cố parse JSON từ response
    const match = answer.match(/\{[^}]+\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    const blocked = /block|captcha|security|verify|check/i.test(answer);
    return { blocked, reason: answer.substring(0, 100) };
  } catch {
    return { blocked: false, reason: 'parse error' };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pull model helper (in ra hướng dẫn)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Hiển thị hướng dẫn nếu model chưa được pull
 * @param {string} modelName
 */
function printPullHint(modelName = DEFAULT_MODEL) {
  const chalk = (() => { try { return require('chalk'); } catch { return null; } })();
  const warn  = chalk ? chalk.yellow : (s) => s;
  const code  = chalk ? chalk.cyan   : (s) => s;
  console.log(warn(`\n  ⚠ Model "${modelName}" chưa được pull về Ollama.`));
  console.log(`  → Chạy lệnh sau để tải model:\n`);
  console.log(`     ${code(`ollama pull ${modelName}`)}\n`);
  console.log(`  → Model nhẹ hơn (đủ cho CAPTCHA):\n`);
  console.log(`     ${code('ollama pull gemma4:e2b')}\n`);
}

module.exports = {
  checkOllama,
  generate,
  analyzeImage,
  solveCaptcha,
  analyzePageBlock,
  printPullHint,
  DEFAULT_MODEL,
  OLLAMA_HOST,
  OLLAMA_PORT,
};
