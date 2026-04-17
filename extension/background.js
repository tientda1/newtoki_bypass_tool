// background.js — Service Worker của Extension
// Nhận lệnh từ popup, điều phối fetch trang và gửi data về server

const SERVER = 'http://localhost:27420';

// Lắng nghe message từ content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PAGE_DATA') {
    // Gửi data về Node.js server
    fetch(`${SERVER}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: msg.url, data: msg.data }),
    }).catch(() => {});
  }
  if (msg.type === 'GET_COMMAND') {
    // Content script hỏi xem có lệnh gì không
    fetch(`${SERVER}/command`)
      .then(r => r.json())
      .then(cmd => sendResponse(cmd))
      .catch(() => sendResponse(null));
    return true; // async
  }
});
