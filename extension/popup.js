// popup.js
const statusEl = document.getElementById('status');
const scrapeBtn = document.getElementById('scrape');

async function checkServer() {
  try {
    const r = await fetch('http://localhost:27420/ping', { signal: AbortSignal.timeout(2000) });
    const j = await r.json();
    statusEl.className = 'status ok';
    statusEl.textContent = '✓ Server đang chạy — ' + (j.waiting ? 'đang chờ data' : 'idle');
  } catch {
    statusEl.className = 'status err';
    statusEl.textContent = '✗ Server chưa chạy (node server.js)';
  }
}

scrapeBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  });
  statusEl.textContent = 'Đang scrape...';
  setTimeout(checkServer, 1000);
});

checkServer();
