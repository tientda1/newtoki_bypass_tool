# Newtoki Tool v2.0 🔴

Tải truyện từ Newtoki — dùng **Chrome Extension Bridge** để bypass Cloudflare hoàn toàn.

---

## Kiến trúc (tại sao không bị detect)

```
Chrome thật (Extension) ──HTTP──> localhost:27420 <── Node.js CLI
     ↑                                                      ↓
  User browse                                          Tải ảnh + ZIP
  bình thường
```

- **Không dùng CDP** → Cloudflare không detect được automation
- Chrome chạy hoàn toàn bình thường, extension hoạt động như userscript

---

## Cài đặt

```bash
cd newtoki-tool
npm install
```

---

## Bước 1: Cài Extension vào Chrome

1. Mở Chrome → gõ vào địa chỉ: `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Click **"Load unpacked"**
4. Chọn thư mục: `C:\Users\Hi\.gemini\antigravity\scratch\newtoki-tool\extension`
5. Extension "Newtoki Bridge" xuất hiện ✓

---

## Bước 2: Dùng Tool

### Xem danh sách truyện

```bash
# Chạy CLI (sẽ mở Chrome tự động)
node bridge-cli.js --domain newtoki469.com --open browse

# Hoặc tự mở Chrome vào link:
node bridge-cli.js --domain newtoki469.com browse
# Rồi vào Chrome: https://newtoki469.com/webtoon
```

### Tìm kiếm truyện

```bash
node bridge-cli.js --open search "솔로 레벨링"
node bridge-cli.js --open search "나 혼자만 레벨업"
```

### Xem danh sách chapter

```bash
node bridge-cli.js --open chapters https://newtoki469.com/webtoon/view/xxxxx
```

### Tải một chapter (→ ZIP)

```bash
node bridge-cli.js --open download https://newtoki469.com/webtoon/view/xxxxx/1
```

### Tải tất cả chapter

```bash
# Tất cả chapter
node bridge-cli.js --open download-all https://newtoki469.com/webtoon/view/xxxxx

# Chapter 1 đến 10
node bridge-cli.js --open download-all <url> --from 1 --to 10

# Lưu vào D:/manga
node bridge-cli.js --open download-all <url> --output D:/manga
```

---

## Cách hoạt động

1. **CLI** khởi động server tại `localhost:27420`
2. **CLI** gửi lệnh navigate (hoặc mở Chrome tự động nếu có `--open`)
3. **Extension** chạy trong Chrome thật → scrape data → POST về server
4. **CLI** nhận data, tải ảnh, đóng ZIP

Extension tự động scrape mỗi khi trang Newtoki load — không cần click gì thêm!

---

## Files

| File | Chức năng |
|---|---|
| `bridge-cli.js` | **CLI chính** (không dùng Playwright) |
| `server.js` | Bridge server localhost:27420 |
| `extension/` | Chrome Extension |
| `downloader.js` | Tải ảnh + ZIP |
| `export-cookies.js` | Export cookies Chrome (backup) |

---

## Troubleshoot

**Extension không gửi data?**
- Kiểm tra extension có được enable không
- Mở DevTools (F12) → Console → xem có lỗi fetch không
- Đảm bảo `node bridge-cli.js ...` đang chạy trước khi load trang

**Không tìm thấy ảnh?**
- Đảm bảo đang ở trang **chapter** (có ảnh truyện hiện ra), không phải trang danh sách
- Scroll xuống hết trang rồi thử lại
